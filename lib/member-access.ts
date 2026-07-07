import { supabaseServer } from '@/lib/supabase'
import { MANAGE_ROLES, ROLE_LABELS, type MemberRole } from '@/lib/member-roles'

// "All access in one place" (convergence P3 → admin/access Person 360).
//
// Resolves every object a member can reach and every object they manage, with
// the source of each grant. This is the single server-side truth behind the
// People tab's Effective Access list; the /api/admin/members/[id]/access route
// (and later /api/admin/access/people/[id]) serve it verbatim.
//
// Resolution mirrors the access model (docs/ACCESS-CONTROL-HANDOVER.md):
// consume = roster membership (direct, tier-rule or role-rule) — the member's
// ROLE on the object says what they can do there; manage = object_roles /
// object-scoped MANAGE member_roles / being the container's coach-or-mentor.
// No fabricated access levels.

export type AccessObjectType =
  | 'space' | 'course' | 'workshop' | 'cohort' | 'event' | 'campaign' | 'resource' | 'group'

export interface AccessSource {
  kind: 'roster' | 'manager' | 'tier' | 'role'
  /** Human label: 'Roster' | 'Added directly' | 'Rule (tier)' | 'Rule (role)' | 'Manager'. */
  label: string
}

export interface EffectiveAccessRow {
  objectType: AccessObjectType
  /** Event/campaign slug, or the container/space uuid. */
  objectRef: string
  label: string
  /** The member's role on the object (first/strongest source). */
  role: string
  archived: boolean
  sources: AccessSource[]
  /** On the roster AND a manager of the same object (Conflicts panel). */
  redundant: boolean
}

export interface MemberAccessSummary {
  competitions: { slug: string; label: string }[]
  mentoring: { label: string; relationship: string; archived: boolean }[]
  coaching: { label: string; relationship: string }[]
  /** The unified resolution (roster + tier/role rules + managers). */
  rows: EffectiveAccessRow[]
}

/** mentoring_cohorts.container_type → design object type. */
const CONTAINER_TYPE_MAP: Record<string, AccessObjectType> = {
  mentoring: 'cohort',
  coaching: 'workshop',
  training: 'course',
  space: 'space',
  event_participation: 'event',
  campaign_participation: 'campaign',
}

