import { NextResponse } from 'next/server'
import { z } from 'zod'
import { accessCoversEvent, requireEventAccess } from '@/lib/authz'
import { withAudit } from '@/lib/audit/route'
import { supabaseServer } from '@/lib/supabase'
import { stripeClient } from '@/lib/stripe'
import { actorFromAuth, logActivity } from '@/lib/activity-log'
import { changeGroupPaymentMethod, paymentChangeView, PAYMENT_METHOD_LABEL } from '@/lib/group-payment-change'

// "Payment method…" on a group in the event roster.
//   GET  → how the group pays now, and what each alternative would do.
//   POST { method } → move the group's unpaid balance to that method.
// Open to admins and to event managers assigned to the event.
// See lib/group-payment-change.ts.

// Up to a Checkout sweep, an invoice void, and one email per person on the roster.
export const maxDuration = 120

const bodySchema = z.object({ method: z.enum(['invoice', 'card', 'individual']) })

// withAudit records every answer but a 4xx, including a 5xx after a partial change.
// A group's fee is Stripe-billed through Stellr, so a change that did anything is on
// Stellr's chain (a tenant's priced events are refused at registration).
const auditSpec = ({ args: [req] }: { args: [Request, unknown] }) => ({
  action: 'registration.payment_method.change' as const,
  actor: { session: true } as const,
  tenant: { stellr: true } as const,
  target: { table: 'registrations', id: new URL(req.url).pathname.split('/').at(-2) ?? null },
})

type Db = ReturnType<typeof supabaseServer>

async function guard(db: Db, id: string) {
  const access = await requireEventAccess()
  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })
  const { data: reg } = await db.from('registrations').select('event_slug, type, teacher_member_id').eq('id', id).maybeSingle()
  if (!reg || reg.type !== 'group') return NextResponse.json({ error: 'Group registration not found' }, { status: 404 })
  // Same answer as no such group: this caller learns nothing about whether it exists.
  if (!(await accessCoversEvent(access, reg.event_slug as string))) {
    return NextResponse.json({ error: 'Group registration not found' }, { status: 404 })
  }
  return { slug: reg.event_slug as string, teacherMemberId: (reg.teacher_member_id as string | null) ?? null }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = supabaseServer()
  const g = await guard(db, id)
  if (g instanceof NextResponse) return g
  try {
    const view = await paymentChangeView(db, stripeClient(), id)
    if (!view) return NextResponse.json({ error: 'Group registration not found' }, { status: 404 })
    return NextResponse.json(view)
  } catch (e) {
    console.error('[admin/payment-method] view failed:', e)
    return NextResponse.json({ error: 'Could not read this group’s billing from Stripe. Try again shortly.' }, { status: 502 })
  }
}

export const POST = withAudit(auditSpec, async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const db = supabaseServer()
  const g = await guard(db, id)
  if (g instanceof NextResponse) return g

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Choose a payment method' }, { status: 400 })
  const stripe = stripeClient()
  if (!stripe) return NextResponse.json({ error: 'Stripe is not configured here' }, { status: 503 })

  const actor = await actorFromAuth()
  const result = await changeGroupPaymentMethod(db, stripe, id, parsed.data.method, {
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
})
