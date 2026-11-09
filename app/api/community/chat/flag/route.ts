import { NextResponse } from 'next/server'
import { getOnboardedMember } from '@/lib/onboarded-member'
import { flagMessage } from '@/lib/sessions'
import { assertNotImpersonating } from '@/lib/impersonation'
import { auditMutation } from '@/lib/audit/route'
import { noteAudit, selfServiceEvent, type SelfServiceAudit } from '@/lib/community/self-service-audit'

// POST /api/community/chat/flag — a member flags a chat message to the channel's
// moderator (mentor / coach). Body: { messageId }.
export async function POST(req: Request) {
  return audited(req, { action: 'community.chat_message.flag', table: 'chat_messages' }, () => flagChatMessage(req))
}

async function flagChatMessage(req: Request) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — an admin must never post, book or pay as somebody else.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const member = await getOnboardedMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { messageId } = await req.json().catch(() => ({}))
  if (!messageId) return NextResponse.json({ error: 'messageId required' }, { status: 400 })

  const ok = await flagMessage(messageId, member.id)
  if (!ok) return NextResponse.json({ error: 'Could not flag message' }, { status: 400 })
  noteAudit(req, { targetId: messageId })
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
