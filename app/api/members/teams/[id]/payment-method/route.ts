import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { stripeClient } from '@/lib/stripe'
import { rateLimitGuard } from '@/lib/rate-limit'
import { teamViewerRole, type TeamViewerRegistration } from '@/lib/team-access'
import { assertNotImpersonating, resolveRequestMember } from '@/lib/impersonation'
import { actorFromAuth, logActivity } from '@/lib/activity-log'
import { withAudit } from '@/lib/audit/route'
import { changeGroupPaymentMethod, paymentChangeView, PAYMENT_METHOD_LABEL } from '@/lib/group-payment-change'

// The organizer's view of how their group pays (Account → Teams).
//   GET  → how the group pays now, what each alternative would do, whether this
//          member may change it. Anyone who manages the group can read it.
//   POST { method } → move the group's unpaid balance to that method. The teacher
//          and the Teacher POC only: a student manager manages the roster, but
//          redirecting a school's bill or emailing classmates for money is an
//          adult's call. See lib/group-payment-change.ts.

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

const REG_COLUMNS = 'id, type, event_slug, teacher_member_id, teacher_email, teacher_poc_email, registrant_role'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = supabaseServer()

  const { member, unauthorised, impersonating } = await resolveRequestMember<{ id: string; email: string | null }>(db, 'id, email')
  if (unauthorised) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const { data: registration } = await db.from('registrations').select(REG_COLUMNS).eq('id', id).eq('type', 'group').maybeSingle()
  if (!registration) return NextResponse.json({ error: 'Team not found' }, { status: 404 })

  const role = teamViewerRole(member, registration as unknown as TeamViewerRegistration)
  // Same answer as no such group: this caller learns nothing about whether it exists.
  if (!role) return NextResponse.json({ error: 'Team not found' }, { status: 404 })

  try {
    const view = await paymentChangeView(db, stripeClient(), id)
    if (!view) return NextResponse.json({ error: 'Team not found' }, { status: 404 })
    const readOnlyNote = impersonating
      ? 'Read-only while viewing as a member.'
      : role === 'student_manager' ? 'Your teacher can change how the group pays.' : null
    return NextResponse.json({ ...view, canChange: !readOnlyNote, readOnlyNote })
  } catch (e) {
    console.error('[teams/payment-method] view failed:', e)
    return NextResponse.json({ error: 'We couldn’t load your group’s payment details. Try again shortly.' }, { status: 502 })
  }
}

export const POST = withAudit(auditSpec, async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const limited = rateLimitGuard(req, 'members/teams/payment-method', { limit: 10, windowMs: 10 * 60_000 })
  if (limited) return limited

  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — see lib/impersonation.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const db = supabaseServer()

  const [{ data: member }, { data: registration }] = await Promise.all([
    db.from('members').select('id, email').eq('clerk_user_id', userId).eq('is_active', true).maybeSingle(),
    db.from('registrations').select(REG_COLUMNS).eq('id', id).eq('type', 'group').maybeSingle(),
  ])
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  if (!registration) return NextResponse.json({ error: 'Team not found' }, { status: 404 })

  const role = teamViewerRole(member, registration as unknown as TeamViewerRegistration)
  // Same answer as no such group: this caller learns nothing about whether it exists.
  if (!role) return NextResponse.json({ error: 'Team not found' }, { status: 404 })
  if (role === 'student_manager') {
    return NextResponse.json({ error: 'Your teacher can change how the group pays.' }, { status: 403 })
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Choose a payment method' }, { status: 400 })
  const stripe = stripeClient()
  if (!stripe) return NextResponse.json({ error: 'Payments are not configured.' }, { status: 503 })

  const result = await changeGroupPaymentMethod(db, stripe, id, parsed.data.method, {
    memberId: member.id as string,
    label: role,
    by: 'organizer',
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  const teacherMemberId = registration.teacher_member_id as string | null
  await logActivity({
    memberId: teacherMemberId ?? (member.id as string),
    category: 'billing',
    action: 'group_payment_method_changed',
    summary: `Group payment method changed to "${PAYMENT_METHOD_LABEL[result.method]}" for ${registration.event_slug}`,
    metadata: { registrationId: id, eventSlug: registration.event_slug, method: result.method },
    ...(await actorFromAuth()),
  }, db)

  return NextResponse.json({ message: result.message, method: result.method, payUrl: result.payUrl })
})
