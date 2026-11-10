import { NextResponse } from 'next/server'
import { requireEventStaff, staffCoversEvent } from '@/lib/authz'
import { withAudit } from '@/lib/audit/route'
import { supabaseServer } from '@/lib/supabase'
import { stripeClient } from '@/lib/stripe'
import { actorFromAuth, logActivity } from '@/lib/activity-log'
import { changeGroupPaymentMethod, paymentChangeView, PAYMENT_METHOD_LABEL } from '@/lib/group-payment-change'
import { paymentChangeBody } from '@/lib/group-payment-change-body'
import { loadEventRecord, refuseOutsideStellr } from '@/lib/tenancy/load-scoped'

// "Payment method…" on a group in the event roster.
//   GET  → how the group pays now, and what each alternative would do.
//   POST { method, invoiceParticipantIds?, lateJoinerPayer? } → move the group's
//   unpaid balance to that method (the two extras for "Invoice for some").
// Open to admins and to event managers assigned to the event, reading and changing.
// See lib/group-payment-change.ts.

// Up to a Checkout sweep, an invoice void, and one email per person on the roster.
export const maxDuration = 120

const ROUTE = '/api/admin/registrations/[id]/payment-method'

type Db = ReturnType<typeof supabaseServer>
type Args = [Request, { params: Promise<{ id: string }> }]

const notFound = () => NextResponse.json({ error: 'Group registration not found' }, { status: 404 })

type GroupRow = { event_slug: string; type: string | null; teacher_member_id: string | null; tenant_id?: string | null }

async function guard(db: Db, id: string, req: Request) {
  const staff = await requireEventStaff({ route: ROUTE })
  if (!staff.ok) return NextResponse.json({ error: 'Forbidden' }, { status: staff.status })
  audited.set(req, { id, userId: staff.userId, tenantId: staff.tenantId })
  const loaded = await loadEventRecord<GroupRow>(staff, 'registrations', id, {
    db,
    select: 'event_slug, type, teacher_member_id, tenant_id',
    notFound,
    label: ROUTE,
  })
  if (!loaded.ok) return loaded.response
  if (loaded.row.type !== 'group') return notFound()
  // A group stamped with another tenant, or whose event the mirror places in another tenant,
  // answers as a missing one in every mode, as does a failed read of the event. The event
  // check is the one this route made before; the stamp check adds to it.
  if (loaded.row.tenant_id && loaded.row.tenant_id !== staff.tenantId) return notFound()
  if (!(await staffCoversEvent(staff, loaded.row.event_slug))) return notFound()
  // Both the view and the change read or move the group's billing on Stellr's Stripe account.
  const refused = refuseOutsideStellr(staff.scope)
  if (refused) return refused
  const a = audited.get(req)
  if (a) a.eventSlug = loaded.row.event_slug
  return { slug: loaded.row.event_slug, teacherMemberId: loaded.row.teacher_member_id ?? null }
}

// What this request acted on, which withAudit's spec cannot read for itself. withAudit records
// every answer but a 4xx, including a 5xx after a partial change.
const audited = new WeakMap<
  Request,
  { id: string; userId: string; tenantId: string; eventSlug?: string; method?: string; invoiceParticipantCount?: number }
>()

// A 5xx before the staff check names no caller yet: the row is the URL's, and its chain is
// marked as unresolved rather than shown as a deliberate platform event.
function eventFor(req: Request) {
  const a = audited.get(req)
  return {
    actor: a ? { userId: a.userId } : { session: true as const },
    tenant: { tenantId: a?.tenantId ?? null },
    target: { table: 'registrations', id: a?.id ?? new URL(req.url).pathname.split('/').at(-2) ?? null },
    metadata: {
      eventSlug: a?.eventSlug ?? null,
      method: a?.method ?? null,
      ...(a?.invoiceParticipantCount != null ? { invoiceParticipantCount: a.invoiceParticipantCount } : {}),
      ...(a ? {} : { tenant_unresolved: true }),
    },
  }
}

// The view hands this client to the group billing helpers, so it is audited as the invoice
// route's read is.
export const GET = withAudit(({ args: [req] }: { args: Args }) => ({ action: 'registration.payment_method.read', ...eventFor(req) }), readPaymentMethod)

async function readPaymentMethod(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = supabaseServer()
  const g = await guard(db, id, req)
  if (g instanceof Response) return g
  try {
    const view = await paymentChangeView(db, stripeClient(), id)
    if (!view) return notFound()
    return NextResponse.json(view)
  } catch (e) {
    console.error('[admin/payment-method] view failed:', e)
    return NextResponse.json({ error: 'Could not read this group’s billing from Stripe. Try again shortly.' }, { status: 502 })
  }
}

export const POST = withAudit(({ args: [req] }: { args: Args }) => ({ action: 'registration.payment_method.change', ...eventFor(req) }), changePaymentMethod)

async function changePaymentMethod(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = supabaseServer()
  const g = await guard(db, id, req)
  if (g instanceof Response) return g

  const parsed = paymentChangeBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Choose a payment method' }, { status: 400 })
  // The method, and for "Invoice for some" how many are on the invoice: a count, not who.
  const event = audited.get(req)
  if (event) {
    event.method = parsed.data.method
    if (parsed.data.invoiceParticipantIds) event.invoiceParticipantCount = parsed.data.invoiceParticipantIds.length
  }
  const stripe = stripeClient()
  if (!stripe) return NextResponse.json({ error: 'Stripe is not configured here' }, { status: 503 })

  const actor = await actorFromAuth()
  const result = await changeGroupPaymentMethod(db, stripe, id, parsed.data, {
    memberId: actor.actorMemberId ?? null,
    label: 'admin',
    by: 'staff',
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  if (g.teacherMemberId) {
    await logActivity({
      memberId: g.teacherMemberId,
      category: 'billing',
      action: 'group_payment_method_changed',
      summary: `Group payment method changed to "${PAYMENT_METHOD_LABEL[result.method]}" for ${g.slug}`,
      metadata: { registrationId: id, eventSlug: g.slug, method: result.method },
      ...actor,
    }, db)
  }
  return NextResponse.json({ message: result.message, method: result.method })
}
