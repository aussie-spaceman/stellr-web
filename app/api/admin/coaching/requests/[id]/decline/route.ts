import { NextResponse } from 'next/server'
import { declineRequest } from '@/lib/coaching-requests'
import { isStellrAdmin } from '@/lib/authz'
import { withAudit } from '@/lib/audit/route'

// What this request acted on, which withAudit's spec cannot read for itself: the body has gone.
const auditedId = new WeakMap<Request, string>()

export const POST = withAudit(
  ({ args: [req] }) => ({
    action: 'coaching.request.decline',
    actor: { session: true },
    tenant: { stellr: true },
    target: { table: 'coaching_requests', id: auditedId.get(req) ?? null },
  }),
  declineCoachingRequest,
)

// Admin: decline a coaching request with a reason (surfaced to the member).
async function declineCoachingRequest(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isStellrAdmin({ route: '/api/admin/coaching/requests/[id]/decline' }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  auditedId.set(req, id)
  const body = await req.json().catch(() => ({}))
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''

  const result = await declineRequest(id, reason)
  if (!result.ok) return NextResponse.json({ error: result.error ?? 'Could not decline' }, { status: 400 })
  return NextResponse.json({ ok: true })
}
