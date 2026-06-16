import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'

// GET /api/admin/members/[id]/activity — the member's activity log, newest first.
// Query: ?limit (default 30, max 100) & ?before (created_at ISO cursor for paging).

function isAdmin(sessionClaims: unknown) {
  return (sessionClaims as { metadata?: { role?: string } } | null)?.metadata?.role === 'admin'
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: memberId } = await params
  const url = new URL(req.url)
  const limit = Math.min(Number(url.searchParams.get('limit')) || 30, 100)
  const before = url.searchParams.get('before')

  let q = supabaseServer()
    .from('member_activity_log')
    .select('id, actor_type, actor_label, category, action, summary, metadata, created_at')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (before) q = q.lt('created_at', before)

  const { data, error } = await q
  if (error) {
    console.error('[admin activity] fetch error:', error)
    return NextResponse.json({ error: 'Failed to load activity' }, { status: 500 })
  }
  return NextResponse.json({ items: data ?? [] })
}
