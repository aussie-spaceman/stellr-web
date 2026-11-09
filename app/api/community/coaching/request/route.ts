import { NextResponse } from 'next/server'
import { communityWriteBlock } from '@/lib/community'
import { getOnboardedMember } from '@/lib/onboarded-member'
import { requestSession } from '@/lib/coaching'
import { assertNotImpersonating } from '@/lib/impersonation'
import { auditMutation } from '@/lib/audit/route'
import { noteAudit, selfServiceEvent, type SelfServiceAudit } from '@/lib/community/self-service-audit'

// POST — a member requests a coaching session time; the coach is notified.
// Body: { workshopId, preferredDate?, preferredTime?, note? }
export async function POST(req: Request) {
  return audited(req, { action: 'community.coaching_session.request' }, () => requestCoachingSession(req))
}

async function requestCoachingSession(req: Request) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — an admin must never post, book or pay as somebody else.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const member = await getOnboardedMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  // Decision 24: age and guardian-consent restrictions (lib/community).
  const restricted = await communityWriteBlock(member, 'request')
  if (restricted) return restricted

  const { workshopId, preferredDate, preferredTime, note } = await req.json().catch(() => ({}))
  if (!workshopId) return NextResponse.json({ error: 'workshopId is required' }, { status: 400 })

  const ok = await requestSession(member, workshopId, {
    preferredDate: preferredDate ?? null,
    preferredTime: preferredTime ?? null,
    note: note ?? null,
  })
  if (!ok) return NextResponse.json({ error: 'Could not send request' }, { status: 400 })
  noteAudit(req, { table: 'mentoring_cohorts', targetId: workshopId })
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
