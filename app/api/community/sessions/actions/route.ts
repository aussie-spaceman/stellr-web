import { NextResponse } from 'next/server'
import { getOnboardedMember } from '@/lib/onboarded-member'
import { toggleAction } from '@/lib/sessions'
import { assertNotImpersonating } from '@/lib/impersonation'
import { auditMutation } from '@/lib/audit/route'
import { noteAudit, selfServiceEvent, type SelfServiceAudit } from '@/lib/community/self-service-audit'

// POST /api/community/sessions/actions — member checks an action done/undone.
// Body: { actionId, done }
export async function POST(req: Request) {
  return audited(req, { action: 'community.session_action.toggle', table: 'session_actions' }, () => toggleSessionAction(req))
}

async function toggleSessionAction(req: Request) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — an admin must never post, book or pay as somebody else.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const member = await getOnboardedMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { actionId, done } = await req.json().catch(() => ({}))
  if (!actionId || typeof done !== 'boolean') {
    return NextResponse.json({ error: 'actionId and done required' }, { status: 400 })
  }
  const ok = await toggleAction(actionId, member.id, done)
  if (!ok) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  noteAudit(req, { targetId: actionId, metadata: { done } })
  return NextResponse.json({ ok: true })
}

// The audit event for this route (docs/TENANCY-S5.md, B16): written after the response,
// never for a 4xx, ids and short codes only. lib/community/self-service-audit decides
// what is written; the call stays here because the coverage gate reads it here.
async function audited(req: Request, spec: SelfServiceAudit, run: () => Promise<Response>): Promise<Response> {
  let res: Response | undefined
  try {
    return (res = await run())
  } finally {
    await record(req, res, spec)
  }
}

async function record(req: Request, res: Response | undefined, spec: SelfServiceAudit) {
  const event = await selfServiceEvent(req, res, spec)
  if (!event) return
  await auditMutation(event, { afterResponse: true })
}
