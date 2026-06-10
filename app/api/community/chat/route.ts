import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/community'
import { canAccessChannel, listMessages, postMessage } from '@/lib/sessions'

// Persistent chat for mentoring cohorts + 1:1 coaching (FR-COM-11/12).
// Channels outlive any single session. Access is guarded per channel.

// GET /api/community/chat?channelId=…  → messages
export async function GET(req: Request) {
  const member = await getCurrentMember()
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
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { channelId, body } = await req.json().catch(() => ({}))
  if (!channelId || !body) return NextResponse.json({ error: 'channelId and body required' }, { status: 400 })
  if (!(await canAccessChannel(channelId, member.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const ok = await postMessage(channelId, member.id, body)
  if (!ok) return NextResponse.json({ error: 'Could not send' }, { status: 400 })
  return NextResponse.json({ ok: true })
}
