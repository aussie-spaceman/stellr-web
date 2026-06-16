import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'

// GET /api/members/me/activity — the signed-in member's own activity log, newest
// first. Fully shared with the admin view, so it returns the same fields. Resolves
// the member from the Clerk session, so a member only ever sees their own entries.
// Query: ?limit (default 30, max 100) & ?before (created_at ISO cursor for paging).

export async function GET(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const db = supabaseServer()
  const { data: member } = await db
    .from('members')
    .select('id')
    .eq('clerk_user_id', userId)
    .maybeSingle()
  if (!member) return NextResponse.json({ items: [] })

  const url = new URL(req.url)
  const limit = Math.min(Number(url.searchParams.get('limit')) || 30, 100)
  const before = url.searchParams.get('before')

  let q = db
    .from('member_activity_log')
    .select('id, actor_type, actor_label, category, action, summary, metadata, created_at')
    .eq('member_id', member.id)
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
