import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'
import { getVideoProvider } from '@/lib/video-provider'

// GET /api/community/sessions/[id]/join
// Returns the room URL + a freshly-minted join token. The host (coach/mentor)
// gets a moderator token (recording rights); participants get a guest token.
// Only the host or a participant may join (FR-COM-11/12).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const { id } = await params

  const db = supabaseServer()
  const { data: session } = await db
    .from('sessions')
    .select('id, host_member_id, provider_room, join_url, status')
    .eq('id', id)
    .maybeSingle()
  if (!session || !session.provider_room) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }
  if (session.status === 'cancelled' || session.status === 'declined') {
    return NextResponse.json({ error: 'Session is not active' }, { status: 410 })
  }

  const isHost = session.host_member_id === member.id
  if (!isHost) {
    const { data: p } = await db
      .from('session_participants')
      .select('member_id')
      .eq('session_id', id)
      .eq('member_id', member.id)
      .maybeSingle()
    if (!p) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const provider = getVideoProvider()
  const token = await provider.getJoinToken(
    session.provider_room,
    {
      id: member.id,
      name: [member.first_name, member.last_name].filter(Boolean).join(' ') || 'Member',
      email: member.email,
    },
    isHost
  )

  return NextResponse.json({ joinUrl: session.join_url, token, isHost })
}
