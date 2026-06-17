import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'

interface MemberRel {
  first_name: string | null
  last_name: string | null
  event_role: string | null
}

// GET /api/community/members/mention-search?q=…
// Autocomplete source for @mentions. Only directory-visible (opted-in) members
// are returned — opting out of discoverability also opts out of being mentioned
// (mirrors the privacy gate in lib/mentions.notifyMentions). The dataset of
// opted-in members is small, so we filter the names in memory like the directory
// page does, rather than building a join-table ilike query.
export async function GET(req: Request) {
  const member = await getCurrentMember()
  if (!member) return NextResponse.json({ members: [] }, { status: 401 })

  const q = (new URL(req.url).searchParams.get('q') ?? '').trim().toLowerCase()
  if (!q) return NextResponse.json({ members: [] })

  const db = supabaseServer()
  const { data } = await db
    .from('member_directory_prefs')
    .select('member_id, members!inner(first_name, last_name, event_role)')
    .eq('is_visible', true)
    .limit(500)

  const rows = (data ?? []) as unknown as Array<{
    member_id: string
    members: MemberRel | MemberRel[] | null
  }>

  const results = rows
    .map((r) => {
      const m = Array.isArray(r.members) ? r.members[0] : r.members
      if (!m) return null
      const label = [m.first_name, m.last_name].filter(Boolean).join(' ') || 'Member'
      return { id: r.member_id, label, role: m.event_role }
    })
    .filter((x): x is { id: string; label: string; role: string | null } => !!x)
    .filter((x) => x.id !== member.id && x.label.toLowerCase().includes(q))
    .slice(0, 8)

  return NextResponse.json({ members: results })
}
