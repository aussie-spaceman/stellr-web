import { NextResponse } from 'next/server'
import { matchRequest, type CoachingEligibility } from '@/lib/coaching-requests'
import { isStellrAdmin } from '@/lib/authz'
import { withAudit } from '@/lib/audit/route'

// What this request acted on, which withAudit's spec cannot read for itself: the body has gone.
const auditedId = new WeakMap<Request, string>()

const ELIGIBILITIES: CoachingEligibility[] = ['included', 'award', 'paid']

export const POST = withAudit(
  ({ args: [req] }) => ({
    action: 'coaching.request.match',
    actor: { session: true },
    tenant: { stellr: true },
    target: { table: 'coaching_requests', id: auditedId.get(req) ?? null },
  }),
  matchCoachingRequest,
)

// Admin: match a coach to a pending coaching request + resolve eligibility.
async function matchCoachingRequest(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isStellrAdmin({ route: '/api/admin/coaching/requests/[id]/match' }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  auditedId.set(req, id)
  const body = await req.json().catch(() => ({}))
  const coachId = typeof body?.coachId === 'string' ? body.coachId : ''
  const eligibility = body?.eligibility as CoachingEligibility
  if (!coachId) return NextResponse.json({ error: 'Select a coach.' }, { status: 400 })
  if (!ELIGIBILITIES.includes(eligibility)) return NextResponse.json({ error: 'Select an eligibility.' }, { status: 400 })

  const result = await matchRequest(id, coachId, eligibility)
  // An award already granted is a write, so it answers as a failure that withAudit records.
  if (!result.ok) return NextResponse.json({ error: result.error ?? 'Could not match' }, { status: result.awardGranted ? 500 : 400 })
  return NextResponse.json({ ok: true })
}
