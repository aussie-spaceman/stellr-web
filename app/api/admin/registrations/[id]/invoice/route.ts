import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireEventStaff } from '@/lib/authz'
import { supabaseServer } from '@/lib/supabase'
import { stripeClient } from '@/lib/stripe'
import { actorFromAuth, logActivity } from '@/lib/activity-log'
import {
  groupInvoiceSummary,
  previewGroupDiscount,
  reissueGroupInvoice,
  resolveDiscountCode,
  setGroupDiscount,
} from '@/lib/group-billing'
import { withAudit } from '@/lib/audit/route'
import { loadEventRecord, refuseOutsideStellr } from '@/lib/tenancy/load-scoped'

// "Invoice & discount…" on a group in the event roster.
//   GET  → the group's places, current invoice and invoice history.
//   POST { action: 'preview', code }  → what the invoice would be with that code.
//   POST { action: 'apply', code }    → revise the open invoice with the discount.
//   POST { action: 'remove' }         → revise it without one.
//   POST { action: 'reissue' }        → correct the invoice to the group's current places.
// Admins and the event's assigned managers (loadEventRecord refuses anyone else's
// event); the teacher has their own code box (app/api/members/teams/[id]/discount).
// See lib/group-billing.ts.

const ROUTE = '/api/admin/registrations/[id]/invoice'

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('preview'), code: z.string().trim().min(1).max(64) }),
  z.object({ action: z.literal('apply'), code: z.string().trim().min(1).max(64) }),
  z.object({ action: z.literal('remove') }),
  z.object({ action: z.literal('reissue') }),
])

type Db = ReturnType<typeof supabaseServer>
type Args = [Request, { params: Promise<{ id: string }> }]

const notFound = () => NextResponse.json({ error: 'Group registration not found' }, { status: 404 })

async function guard(db: Db, id: string, req: Request) {
  const staff = await requireEventStaff({ route: ROUTE })
  if (!staff.ok) return NextResponse.json({ error: 'Forbidden' }, { status: staff.status })
  audited.set(req, { id, userId: staff.userId, tenantId: staff.tenantId })
  const loaded = await loadEventRecord<{ event_slug: string; type: string | null; teacher_member_id: string | null }>(staff, 'registrations', id, {
    db,
    select: 'event_slug, type, teacher_member_id',
    notFound,
    label: ROUTE,
  })
  if (!loaded.ok) return loaded.response
  if (loaded.row.type !== 'group') return notFound()
  // Every action here reads or changes Stellr's Stripe account, its coupons included.
  const refused = refuseOutsideStellr(staff.scope)
  if (refused) return refused
  return { slug: loaded.row.event_slug, teacherMemberId: loaded.row.teacher_member_id ?? null, actorLabel: staff.isAdmin ? 'admin' as const : 'event_manager' as const }
}

// What this request acted on, which withAudit's spec cannot read for itself. A discount code
// is what a person typed, so only the Stripe coupon it resolved to is recorded.
const audited = new WeakMap<Request, { id: string; userId: string; tenantId: string; action?: string; invoiceId?: string | null; couponId?: string | null }>()

function eventFor(req: Request) {
  const a = audited.get(req)
  return {
    actor: a ? { userId: a.userId } : { session: true as const },
    tenant: { tenantId: a?.tenantId ?? null },
    target: { table: 'registrations', id: a?.id ?? null },
    metadata: { invoiceAction: a?.action ?? null, invoiceId: a?.invoiceId ?? null, couponId: a?.couponId ?? null },
  }
}

export const GET = withAudit(({ args: [req] }: { args: Args }) => ({ action: 'registration.invoice.read', ...eventFor(req) }), readInvoice)

async function readInvoice(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = supabaseServer()
  const g = await guard(db, id, req)
  if (g instanceof Response) return g
  const summary = await groupInvoiceSummary(db, stripeClient(), id)
  if (!summary) return notFound()
  return NextResponse.json(summary)
}

// One event per request, whichever action it was. `preview` changes nothing, and the row says so.
export const POST = withAudit(({ args: [req] }: { args: Args }) => ({ action: 'registration.invoice.change', ...eventFor(req) }), changeInvoice)

async function changeInvoice(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = supabaseServer()
  const g = await guard(db, id, req)
  if (g instanceof Response) return g
  const event = audited.get(req)

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Enter a discount code' }, { status: 400 })
  const stripe = stripeClient()
  if (!stripe) return NextResponse.json({ error: 'Stripe is not configured here' }, { status: 503 })

  const body = parsed.data
  if (event) event.action = body.action

  if (body.action === 'reissue') {
    const actor = await actorFromAuth()
    let result: Awaited<ReturnType<typeof reissueGroupInvoice>>
    try {
      result = await reissueGroupInvoice(db, stripe, id, { memberId: actor.actorMemberId ?? null, label: g.actorLabel })
    } catch (e) {
      console.error('[admin/invoice] reissue failed:', e)
      return NextResponse.json({ error: `Stripe refused the change: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
    }
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 })
    if (event) event.invoiceId = result.invoiceId
    if (g.teacherMemberId) {
      await logActivity({
        memberId: g.teacherMemberId,
        category: 'billing',
        action: 'group_invoice_reissued',
        summary: `Group invoice corrected for ${g.slug}`,
        metadata: { registrationId: id, eventSlug: g.slug, invoiceId: result.invoiceId },
        ...actor,
      }, db)
    }
    return NextResponse.json({ message: result.message, invoiceId: result.invoiceId })
  }

  // An internal coupon id (the scholarship coupons) is for admins; a manager enters codes.
  const discount = body.action === 'remove' ? null : await resolveDiscountCode(stripe, body.code, { promotionCodesOnly: g.actorLabel !== 'admin' })
  if (body.action !== 'remove' && !discount) {
    return NextResponse.json({ error: `"${body.code}" isn't an active discount code or coupon in Stripe.` }, { status: 404 })
  }
  if (event) event.couponId = discount?.couponId ?? null

  if (body.action === 'preview') {
    const preview = await previewGroupDiscount(db, stripe, id, discount!)
    if (!preview.ok) return NextResponse.json({ error: preview.error }, { status: 409 })
    return NextResponse.json(preview)
  }

  const actor = await actorFromAuth()
  let result: Awaited<ReturnType<typeof setGroupDiscount>>
  try {
    result = await setGroupDiscount(db, stripe, id, discount, { memberId: actor.actorMemberId ?? null, label: g.actorLabel })
  } catch (e) {
    console.error('[admin/invoice] discount failed:', e)
    return NextResponse.json({ error: `Stripe refused the change: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 })
  }
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 })
  if (event) event.invoiceId = result.invoiceId

  if (g.teacherMemberId) {
    await logActivity({
      memberId: g.teacherMemberId,
      category: 'billing',
      action: discount ? 'group_invoice_discount_applied' : 'group_invoice_discount_removed',
      summary: discount ? `Discount ${discount.label} applied to the group invoice for ${g.slug}` : `Discount removed from the group invoice for ${g.slug}`,
      metadata: { registrationId: id, eventSlug: g.slug, invoiceId: result.invoiceId, couponId: discount?.couponId ?? null },
      ...actor,
    }, db)
  }
  return NextResponse.json({ message: result.message, invoiceId: result.invoiceId })
}
