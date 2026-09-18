import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { currentUserIsAdmin } from '@/lib/admin-auth'

// Admin member search for pickers (cohorts, delegations, staff roles, …).
// Returns a small set of matches by name or email so admins reference the real
// member database instead of typing an exact email that silently misses.
export async function GET(req: Request) {
  if (!(await currentUserIsAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const q = (new URL(req.url).searchParams.get('q') ?? '').trim()
  if (q.length < 2) return NextResponse.json({ members: [] })

  const like = `%${q.replace(/[%_,]/g, '')}%` // strip PostgREST/LIKE metacharacters
  const db = supabaseServer()
  const { data, error } = await db
    .from('members')
    .select('id, first_name, last_name, email, membership_id')
    .or(`first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like}`)
    .order('last_name', { ascending: true })
    .limit(10)

  if (error) {
    console.error('[members/search] error:', error)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
  return NextResponse.json({ members: data ?? [] })
}
