import { NextResponse } from 'next/server'
import { getCurrentMember } from '@/lib/community'
import { getHostCaps } from '@/lib/sessions'
import { supabaseServer } from '@/lib/supabase'
import { isStudentForAds } from '@/lib/no-ads'
import { rateLimitGuard, HOUR_MS } from '@/lib/rate-limit'

// Member search for the mentor invite picker. Gated to mentors + admins so the
// member directory isn't exposed to every signed-in member. Returns a small set
// of matches by name or email.
//
// deep review MP-6: the picker only needs an id + display name. It must NOT
// hand out personal email addresses, and must not surface minors or deactivated
// members. The emails of students (minors) are safeguarding-sensitive contact
// details, so:
//   • the response carries id + name only — never `email`;
//   • only active members are returned (`is_active`);
//   • anyone who could be a minor is filtered out (isStudentForAds errs towards
//     "student": under 18, high-school bracket, or an unknown DOB);
//   • the search is rate-limited per caller so a host can't iterate the
//     alphabet to enumerate the membership.
export async function GET(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  const caps = await getHostCaps(member.id)
  if (!member.isAdmin && !caps.canMentor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Per-caller cap (sub-keyed by member id): a mentor/admin querying q=aa, q=ab…
  // to harvest names is slowed to a trickle; a genuine type-ahead stays well under.
  const limited = rateLimitGuard(req, 'member-search', { limit: 40, windowMs: HOUR_MS }, member.id)
  if (limited) return limited

  const q = (new URL(req.url).searchParams.get('q') ?? '').trim()
  if (q.length < 2) return NextResponse.json({ members: [] })

  const like = `%${q.replace(/[%_,]/g, '')}%`
  const db = supabaseServer()
  const { data, error } = await db
    .from('members')
    // date_of_birth + age_bracket are selected only to exclude minors below; they
    // are never returned to the client.
    .select('id, first_name, last_name, date_of_birth, age_bracket')
    .eq('is_active', true)
    .or(`first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like}`)
    .order('last_name', { ascending: true })
    .limit(20)
  // Fail closed: a read error returns nothing rather than leaking on a retry.
  if (error) return NextResponse.json({ error: 'Search failed' }, { status: 500 })

  const members = (data ?? [])
    .filter((m) => !isStudentForAds({ date_of_birth: m.date_of_birth ?? null, age_bracket: m.age_bracket ?? null }))
    .slice(0, 10)
    .map((m) => ({ id: m.id, first_name: m.first_name, last_name: m.last_name }))
  return NextResponse.json({ members })
}
