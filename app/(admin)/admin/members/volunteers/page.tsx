import { supabaseServer } from '@/lib/supabase'
import {
  getVolunteerStatuses,
  getVolunteerTrainingProgress,
  type VolunteerStatus,
  type VolunteerTrainingProgress,
} from '@/lib/volunteer'
import { VolunteersConsole, type VolunteerConsoleRow } from '@/components/admin/VolunteersConsole'

export const metadata = { title: 'Admin — Volunteers' }
export const dynamic = 'force-dynamic'

// Volunteer management console (PRD §15). Everyone holding the additive
// 'volunteer' role, with their Volunteer Agreement, background check, mandatory
// training, and event assignments in one table. Actions are advisory-gated only
// (warn-don't-block).
export default async function VolunteersAdminPage() {
  const db = supabaseServer()

  const { data: roleRows } = await db
    .from('member_roles')
    .select('member_id')
    .eq('role', 'volunteer')
    .eq('scope', 'global')
  const memberIds = [...new Set((roleRows ?? []).map((r) => r.member_id as string))]

  let rows: VolunteerConsoleRow[] = []
  if (memberIds.length > 0) {
    const [{ data: members }, training] = await Promise.all([
      db
        .from('members')
        .select('id, first_name, last_name, email, age_bracket, date_of_birth, is_active')
        .in('id', memberIds)
        .order('last_name', { ascending: true }),
      getVolunteerTrainingProgress(db, memberIds),
    ])

    const memberRows = (members ?? []) as Array<{
      id: string; first_name: string | null; last_name: string | null; email: string | null
      age_bracket: string | null; date_of_birth: string | null; is_active: boolean | null
    }>

    const [statuses, { data: participations }, { data: interests }] = await Promise.all([
      getVolunteerStatuses(db, memberRows),
      db
        .from('event_participations')
        .select('member_id, event_title, event_slug')
        .in('member_id', memberIds)
        .eq('role', 'volunteer'),
      db
        .from('volunteer_event_interest')
        .select('member_id')
        .in('member_id', memberIds)
        .eq('status', 'interested'),
    ])

    const assignmentsByMember = new Map<string, string[]>()
    for (const p of participations ?? []) {
      const arr = assignmentsByMember.get(p.member_id as string) ?? []
      arr.push((p.event_title as string | null) ?? (p.event_slug as string))
      assignmentsByMember.set(p.member_id as string, arr)
    }
    const interestCounts = new Map<string, number>()
    for (const i of interests ?? []) {
      const id = i.member_id as string
      interestCounts.set(id, (interestCounts.get(id) ?? 0) + 1)
    }

    const fallbackStatus: VolunteerStatus = { agreement: 'missing', compliance: 'invalid', complianceDetail: null }
    const fallbackTraining: VolunteerTrainingProgress = { completed: 0, total: 0 }

    rows = memberRows.map((m) => ({
      memberId: m.id,
      firstName: m.first_name,
      lastName: m.last_name,
      email: m.email,
      ageBracket: m.age_bracket,
      isActive: m.is_active !== false,
      ...(statuses[m.id] ?? fallbackStatus),
      training: training[m.id] ?? fallbackTraining,
      assignments: assignmentsByMember.get(m.id) ?? [],
      interestCount: interestCounts.get(m.id) ?? 0,
    }))
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading uppercase text-title text-brand-blue-dark">Volunteers</h1>
        <p className="mt-1 text-sm text-brand-muted-soft">
          Everyone in the volunteer program: agreement, background check, mandatory training, and
          event assignments. Assign volunteers to a specific event from that event&apos;s roster tab.
        </p>
      </div>

      <VolunteersConsole rows={rows} />
    </div>
  )
}
