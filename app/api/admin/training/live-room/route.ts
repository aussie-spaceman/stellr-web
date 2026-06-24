import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'
import { getVideoProvider, getEmbedConfig, trainingRoomName } from '@/lib/video-provider'

// GET /api/admin/training/live-room?itemId=
// Mints a HOST (moderator/recorder) token for a 'live' (Record) lesson's JaaS
// room so an admin can launch and record the session directly from the Course
// builder. The room name is derived from the item id (same as the member player
// + recording webhook), so the recording attaches to this lesson.

async function requireAdmin() {
  const { sessionClaims } = await auth()
  return (sessionClaims?.metadata as { role?: string } | undefined)?.role === 'admin'
}

export async function GET(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const itemId = new URL(req.url).searchParams.get('itemId')
  if (!itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 })

  const db = supabaseServer()
  const { data: item } = await db
    .from('training_items')
    .select('id, content_kind, title')
    .eq('id', itemId)
    .maybeSingle()
  if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (item.content_kind !== 'live') {
    return NextResponse.json({ error: 'This lesson is not a Record (live) lesson' }, { status: 400 })
  }

  const member = await getCurrentMember()
  const displayName = [member?.first_name, member?.last_name].filter(Boolean).join(' ') || 'Stellr Admin'
  const room = trainingRoomName(itemId)
  const jwt = await getVideoProvider().getJoinToken(
    room,
    { id: member?.id ?? 'admin', name: displayName, email: member?.email ?? '' },
    true // host / recorder
  )
  const embed = getEmbedConfig(room)
  return NextResponse.json({
    domain: embed.domain,
    scriptSrc: embed.scriptSrc,
    roomName: embed.roomName,
    jwt,
    displayName,
    configured: embed.configured,
  })
}
