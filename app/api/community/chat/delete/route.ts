import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/community'
import { deleteMessage } from '@/lib/sessions'

// POST /api/community/chat/delete — the channel moderator (mentor / coach)
// soft-deletes a message. Body: { messageId }.
export async function POST(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { messageId } = await req.json().catch(() => ({}))
  if (!messageId) return NextResponse.json({ error: 'messageId required' }, { status: 400 })

  const ok = await deleteMessage(messageId, member.id)
  if (!ok) return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  return NextResponse.json({ ok: true })
}
