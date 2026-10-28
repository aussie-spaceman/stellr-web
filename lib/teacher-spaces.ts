import { supabaseServer } from '@/lib/supabase'
import type { CommunityMember } from '@/lib/community'
import { getActiveTierNames, getActiveTierIdsByMember } from '@/lib/tiers-server'
import { describeAssignedTiers } from '@/lib/tiers'
import { resolveSpaceAudiences, type SpaceAccessType, type SpaceTheme } from '@/lib/spaces'

// Teacher Tools → Group spaces (screen 09): a read-only report of which spaces a
// teacher's student group can reach. The teacher cannot grant or change access
// here.
//
// Counts come from resolveSpaceAudiences — the same rules that decide whether a
// student can actually open a space. This report used to count tier rows only,
// but an event's space is entered by registering for the event (a roster row),
// never by tier, so every event space read "a membership tier · 0/18" even with
// the whole group rostered in (28 Oct 2026).

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
  eventSlug: string
  eventTitle: string | null
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
    .select('id, event_slug, event_title, school_name, created_at, participants(id, member_id, first_name, last_name, event_role)')
    .or(ownerOr)
    .eq('type', 'group')
    .neq('status', 'withdrawn')
    .order('created_at', { ascending: false })

  type Participant = { id: string; member_id: string | null; first_name: string | null; last_name: string | null; event_role: string | null }
  type Reg = { id: string; event_slug: string; event_title: string | null; school_name: string | null; participants: Participant[] | null }

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
      name: [r.school_name, r.event_title].filter(Boolean).join(' · ') || 'Group',
      eventSlug: r.event_slug,
      eventTitle: r.event_title,
      students,
    }
  })
}

/**
 * Per-space access report for a group: for each space the group could reach,
 * how many of its students can enter it. Secret spaces are excluded (invisible
 * by design), and so are other events' spaces, which only that event's
 * participants can ever join.
 */
export async function getGroupSpaceAccess(
  group: TeacherGroup,
  tierNameById: Record<string, string>
): Promise<GroupSpaceRow[]> {
  const db = supabaseServer()
  const [{ data: spaces }, { data: tierRows }, { data: roleRows }, { data: sources }] = await Promise.all([
    db
      .from('community_spaces')
      .select('id, name, theme, access_type')
      .eq('is_archived', false)
      .neq('access_type', 'secret')
      .order('display_order', { ascending: true }),
    db.from('community_space_tiers').select('space_id, tier_id'),
    db.from('community_space_roles').select('space_id, role'),
    db.from('community_space_sources').select('space_id, object_ref').eq('object_type', 'event'),
  ])

  const eventSlugBySpace = new Map<string, Set<string>>()
  for (const s of (sources ?? []) as { space_id: string; object_ref: string }[]) {
    const set = eventSlugBySpace.get(s.space_id) ?? new Set<string>()
    set.add(s.object_ref)
    eventSlugBySpace.set(s.space_id, set)
  }
  const tiersBySpace = groupBy((tierRows ?? []) as { space_id: string; tier_id: string }[], 'tier_id')
  const rolesBySpace = groupBy((roleRows ?? []) as { space_id: string; role: string }[], 'role')

  const visible = ((spaces ?? []) as Array<{ id: string; name: string; theme: SpaceTheme; access_type: SpaceAccessType }>)
    .filter((s) => {
      const events = eventSlugBySpace.get(s.id)
      return !events || events.has(group.eventSlug)
    })

  const audiences = await resolveSpaceAudiences(visible.map((s) => s.id))

  return visible.map((s) => {
    const audience = new Set((audiences.get(s.id) ?? []).map((e) => e.memberId))
    const qualifying = group.students
      .filter((st) => st.memberId && audience.has(st.memberId))
      .map((st) => ({ id: st.memberId ?? st.participantId, name: st.name }))
    return {
      id: s.id,
      name: s.name,
      theme: s.theme,
      access_type: s.access_type,
      requiredTierText: whoCanJoin(s, eventSlugBySpace.has(s.id), tiersBySpace.get(s.id) ?? [], rolesBySpace.get(s.id) ?? [], tierNameById),
      qualifying,
      total: group.students.length,
    }
  })
}

function whoCanJoin(
  s: { access_type: SpaceAccessType },
  eventLinked: boolean,
  tiers: string[],
  roles: string[],
  tierNameById: Record<string, string>,
): string {
  if (s.access_type === 'open') return 'All members'
  if (eventLinked) return 'Everyone registered for the event'
  if (tiers.length) return describeAssignedTiers(tiers, tierNameById)
  if (roles.length) return roles.map((r) => r.charAt(0).toUpperCase() + r.slice(1).replace(/_/g, ' ')).join(', ')
  return 'Invited members'
}

function groupBy<K extends string>(rows: Array<{ space_id: string } & Record<K, string>>, key: K): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const r of rows) {
    const arr = out.get(r.space_id) ?? []
    arr.push(r[key])
    out.set(r.space_id, arr)
  }
  return out
}
