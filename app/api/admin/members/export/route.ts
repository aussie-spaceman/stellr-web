import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'

export async function GET() {
  const { sessionClaims } = await auth()
  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role
  if (role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = supabaseServer()
  const { data: members } = await db
    .from('members')
    .select(`
      member_code, first_name, last_name, nickname, email, phone,
      date_of_birth, gender, age_bracket, event_role, grade, tshirt_size,
      discord_handle, health_conditions, is_active, created_at,
      member_memberships(renewal_status, started_at, expires_at, membership_tiers(name)),
      member_schools(is_current, schools(name, city, state)),
      event_participations(event_year, event_location, team_name, award)
    `)
    .eq('is_active', true)
    .order('last_name')

  if (!members) return NextResponse.json({ error: 'No data' }, { status: 500 })

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

  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="stellr-members-${new Date().toISOString().split('T')[0]}.csv"`,
    },
  })
}
