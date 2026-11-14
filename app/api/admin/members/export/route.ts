import { hasCapability } from '@/lib/authz'
import { withAudit } from '@/lib/audit/route'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { toCsv } from '@/lib/csv'
import { logRecordAccess } from '@/lib/record-access-log'
import { applyMemberFilters, applyMemberSort, memberFilterEmbeds, parseMemberFilters } from '@/lib/admin-member-filters'

// Takes the members list's filter params (lib/admin-member-filters), so the
// export is exactly the filtered list on screen. No params: every active member.
async function exportMembers(req: Request) {
  if (!(await hasCapability('export'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const filters = parseMemberFilters(Object.fromEntries(new URL(req.url).searchParams))
  const db = supabaseServer()
  const query = db
    .from('members')
    .select(`
      member_code, first_name, last_name, nickname, email, phone,
      date_of_birth, gender, age_bracket, event_role, grade, tshirt_size,
      discord_handle, health_conditions, is_active, created_at,
      member_memberships(renewal_status, started_at, expires_at, membership_tiers(name)),
      member_schools(is_current, schools(name, city, state)),
      event_participations(event_year, event_location, team_name, award)${memberFilterEmbeds(filters)}
    `)
    .eq('is_active', true)
    // An explicit range defeats PostgREST's default 1000-row cap.
    .range(0, 99_999)
  const { data } = await applyMemberSort(applyMemberFilters(query, filters), filters)

  if (!data) return NextResponse.json({ error: 'No data' }, { status: 500 })
  // The filter embeds make the select string dynamic, which supabase-js can't type.
  const members = data as unknown as Array<Record<string, string | null> & {
    member_memberships: unknown
    member_schools: unknown
  }>

  const headers = [
    'member_code', 'first_name', 'last_name', 'nickname', 'email', 'phone',
    'date_of_birth', 'gender', 'age_bracket', 'event_role', 'grade', 'tshirt_size',
    'discord_handle', 'health_conditions', 'current_school', 'membership_tier',
    'membership_status', 'membership_started', 'membership_expires', 'created_at',
  ]

  const rows = members.map((m) => {
    const activeMembership = (m.member_memberships as unknown as Array<{
      renewal_status: string; started_at: string; expires_at: string | null
      membership_tiers: { name: string }
    }>)?.find((mm) => mm.renewal_status === 'active')

    const currentSchool = (m.member_schools as unknown as Array<{
      is_current: boolean; schools: { name: string }
    }>)?.find((s) => s.is_current)?.schools?.name

    return [
      m.member_code ?? '',
      m.first_name, m.last_name, m.nickname ?? '',
      m.email, m.phone ?? '',
      m.date_of_birth, m.gender,
      m.age_bracket, m.event_role,
      m.grade ?? '', m.tshirt_size ?? '',
      m.discord_handle ?? '', m.health_conditions ?? '',
      currentSchool ?? '',
      activeMembership?.membership_tiers?.name ?? '',
      activeMembership?.renewal_status ?? '',
      activeMembership?.started_at ?? '',
      activeMembership?.expires_at ?? '',
      m.created_at,
    ]
  })

  const csv = toCsv([headers, ...rows])
  // Every member export is logged, with which filters made it (keys only) (Staff role phase 4).
  await logRecordAccess({ action: 'export', route: '/api/admin/members/export', rowCount: rows.length, detail: { kind: 'members_csv', filters: Object.keys(Object.fromEntries(new URL(req.url).searchParams)).sort().join(',') || 'none' } })

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="stellr-members-${new Date().toISOString().split('T')[0]}.csv"`,
    },
  })
}

// Every export is audited (and in record_access_log): the CSV holds personal data (Staff role phase 4).
export const GET = withAudit(
  () => ({ action: 'export.members' as const, actor: { session: true } as const, tenant: { stellr: true } as const, target: null }),
  exportMembers,
)