function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export async function getMemberAccessSummary(memberId: string): Promise<MemberAccessSummary> {
  const db = supabaseServer()

  const [containerRes, spaceRes, tierRes, roleRes, objectRoleRes, ownedRes] = await Promise.all([
    // Container rosters (cohorts, workshops, courses, competitions).
    db.from('cohort_members')
      .select('relationship, mentoring_cohorts!inner(id, name, container_type, campaign_ref, lifecycle, mentor_member_id)')
      .eq('member_id', memberId)
      .eq('status', 'active'),
    // Space rosters (direct or inherited via community_space_sources).
    db.from('community_space_members')
      .select('role, community_spaces!inner(id, name, is_archived)')
      .eq('member_id', memberId)
      .eq('status', 'active'),
    // Active tiers → tier-granted spaces resolve below.
    db.from('member_memberships')
      .select('tier_id, expires_at, renewal_status')
      .eq('member_id', memberId)
      .eq('renewal_status', 'active'),
    // All canonical roles (global feed the role-space grants; object-scoped feed managers).
    db.from('member_roles')
      .select('role, scope, object_type, object_id')
      .eq('member_id', memberId),
    // Legacy manager grants.
    db.from('object_roles')
      .select('object_type, object_id, role')
      .eq('member_id', memberId),
    // Containers this member runs (structural coach/mentor column).
    db.from('mentoring_cohorts')
      .select('id, name, container_type, lifecycle')
      .eq('mentor_member_id', memberId),
  ])

  const rows = new Map<string, EffectiveAccessRow>()
  const upsert = (
    objectType: AccessObjectType,
    objectRef: string,
    label: string,
    role: string,
    source: AccessSource,
    archived = false,
  ) => {
    const key = `${objectType}:${objectRef}`
    const existing = rows.get(key)
    if (existing) {
      if (!existing.sources.some((s) => s.kind === source.kind && s.label === source.label)) {
        existing.sources.push(source)
      }
      existing.archived = existing.archived || archived
      // Roster role wins the display slot; a manager source alone shows its role.
      if (source.kind === 'roster' && existing.sources[0]?.kind !== 'roster') existing.role = role
    } else {
      rows.set(key, { objectType, objectRef, label, role, archived, sources: [source], redundant: false })
    }
  }

  // ── 1. Container rosters ──────────────────────────────────────────────────
  type Cont = {
    id: string; name: string; container_type: string
    campaign_ref: string | null; lifecycle: string; mentor_member_id: string | null
  }
  const containerRows = (containerRes.data ?? []).map((r) => {
    const c = (Array.isArray(r.mentoring_cohorts) ? r.mentoring_cohorts[0] : r.mentoring_cohorts) as Cont
    return { relationship: (r.relationship as string) ?? 'participant', c }
  })

  for (const { c, relationship } of containerRows) {
    const objectType = CONTAINER_TYPE_MAP[c.container_type] ?? 'cohort'
    // Competitions: collapse event-level + group sub-containers to one row per slug.
    const ref = objectType === 'event' || objectType === 'campaign' ? (c.campaign_ref ?? c.id) : c.id
    const label = objectType === 'event' || objectType === 'campaign' ? c.name.split(' — ')[0] : c.name
    upsert(objectType, ref, label, titleCase(relationship), { kind: 'roster', label: 'Roster' }, c.lifecycle === 'archived')
  }

  // ── 2. Space rosters ──────────────────────────────────────────────────────
  type SpaceJoin = { id: string; name: string; is_archived: boolean }
  for (const r of spaceRes.data ?? []) {
    const s = (Array.isArray(r.community_spaces) ? r.community_spaces[0] : r.community_spaces) as SpaceJoin
    upsert('space', s.id, s.name, titleCase((r.role as string) ?? 'member'), { kind: 'roster', label: 'Roster' }, s.is_archived)
  }

  // ── 3. Tier-granted spaces ────────────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0]
  const activeTierIds = (tierRes.data ?? [])
    .filter((m) => !m.expires_at || m.expires_at >= today)
    .map((m) => m.tier_id as string | null)
    .filter((id): id is string => !!id)

  if (activeTierIds.length > 0) {
    const { data: tierSpaces } = await db
      .from('community_space_tiers')
      .select('community_spaces!inner(id, name, is_archived)')
      .in('tier_id', activeTierIds)
    for (const r of tierSpaces ?? []) {
      const s = (Array.isArray(r.community_spaces) ? r.community_spaces[0] : r.community_spaces) as SpaceJoin
      upsert('space', s.id, s.name, 'Member', { kind: 'tier', label: 'Rule (tier)' }, s.is_archived)
    }
  }

  // ── 4. Role-granted spaces ────────────────────────────────────────────────
  const allRoles = (roleRes.data ?? []) as Array<{
    role: MemberRole; scope: string; object_type: string | null; object_id: string | null
  }>
  const globalRoles = [...new Set(allRoles.filter((r) => r.scope === 'global').map((r) => r.role))]

  if (globalRoles.length > 0) {
    const { data: roleSpaces } = await db
      .from('community_space_roles')
      .select('role, community_spaces!inner(id, name, is_archived)')
      .in('role', globalRoles)
    for (const r of roleSpaces ?? []) {
      const s = (Array.isArray(r.community_spaces) ? r.community_spaces[0] : r.community_spaces) as SpaceJoin
      upsert('space', s.id, s.name, 'Member', { kind: 'role', label: 'Rule (role)' }, s.is_archived)
    }
  }

  // ── 5. Managers ───────────────────────────────────────────────────────────
  // 5a. Structural: containers where this member is the coach/mentor.
  for (const c of (ownedRes.data ?? []) as Array<Pick<Cont, 'id' | 'name' | 'container_type' | 'lifecycle'>>) {
    const objectType = CONTAINER_TYPE_MAP[c.container_type] ?? 'cohort'
    const role = objectType === 'workshop' ? 'Coach' : 'Mentor'
    upsert(objectType, c.id, c.name, role, { kind: 'manager', label: 'Manager' }, c.lifecycle === 'archived')
  }

  // 5b + 5c need labels for arbitrary (type, ref) pairs — batch-resolve after collecting.
  type Pending = { objectType: AccessObjectType; ref: string; role: string }
  const pending: Pending[] = []

  for (const r of (objectRoleRes.data ?? []) as Array<{ object_type: string; object_id: string; role: string }>) {
    const objectType = (
      r.object_type === 'container' ? 'cohort' : r.object_type
    ) as AccessObjectType
    pending.push({ objectType, ref: r.object_id, role: titleCase(r.role) })
  }
  for (const r of allRoles) {
    if (r.scope !== 'object' || !r.object_type || !r.object_id) continue
    if (!MANAGE_ROLES.has(r.role)) continue
    const objectType = (
      r.object_type === 'container' || r.object_type === 'mentoring' ? 'cohort'
      : r.object_type === 'coaching' ? 'workshop'
      : r.object_type === 'training' ? 'course'
      : r.object_type
    ) as AccessObjectType
    pending.push({ objectType, ref: r.object_id, role: ROLE_LABELS[r.role] })
  }

  // Label lookups: containers by uuid, spaces by uuid; event/campaign refs are
  // slugs (Sanity owns display names — the slug is the stable label here).
  const containerRefs = [...new Set(pending
    .filter((p) => ['cohort', 'workshop', 'course'].includes(p.objectType))
    .map((p) => p.ref))]
  const spaceRefs = [...new Set(pending.filter((p) => p.objectType === 'space').map((p) => p.ref))]

  const [containerNames, spaceNames] = await Promise.all([
    containerRefs.length
      ? db.from('mentoring_cohorts').select('id, name, container_type, lifecycle').in('id', containerRefs)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string; container_type: string; lifecycle: string }> }),
    spaceRefs.length
      ? db.from('community_spaces').select('id, name, is_archived').in('id', spaceRefs)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string; is_archived: boolean }> }),
  ])
  const containerById = new Map((containerNames.data ?? []).map((c) => [c.id, c]))
  const spaceById = new Map((spaceNames.data ?? []).map((s) => [s.id, s]))

  for (const p of pending) {
    const container = containerById.get(p.ref)
    const space = spaceById.get(p.ref)
    const objectType = container ? (CONTAINER_TYPE_MAP[container.container_type] ?? p.objectType) : p.objectType
    const label = container?.name ?? space?.name ?? p.ref
    const archived = container?.lifecycle === 'archived' || space?.is_archived === true
    upsert(objectType, p.ref, label, p.role, { kind: 'manager', label: 'Manager' }, archived)
  }

  // ── Redundancy: roster + manager on the same object ───────────────────────
  for (const row of rows.values()) {
    const kinds = new Set(row.sources.map((s) => s.kind))
    row.redundant = (kinds.has('roster') || kinds.has('tier') || kinds.has('role')) && kinds.has('manager')
  }

  // ── Legacy panel shape (MemberAccessPanel) — derived from the same data ────
  const compMap = new Map<string, string>()
  for (const { c } of containerRows) {
    if (c.container_type === 'event_participation' && c.campaign_ref && !compMap.has(c.campaign_ref)) {
      compMap.set(c.campaign_ref, c.name.split(' — ')[0])
    }
  }
  const competitions = [...compMap.entries()].map(([slug, label]) => ({ slug, label }))
  const mentoring = containerRows
    .filter(({ c }) => c.container_type === 'mentoring')
    .map(({ c, relationship }) => ({ label: c.name, relationship, archived: c.lifecycle === 'archived' }))
  const coaching = containerRows
    .filter(({ c }) => c.container_type === 'coaching')
    .map(({ c, relationship }) => ({ label: c.name, relationship }))

  return { competitions, mentoring, coaching, rows: [...rows.values()] }
}
