import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/community'
import { flagMessage } from '@/lib/sessions'

// POST /api/community/chat/flag — a member flags a chat message to the channel's
// moderator (mentor / coach). Body: { messageId }.
export async function POST(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { messageId } = await req.json().catch(() => ({}))
  if (!messageId) return NextResponse.json({ error: 'messageId required' }, { status: 400 })

  const ok = await flagMessage(messageId, member.id)
  if (!ok) return NextResponse.json({ error: 'Could not flag message' }, { status: 400 })
  return NextResponse.json({ ok: true })
}
