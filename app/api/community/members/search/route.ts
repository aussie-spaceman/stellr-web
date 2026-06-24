import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/community'
import { getHostCaps } from '@/lib/sessions'
import { supabaseServer } from '@/lib/supabase'

// Member search for the mentor invite picker. Gated to mentors + admins so the
// member directory isn't exposed to every signed-in member. Returns a small set
// of matches by name or email.
export async function GET(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const caps = await getHostCaps(member.id)
  if (!member.isAdmin && !caps.canMentor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const q = (new URL(req.url).searchParams.get('q') ?? '').trim()
  if (q.length < 2) return NextResponse.json({ members: [] })

  const like = `%${q.replace(/[%_,]/g, '')}%`
  const db = supabaseServer()
  const { data, error } = await db
    .from('members')
    .select('id, first_name, last_name, email')
    .or(`first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like}`)
    .order('last_name', { ascending: true })
    .limit(10)
  if (error) return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  return NextResponse.json({ members: data ?? [] })
}
