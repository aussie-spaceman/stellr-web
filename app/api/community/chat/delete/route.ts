import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/community'
import { deleteMessage } from '@/lib/sessions'
import { assertNotImpersonating } from '@/lib/impersonation'

// POST /api/community/chat/delete — the channel moderator (mentor / coach)
// soft-deletes a message. Body: { messageId }.
export async function POST(req: Request) {
  // Read-only while an admin is viewing as this member. Impersonation is a lens,
  // not a login — an admin must never post, book or pay as somebody else.
  const impersonationBlock = await assertNotImpersonating()
  if (impersonationBlock) return impersonationBlock

  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { messageId } = await req.json().catch(() => ({}))
  if (!messageId) return NextResponse.json({ error: 'messageId required' }, { status: 400 })

  const ok = await deleteMessage(messageId, member.id)
  if (!ok) return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  return NextResponse.json({ ok: true })
}
