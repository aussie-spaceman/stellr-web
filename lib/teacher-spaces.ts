import { supabaseServer } from '@/lib/supabase'
import type { CommunityMember } from '@/lib/community'
import { getActiveTierNames, getActiveTierIdsByMember } from '@/lib/tiers-server'
import { describeAssignedTiers } from '@/lib/tiers'
import type { SpaceAccessType, SpaceTheme } from '@/lib/spaces'

// Teacher Tools → Group spaces (screen 09): a read-only report of which spaces a
// teacher's student group can reach. Access is automatic by each student's
// membership tier — the teacher cannot grant or change it here.

export interface GroupStudent {
  participantId: string
  memberId: string | null
  name: string
  tierName: string | null
  tierIds: string[]
}

export interface TeacherGroup {
  id: string
  name: string
  students: GroupStudent[]
}

export interface GroupSpaceRow {
  id: string
  name: string
  theme: SpaceTheme
  access_type: SpaceAccessType
  requiredTierText: string
  qualifying: { id: string; name: string }[]
  total: number
}

const STUDENT_ROLES = new Set(['participant', 'school_student_manager'])

/** Group registrations this member owns (teacher / student-manager / teacher POC). */
export async function getTeacherGroups(member: CommunityMember): Promise<TeacherGroup[]> {
  const db = supabaseServer()
  const ownerOr = member.email
    ? `teacher_member_id.eq.${member.id},teacher_email.eq.${member.email},teacher_poc_email.eq.${member.email}`
    : `teacher_member_id.eq.${member.id}`

  const { data: regs } = await db
    .from('registrations')
    .select('id, event_title, school_name, created_at, participants(id, member_id, first_name, last_name, event_role)')
    .or(ownerOr)
    .eq('type', 'group')
    .order('created_at', { ascending: false })

  type Participant = { id: string; member_id: string | null; first_name: string | null; last_name: string | null; event_role: string | null }
  type Reg = { id: string; event_title: string | null; school_name: string | null; participants: Participant[] | null }

  const rows = (regs ?? []) as unknown as Reg[]

  // One tier lookup across every student in every owned group.
  const allMemberIds = [
    ...new Set(
      rows.flatMap((r) => (r.participants ?? []).filter((p) => p.member_id).map((p) => p.member_id as string))
    ),
  ]
  const [tierNames, tierIds] = await Promise.all([
    getActiveTierNames(allMemberIds),
    getActiveTierIdsByMember(allMemberIds),
  ])

  return rows.map((r) => {
    const students: GroupStudent[] = (r.participants ?? [])
      // Require an EXPLICIT student role — a null event_role is not assumed to be a
      // student (would otherwise over-count adults/teachers into the roster).
      .filter((p) => !!p.event_role && STUDENT_ROLES.has(p.event_role))
      .map((p) => ({
        participantId: p.id,
        memberId: p.member_id,
        name: [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Student',
        tierName: p.member_id ? tierNames.get(p.member_id) ?? null : null,
        tierIds: p.member_id ? tierIds.get(p.member_id) ?? [] : [],
      }))
    return {
      id: r.id,
      name: r.school_name || r.event_title || 'Group',
      students,
    }
  })
}

/**
 * Per-space access report for a group: for each visible space, how many of the
 * group's students qualify (by tier). Secret spaces are excluded — they're
 * invisible by design, even in this transparency view.
 */
export async function getGroupSpaceAccess(
  group: TeacherGroup,
  tierNameById: Record<string, string>
): Promise<GroupSpaceRow[]> {
  const db = supabaseServer()
  const [{ data: spaces }, { data: tierRows }] = await Promise.all([
    db
      .from('community_spaces')
      .select('id, name, theme, access_type')
      .eq('is_archived', false)
      .neq('access_type', 'secret')
      .order('display_order', { ascending: true }),
    db.from('community_space_tiers').select('space_id, tier_id'),
  ])

  const tiersBySpace = new Map<string, string[]>()
  for (const t of (tierRows ?? []) as { space_id: string; tier_id: string }[]) {
    const arr = tiersBySpace.get(t.space_id) ?? []
    arr.push(t.tier_id)
    tiersBySpace.set(t.space_id, arr)
  }

  return ((spaces ?? []) as Array<{ id: string; name: string; theme: SpaceTheme; access_type: SpaceAccessType }>).map(
    (s) => {
      const assigned = tiersBySpace.get(s.id) ?? []
      const qualifying = group.students
        .filter((st) =>
          s.access_type === 'open' ? true : st.tierIds.some((id) => assigned.includes(id))
        )
        .map((st) => ({ id: st.memberId ?? st.participantId, name: st.name }))
      return {
        id: s.id,
        name: s.name,
        theme: s.theme,
        access_type: s.access_type,
        requiredTierText: s.access_type === 'open' ? 'All members' : describeAssignedTiers(assigned, tierNameById),
        qualifying,
        total: group.students.length,
      }
    }
  )
}
