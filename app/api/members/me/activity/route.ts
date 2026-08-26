import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { currentMemberId } from '@/lib/impersonation'

// GET /api/members/me/activity — the signed-in member's own activity log, newest
// first. Fully shared with the admin view, so it returns the same fields. Resolves
// the member from the Clerk session, so a member only ever sees their own entries.
// Query: ?limit (default 30, max 100) & ?before (created_at ISO cursor for paging).

export async function GET(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const db = supabaseServer()
  // Honours an admin view-as session, so the timeline shows the member's own
  // history rather than the admin's.
  const memberId = await currentMemberId(db)
  if (!memberId) return NextResponse.json({ items: [] })

  const url = new URL(req.url)
  const limit = Math.min(Number(url.searchParams.get('limit')) || 30, 100)
  const before = url.searchParams.get('before')

  let q = db
    .from('member_activity_log')
    .select('id, actor_type, actor_label, category, action, summary, metadata, created_at')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (before) q = q.lt('created_at', before)

  const { data, error } = await q
  if (error) {
    console.error('[me activity] fetch error:', error)
    return NextResponse.json({ error: 'Failed to load activity' }, { status: 500 })
  }
  return NextResponse.json({ items: data ?? [] })
}
