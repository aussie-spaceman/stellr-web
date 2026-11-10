import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { stripeClient } from '@/lib/stripe'
import { rateLimit } from '@/lib/rate-limit-async'
import { requestTenant } from '@/lib/tenancy/request-tenant'
import { teamViewerRole, type TeamViewerRegistration } from '@/lib/team-access'
import { assertNotImpersonating, resolveRequestMember } from '@/lib/impersonation'
import { actorFromAuth, logActivity } from '@/lib/activity-log'
import { withAudit } from '@/lib/audit/route'
import {
  eventSeatPrice,
  groupInvoiceSummary,
  previewGroupDiscount,
  resolveDiscountCode,
  setGroupDiscount,
} from '@/lib/group-billing'

// The organizer's discount code on their group's invoice (Account → Teams).
//   GET  → the code on the invoice now, the invoice total, and whether this member may change it.
//   POST { action: 'preview', code } → what the invoice would come to with that code.
//   POST { action: 'apply', code }   → revise the open invoice with it, and email it again.
//   POST { action: 'remove' }        → revise it without one.
// A card checkout has Stripe's own code box; an invoice has none, so this is that box.
// The teacher and the Teacher POC can change it (any code, staff's included: owner,
// 9 Nov 2026); a student manager can see it. Only promotion codes a customer could
// use at checkout resolve here, never a bare coupon id (lib/group-billing).

export const maxDuration = 60

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('preview'), code: z.string().trim().min(1).max(64) }),
  z.object({ action: z.literal('apply'), code: z.string().trim().min(1).max(64) }),
  z.object({ action: z.literal('remove') }),
])

const REG_COLUMNS = 'id, type, event_slug, teacher_member_id, teacher_email, teacher_poc_email, registrant_role, invoice_requested, invoice_paid_at'

type Db = ReturnType<typeof supabaseServer>

const BAD_CODE = 'That code isn’t valid for this event. Check it and try again.'

/** Why the code on this group's invoice can't change now, or null when it can. */
function lockedReason(reg: { invoice_requested?: boolean | null; invoice_paid_at?: string | null }, hasOpenInvoice: boolean): string | null {
  if (!reg.invoice_requested) return 'This group doesn’t pay by invoice. Enter a discount code at checkout instead.'
  if (reg.invoice_paid_at) return 'Your invoice has been paid, so its discount can’t change now. Contact Stellr if a discount was missed.'
  if (!hasOpenInvoice) return 'Your invoice hasn’t been sent yet. Once it has, you can add a discount code here.'
  return null
}

async function loadGroup(db: Db, id: string) {
  const { data } = await db.from('registrations').select(REG_COLUMNS).eq('id', id).eq('type', 'group').maybeSingle()
  return data as (TeamViewerRegistration & { id: string; event_slug: string; teacher_member_id: string | null; invoice_requested: boolean | null; invoice_paid_at: string | null }) | null
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = supabaseServer()

  const { member, unauthorised, impersonating } = await resolveRequestMember<{ id: string; email: string | null }>(db, 'id, email')
  if (unauthorised) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const registration = await loadGroup(db, id)
  if (!registration) return NextResponse.json({ error: 'Team not found' }, { status: 404 })
  const role = teamViewerRole(member, registration)
  // Same answer as no such group: this caller learns nothing about whether it exists.
  if (!role) return NextResponse.json({ error: 'Team not found' }, { status: 404 })

  if (!registration.invoice_requested) return NextResponse.json({ applies: false })
  try {
    const summary = await groupInvoiceSummary(db, stripeClient(), id)
    if (!summary) return NextResponse.json({ error: 'Team not found' }, { status: 404 })
    const open = summary.current?.status === 'open'
    const readOnlyNote = impersonating
      ? 'Read-only while viewing as a member.'
      : role === 'student_manager' ? 'Your teacher can add a discount code to the invoice.' : null
    return NextResponse.json({
      applies: true,
      code: summary.discount ? summary.discount.code ?? 'Discount applied by Stellr' : null,
      invoice: summary.current ? { totalCents: summary.current.totalCents, currency: summary.currency, status: summary.current.status, hostedUrl: summary.current.hostedUrl } : null,
      lockedReason: lockedReason(registration, open),
      canChange: !readOnlyNote,
      readOnlyNote,
    })
  } catch (e) {
    console.error('[teams/discount] view failed:', e)
    return NextResponse.json({ error: 'We couldn’t load your invoice. Try again shortly.' }, { status: 502 })
  }
}

