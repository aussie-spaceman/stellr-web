import { NextResponse } from 'next/server'
import { communityWriteBlock } from '@/lib/community'
import { getOnboardedMember } from '@/lib/onboarded-member'
import { createCoachingRequest } from '@/lib/coaching-requests'
import { assertNotImpersonating } from '@/lib/impersonation'
import { auditMutation } from '@/lib/audit/route'
import { noteAudit, selfServiceEvent, type SelfServiceAudit } from '@/lib/community/self-service-audit'

// Create a member-initiated coaching request (public /academy/coaching/request
// intake submits here). Auth is enforced at submit: a guest gets 401 and the
// form routes them through sign-in, preserving the payload to resume.
export async function POST(req: Request) {
  return audited(req, { action: 'community.coaching_request.create', table: 'coaching_requests' }, () => createRequest(req))
}

async function createRequest(req: Request) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — an admin must never post, book or pay as somebody else.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const member = await getOnboardedMember()
  if (!member) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  // Decision 24: age and guardian-consent restrictions (lib/community).
  const restricted = await communityWriteBlock(member, 'request')
  if (restricted) return restricted

  const body = await req.json().catch(() => ({}))
  const topic = typeof body?.topic === 'string' ? body.topic : ''
  if (!topic.trim()) return NextResponse.json({ error: 'Please tell us what you would like coaching on.' }, { status: 400 })

  const availability = Array.isArray(body?.availability)
    ? body.availability.filter((a: unknown): a is string => typeof a === 'string').slice(0, 8)
    : []

  const result = await createCoachingRequest(member, {
    topic,
    stage: typeof body?.stage === 'string' ? body.stage : null,
    focusArea: typeof body?.focusArea === 'string' ? body.focusArea : null,
    availability,
    note: typeof body?.note === 'string' ? body.note : null,
  })

  if (!result.ok) return NextResponse.json({ error: result.error ?? 'Could not submit request' }, { status: 400 })
  noteAudit(req, { targetId: result.requestId ?? null, metadata: { already_exists: result.alreadyExists ?? false } })
  return NextResponse.json({ ok: true, requestId: result.requestId, alreadyExists: result.alreadyExists ?? false })
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
