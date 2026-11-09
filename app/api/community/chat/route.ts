import { NextResponse } from 'next/server'
import { communityWriteBlock } from '@/lib/community'
import { getOnboardedMember } from '@/lib/onboarded-member'
import { canAccessChannel, canPostToChannel, listMessages, postMessage } from '@/lib/sessions'
import { assertNotImpersonating } from '@/lib/impersonation'
import { auditMutation } from '@/lib/audit/route'
import { noteAudit, selfServiceEvent, type SelfServiceAudit } from '@/lib/community/self-service-audit'

// Persistent chat for mentoring cohorts + 1:1 coaching (FR-COM-11/12).
// Channels outlive any single session. Access is guarded per channel.

// GET /api/community/chat?channelId=…  → messages
export async function GET(req: Request) {
  const member = await getOnboardedMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const channelId = new URL(req.url).searchParams.get('channelId')
  if (!channelId) return NextResponse.json({ error: 'channelId required' }, { status: 400 })
  if (!(await canAccessChannel(channelId, member.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const messages = await listMessages(channelId)
  return NextResponse.json({ messages })
}

// POST /api/community/chat  Body: { channelId, body }
export async function POST(req: Request) {
  return audited(req, { action: 'community.chat_message.create', table: 'chat_messages' }, () => postChatMessage(req))
}

async function postChatMessage(req: Request) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — an admin must never post, book or pay as somebody else.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const member = await getOnboardedMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  // Decision 24: age and guardian-consent restrictions (lib/community).
  const restricted = await communityWriteBlock(member, 'chat')
  if (restricted) return restricted

  const { channelId, body } = await req.json().catch(() => ({}))
  if (!channelId || !body) return NextResponse.json({ error: 'channelId and body required' }, { status: 400 })
  // deep review MEM-8: posting (not just reading) must honour a space mute /
  // posting suspension / moderators-only policy. canPostToChannel adds those on
  // top of read access; it is identical to canAccessChannel for cohort/coaching.
  if (!(await canPostToChannel(channelId, member.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  noteAudit(req, { table: 'chat_channels', targetId: channelId })
  const ok = await postMessage(channelId, member.id, body)
  if (!ok) return NextResponse.json({ error: 'Could not send' }, { status: 400 })
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