// withAudit records every answer but a 4xx. A group's fee is Stripe-billed through Stellr.
const auditSpec = ({ args: [req] }: { args: [Request, unknown] }) => ({
  action: 'registration.invoice_discount.change' as const,
  actor: { session: true } as const,
  tenant: { stellr: true } as const,
  target: { table: 'registrations', id: new URL(req.url).pathname.split('/').at(-2) ?? null },
})

export const POST = withAudit(auditSpec, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  // Tighter than most member writes: a wrong code is a guess at a valid one.
  const limited = await rateLimit(req, 'members/teams/discount', { limit: 10, windowMs: 10 * 60_000, tenantId: (await requestTenant()).tenantId })
  if (limited) return limited

  // Read-only while an admin is viewing as this member (lib/impersonation).
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const db = supabaseServer()
  const [{ data: member }, registration] = await Promise.all([
    db.from('members').select('id, email').eq('clerk_user_id', userId).eq('is_active', true).maybeSingle(),
    loadGroup(db, id),
  ])
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  if (!registration) return NextResponse.json({ error: 'Team not found' }, { status: 404 })

  const role = teamViewerRole(member as { id: string; email: string | null }, registration)
  if (!role) return NextResponse.json({ error: 'Team not found' }, { status: 404 })
  if (role === 'student_manager') {
    return NextResponse.json({ error: 'Your teacher can add a discount code to the invoice.' }, { status: 403 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Enter a discount code.' }, { status: 400 })
  const body = parsed.data

  // Before Stripe is asked anything: the cheap refusals.
  if (!registration.invoice_requested || registration.invoice_paid_at) {
    return NextResponse.json({ error: lockedReason(registration, true) }, { status: 409 })
  }
  const stripe = stripeClient()
  if (!stripe) return NextResponse.json({ error: 'Payments are not configured.' }, { status: 503 })

  let discount = null
  if (body.action !== 'remove') {
    const price = await eventSeatPrice(stripe, registration.event_slug)
    discount = await resolveDiscountCode(stripe, body.code, { promotionCodesOnly: true, productId: price?.productId ?? null }).catch(() => null)
    if (!discount) return NextResponse.json({ error: BAD_CODE }, { status: 404 })
  }

  if (body.action === 'preview') {
    const preview = await previewGroupDiscount(db, stripe, id, discount!)
    if (!preview.ok) return NextResponse.json({ error: preview.error }, { status: 409 })
    return NextResponse.json(preview)
  }

  let result: Awaited<ReturnType<typeof setGroupDiscount>>
  try {
    result = await setGroupDiscount(db, stripe, id, discount, { memberId: member.id as string, label: role })
  } catch (e) {
    console.error('[teams/discount] change failed:', e)
    return NextResponse.json({ error: 'We couldn’t update your invoice. Nothing was changed. Try again shortly, or contact Stellr.' }, { status: 502 })
  }
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 })

  await logActivity({
    memberId: registration.teacher_member_id ?? (member.id as string),
    category: 'billing',
    action: discount ? 'group_invoice_discount_applied' : 'group_invoice_discount_removed',
    summary: discount
      ? `Discount ${discount.label} applied to the group invoice for ${registration.event_slug} by the organizer`
      : `Discount removed from the group invoice for ${registration.event_slug} by the organizer`,
    metadata: { registrationId: id, eventSlug: registration.event_slug, invoiceId: result.invoiceId, couponId: discount?.couponId ?? null },
    ...(await actorFromAuth()),
  }, db)

  return NextResponse.json({ message: result.message, invoiceId: result.invoiceId })
})
