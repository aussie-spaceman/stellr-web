import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'

// GET /api/community/notifications — last 20 notifications for the current member.
// ?unread=1 returns only the unread count (used by the polling bell).
export async function GET(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const db = supabaseServer()

  if (searchParams.get('unread') === '1') {
    const { count } = await db
      .from('community_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_member_id', member.id)
      .eq('is_read', false)
    return NextResponse.json({ count: count ?? 0 })
  }

  const { data } = await db
    .from('community_notifications')
    .select(`
      id, type, reference_type, reference_id, body, is_read, created_at,
      actor:actor_member_id(first_name, last_name)
    `)
    .eq('recipient_member_id', member.id)
    .order('created_at', { ascending: false })
    .limit(20)

  return NextResponse.json({ notifications: data ?? [] })
}

// POST /api/community/notifications/read-all — mark all as read
export async function POST() {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const db = supabaseServer()
  await db
    .from('community_notifications')
    .update({ is_read: true })
    .eq('recipient_member_id', member.id)
    .eq('is_read', false)

  return NextResponse.json({ ok: true })
}
