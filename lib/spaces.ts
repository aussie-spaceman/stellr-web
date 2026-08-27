import { supabaseServer } from '@/lib/supabase'
import { normalizeEmail } from '@/lib/member-enums'
import { getGlobalRoleNames, type MemberRole } from '@/lib/member-roles'
import type { CommunityMember } from '@/lib/community'

// ─── Spaces access + directory model (design_handoff_spaces) ─────────────────
//
// A Space has one of three access types:
//   open    — visible to everyone, any member can enter
//   private — visible to everyone, but entry is gated: granted automatically when
//             the member's membership tier is in the space's assigned tiers, OR via
//             an admin invite the member accepts. Below-tier members see it greyed
//             with "requires X tier" and NO upgrade CTA.
//   secret  — invisible unless the member's tier matches (or they're on the roster);
//             never appears in the directory otherwise.
//
// Access is resolved entirely in the server layer (tables are service-role only).
// Roles within a space are admin (Stellr Admin) / moderator / member.

export type SpaceAccessType = 'open' | 'private' | 'secret'
export type SpaceRole = 'admin' | 'moderator' | 'member'
export type SpaceTheme = 'space' | 'enviro' | 'campaign' | 'college'

/** A member's roster row for a space (role + invite status), if any. */
export interface SpaceMembership {
  role: SpaceRole
  status: 'invited' | 'active'
  /** Muted by a moderator — may read but not post in this space. */
  muted: boolean
}

/** The two things an admin can block a member on, per space (migration 142). */
export type SuspensionScope = 'access' | 'posting'

/**
 * A member's LIVE negative grants on a space — expired rows are already
 * filtered out by loadSpaceSuspensions. These outrank every positive grant
 * except the platform-admin bypass: revoking has to beat open/tier/role access,
 * which write no roster row and so cannot be undone by deleting one.
 */
export interface SpaceSuspensions {
  /** Revoked — cannot enter, read, or be notified about this space. */
  access: boolean
  /** Suspended — may read, may not post. Supersedes community_space_members.muted. */
  posting: boolean
}

export const NO_SUSPENSIONS: SpaceSuspensions = { access: false, posting: false }

export interface SpaceSummary {
  id: string
  slug: string
  name: string
  description: string | null
  theme: SpaceTheme
  access_type: SpaceAccessType
  /** Membership tier ids that auto-grant access (private/secret only). */
  assignedTierIds: string[]
  memberCount: number
  channelCount: number
  /**
   * Blocked by an admin revocation rather than by failing a tier gate. Drives the
   * card copy: a revoked member must NOT be shown "Requires Scholar · Upgrade",
   * which would sell them a tier that cannot let them back in.
   */
  revoked?: boolean
}

export interface SpaceAccess {
  /** Whether the member may enter the space and read its content. */
  canAccess: boolean
  /** Whether the space should appear in the directory at all. */
  visible: boolean
  /** Why access was (not) granted — drives copy + grouping. */
  reason: 'admin' | 'open' | 'tier' | 'role' | 'roster' | 'invited' | 'denied' | 'revoked'
  /** Private/secret space the member can't currently enter. */
  gated: boolean
  /** Blocked by an admin revocation rather than by failing a gate. */
  revoked: boolean
  /** Suspended from posting by an admin — may still read. */
  postingSuspended: boolean
}

/**
 * Pure access resolver. `assignedTierIds` are the space's auto-grant tiers;
 * `membership` is the member's roster row for this space (if any).
 */
export function resolveSpaceAccess(
  member: CommunityMember,
  space: { access_type: SpaceAccessType },
  assignedTierIds: string[],
  membership: SpaceMembership | null,
  // Access Convergence: web-app roles granted to the space, and the member's own
  // global roles. Optional so existing callers keep tier-only behaviour unchanged.
  assignedRoles: MemberRole[] = [],
  memberRoles: MemberRole[] = [],
  // Admin revocation / posting suspension (migration 142). Optional so callers
  // that have already excluded revoked members keep their existing behaviour.
  suspensions: SpaceSuspensions = NO_SUSPENSIONS
): SpaceAccess {
  const posting = suspensions.posting

  // Platform admins bypass every gate and can see everything — including a space
  // they have somehow been suspended on, since they are the ones moderating it.
  if (member.isAdmin) {
    return { canAccess: true, visible: true, reason: 'admin', gated: false, revoked: false, postingSuspended: false }
  }

  // Revocation is checked BEFORE every positive grant. Deleting a roster row can
  // only undo a roster grant, so an open/tier/role member could never otherwise
  // be removed from a space at all.
  if (suspensions.access) {
    return {
      canAccess: false,
      // Secret stays invisible; anything else shows as Restricted with revoked copy,
      // so the member isn't told a tier upgrade would let them back in.
      visible: space.access_type !== 'secret',
      reason: 'revoked',
      gated: true,
      revoked: true,
      postingSuspended: posting,
    }
  }

  // An accepted roster row (any role) grants access regardless of tier.
  if (membership?.status === 'active') {
    return { canAccess: true, visible: true, reason: 'roster', gated: false, revoked: false, postingSuspended: posting }
  }

  if (space.access_type === 'open') {
    return { canAccess: true, visible: true, reason: 'open', gated: false, revoked: false, postingSuspended: posting }
  }

  // Private / secret: tier match auto-grants.
  const tierMatch = member.activeTierIds.some((id) => assignedTierIds.includes(id))
  if (tierMatch) {
    return { canAccess: true, visible: true, reason: 'tier', gated: false, revoked: false, postingSuspended: posting }
  }

  // Web-app role match auto-grants (e.g. a Volunteer Space granted to 'volunteer').
  const roleMatch = assignedRoles.length > 0 && memberRoles.some((r) => assignedRoles.includes(r))
  if (roleMatch) {
    return { canAccess: true, visible: true, reason: 'role', gated: false, revoked: false, postingSuspended: posting }
  }

  // No access. Private stays visible (greyed/Restricted); secret is hidden.
  return {
    canAccess: false,
    visible: space.access_type === 'private',
    reason: 'denied',
    gated: true,
    revoked: false,
    postingSuspended: posting,
  }
}

/**
 * Live suspensions for the given spaces and/or members, keyed `spaceId:memberId`.
 * Rows whose expires_at has passed are treated as lifted but left in the table,
 * so the record of who suspended whom (and why) survives.
 */
export async function loadSpaceSuspensions(opts: {
  spaceIds?: string[]
  memberIds?: string[]
} = {}): Promise<Map<string, SpaceSuspensions>> {
  const out = new Map<string, SpaceSuspensions>()
  if (opts.spaceIds?.length === 0 || opts.memberIds?.length === 0) return out

  const db = supabaseServer()
  let q = db
    .from('community_space_suspensions')
    .select('space_id, member_id, scope, expires_at')
    .range(0, 99_999)
  if (opts.spaceIds) q = q.in('space_id', opts.spaceIds)
  if (opts.memberIds) q = q.in('member_id', opts.memberIds)

  const { data, error } = await q
  // A failed read must not silently un-suspend everyone: surface it to the caller
  // rather than returning an empty map that reads as "nobody is suspended".
  if (error) throw new Error(`loadSpaceSuspensions failed — ${error.message}`)

  const now = Date.now()
  for (const r of (data ?? []) as Array<{
    space_id: string; member_id: string; scope: SuspensionScope; expires_at: string | null
  }>) {
    if (r.expires_at && new Date(r.expires_at).getTime() <= now) continue
    const key = `${r.space_id}:${r.member_id}`
    const cur = out.get(key) ?? { access: false, posting: false }
    cur[r.scope] = true
    out.set(key, cur)
  }
  return out
}

/** One member's live suspensions on one space. */
export async function loadSuspension(spaceId: string, memberId: string): Promise<SpaceSuspensions> {
  const map = await loadSpaceSuspensions({ spaceIds: [spaceId], memberIds: [memberId] })
  return map.get(`${spaceId}:${memberId}`) ?? NO_SUSPENSIONS
}

export interface PendingInvite {
  spaceId: string
  spaceSlug: string
  spaceName: string
  theme: SpaceTheme
  role: SpaceRole
  inviterName: string | null
}

// ─── Event-linked Spaces own their own access ────────────────────────────────
//
// A Space linked to an Event through community_space_sources gets its members
// from that Event's roster and from nowhere else. Tier and role grants are
// suppressed on it — not merely discouraged — because the two mean incompatible
// things:
//
//   community_space_roles matches a member's GLOBAL role (resolveSpaceAccess
//   reads getGlobalRoleNames, which excludes object-scoped roles). On an event
//   Space, ticking 'teacher' therefore admits every teacher in the organisation,
//   not the teachers at that event. That is exactly how 7 members came to hold
//   access to all 6 event Spaces in prod without registering for any of them.
//
// The admin UI reads the checkboxes the other way round — "who is at this
// event" — so the trap is easy to walk into and invisible afterwards. Migration
// 145 deleted the existing grants; the admin API now refuses to write new ones;
// and this suppression is the backstop that keeps it true at read time whatever
// is in the table.
//
// Enforced where the grants are LOADED rather than inside resolveSpaceAccess:
// five resolvers apply tier/role matching (the directory, the space page, the
// audience, the member's grant list, the notification audience) and only a rule
// all of them share cannot drift.

/** Space ids whose access is owned by a linked Event. */
export async function loadEventLinkedSpaceIds(spaceIds?: string[]): Promise<Set<string>> {
  if (spaceIds && spaceIds.length === 0) return new Set()
  const db = supabaseServer()
  let q = db.from('community_space_sources').select('space_id').eq('object_type', 'event')
  if (spaceIds) q = q.in('space_id', spaceIds)
  const { data } = await q.range(0, 99_999)
  return new Set(((data ?? []) as Array<{ space_id: string }>).map((r) => r.space_id))
}

/**
 * Blank the tier/role grants of every event-linked Space in a spaceId→grants
 * map. Callers keep using `.get(id) ?? []`, so a dropped key reads as no grant.
 */
export function withoutEventLinkedGrants<T>(
  bySpace: Map<string, T[]>,
  eventLinked: Set<string>
): Map<string, T[]> {
  if (eventLinked.size === 0) return bySpace
  const out = new Map(bySpace)
  for (const id of eventLinked) out.delete(id)
  return out
}

export interface SpacesDirectory {
  /** Accessible non-open spaces, and open spaces the member has joined. */
  yourSpaces: SpaceSummary[]
  /** Open spaces the member can enter but hasn't joined. */
  discover: SpaceSummary[]
  /** Private spaces visible but gated for this member's tier. */
  restricted: SpaceSummary[]
  /** Pending admin invites awaiting accept/decline. */
  invites: PendingInvite[]
}

/**
 * Build the grouped Spaces directory for a member: Your spaces / Discover /
 * Restricted + pending invites. Secret spaces the member can't access are omitted.
 */
export async function getSpacesDirectory(member: CommunityMember): Promise<SpacesDirectory> {
  const db = supabaseServer()

  const [{ data: spaces }, { data: tierRows }, { data: roster }, { data: channels }] =
    await Promise.all([
      db
        .from('community_spaces')
        .select('id, slug, name, description, theme, access_type')
        .eq('is_archived', false)
        .order('display_order', { ascending: true }),
      db.from('community_space_tiers').select('space_id, tier_id'),
      db
        .from('community_space_members')
        .select('space_id, role, status, muted')
        .eq('member_id', member.id),
      db.from('community_channels').select('space_id').eq('is_archived', false),
    ])

  // Role grants, so the directory reaches the same verdict as the space page
  // (getSpaceForMember) does. Omitting these bucketed role-granted spaces into
  // Restricted even though opening them directly let the member straight in.
  const { data: roleRows } = await db.from('community_space_roles').select('space_id, role')
  const rolesBySpace = withoutEventLinkedGrants(
    groupValues(roleRows ?? [], 'space_id', 'role') as Map<string, MemberRole[]>,
    await loadEventLinkedSpaceIds()
  )
  // Only worth loading the member's own roles when some space actually grants one.
  const memberRoles = rolesBySpace.size > 0 ? await getGlobalRoleNames(member.id) : []

  // Counts come from the derived audience, never from the roster table alone:
  // tier and role access is resolved at read time and writes no roster row, so
  // counting rows reported every tier/role Space as empty.
  const memberCounts = await resolveSpaceMemberCounts()

  // This member's own revocations/suspensions, so a revoked space drops out of
  // Your spaces / Discover and shows as Restricted with revoked copy instead.
  const mySuspensions = await loadSpaceSuspensions({ memberIds: [member.id] })

  // Event-linked Spaces take their members from the event, never from a tier
  // or role grant. See loadEventLinkedSpaceIds.
  const eventLinked = await loadEventLinkedSpaceIds()
  const tiersBySpace = withoutEventLinkedGrants(groupValues(tierRows ?? [], 'space_id', 'tier_id'), eventLinked)
  const channelCounts = countBy(channels ?? [], 'space_id')
  const myRoster = new Map<string, SpaceMembership>()
  for (const r of (roster ?? []) as { space_id: string; role: SpaceRole; status: 'invited' | 'active'; muted: boolean | null }[]) {
    myRoster.set(r.space_id, { role: r.role, status: r.status, muted: !!r.muted })
  }

  const yourSpaces: SpaceSummary[] = []
  const discover: SpaceSummary[] = []
  const restricted: SpaceSummary[] = []

  for (const s of (spaces ?? []) as Array<{
    id: string; slug: string; name: string; description: string | null
    theme: SpaceTheme; access_type: SpaceAccessType
  }>) {
    const assignedTierIds = tiersBySpace.get(s.id) ?? []
    const membership = myRoster.get(s.id) ?? null
    const assignedRoles = rolesBySpace.get(s.id) ?? []
    const suspensions = mySuspensions.get(`${s.id}:${member.id}`) ?? NO_SUSPENSIONS
    const access = resolveSpaceAccess(member, s, assignedTierIds, membership, assignedRoles, memberRoles, suspensions)
    if (!access.visible) continue

    const summary: SpaceSummary = {
      id: s.id,
      slug: s.slug,
      name: s.name,
      description: s.description,
      theme: s.theme,
      access_type: s.access_type,
      assignedTierIds,
      memberCount: memberCounts.get(s.id) ?? 0,
      channelCount: channelCounts.get(s.id) ?? 0,
      revoked: access.revoked,
    }

    if (!access.canAccess) {
      restricted.push(summary)
    } else if (s.access_type === 'open' && membership?.status !== 'active') {
      discover.push(summary)
    } else {
      yourSpaces.push(summary)
    }
  }

  const invites = await getPendingInvites(member)
  return { yourSpaces, discover, restricted, invites }
}

/** Pending admin invites for a member (roster rows with status='invited'). */
export async function getPendingInvites(member: CommunityMember): Promise<PendingInvite[]> {
  const db = supabaseServer()
  const { data } = await db
    .from('community_space_members')
    .select(`
      role, invited_by,
      community_spaces ( id, slug, name, theme, is_archived ),
      inviter:members!community_space_members_invited_by_fkey ( first_name, last_name )
    `)
    .eq('member_id', member.id)
    .eq('status', 'invited')

  type Row = {
    role: SpaceRole
    community_spaces: { id: string; slug: string; name: string; theme: SpaceTheme; is_archived: boolean } | null
    inviter: { first_name: string | null; last_name: string | null } | null
  }

  const out: PendingInvite[] = []
  for (const r of (data ?? []) as unknown as Row[]) {
    const sp = r.community_spaces
    if (!sp || sp.is_archived) continue
    const name = r.inviter
      ? [r.inviter.first_name, r.inviter.last_name].filter(Boolean).join(' ') || null
      : null
    out.push({
      spaceId: sp.id,
      spaceSlug: sp.slug,
      spaceName: sp.name,
      theme: sp.theme,
      role: r.role,
      inviterName: name,
    })
  }
  return out
}

export interface SpaceChannel {
  id: string
  slug: string
  name: string
  description: string | null
}

export interface SpaceDetail extends SpaceSummary {
  access: SpaceAccess
  myRole: SpaceRole | null
  /** Whether this member is muted in the space (read-only, cannot post). */
  myMuted: boolean
  channels: SpaceChannel[]
  postingPolicy: 'all' | 'moderators'
  allowMemberUploads: boolean
}

/**
 * Resolve a space by slug for the in-space shell: includes the member's access
 * decision, their role, the channel list, and counts. Returns null if the space
 * doesn't exist or is secret-and-inaccessible (treat as not found).
 */
export async function getSpaceForMember(
  member: CommunityMember,
  slug: string
): Promise<SpaceDetail | null> {
  const db = supabaseServer()
  const { data: s } = await db
    .from('community_spaces')
    .select('id, slug, name, description, theme, access_type, is_archived, posting_policy, allow_member_uploads')
    .eq('slug', slug)
    .maybeSingle()
  if (!s || s.is_archived) return null

  const [{ data: tierRows }, { data: roleRows }, { data: mine }, { data: channels }, memberCounts] =
    await Promise.all([
      db.from('community_space_tiers').select('tier_id').eq('space_id', s.id),
      db.from('community_space_roles').select('role').eq('space_id', s.id),
      db
        .from('community_space_members')
        .select('role, status, muted')
        .eq('space_id', s.id)
        .eq('member_id', member.id)
        .maybeSingle(),
      db
        .from('community_channels')
        .select('id, slug, name, description')
        .eq('space_id', s.id)
        .eq('is_archived', false)
        .order('display_order', { ascending: true }),
      resolveSpaceMemberCounts([s.id]),
    ])

  const isEventLinked = (await loadEventLinkedSpaceIds([s.id])).has(s.id)
  const assignedTierIds = isEventLinked ? [] : (tierRows ?? []).map((r) => (r as { tier_id: string }).tier_id)
  const assignedRoles = isEventLinked ? [] : (roleRows ?? []).map((r) => (r as { role: MemberRole }).role)
  const mineRow = mine as { role: SpaceRole; status: 'invited' | 'active'; muted: boolean | null } | null
  const membership: SpaceMembership | null = mineRow
    ? { role: mineRow.role, status: mineRow.status, muted: !!mineRow.muted }
    : null
  // Member's global roles only matter when the space actually grants some (most don't).
  const memberRoles = assignedRoles.length > 0 ? await getGlobalRoleNames(member.id) : []
  const suspensions = await loadSuspension(s.id, member.id)
  const access = resolveSpaceAccess(member, s, assignedTierIds, membership, assignedRoles, memberRoles, suspensions)

  // Secret + inaccessible → behave as not found so the URL leaks nothing.
  if (s.access_type === 'secret' && !access.canAccess) return null

  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    description: s.description,
    theme: s.theme,
    access_type: s.access_type,
    assignedTierIds,
    memberCount: memberCounts.get(s.id) ?? 0,
    channelCount: (channels ?? []).length,
    access,
    myRole: membership?.status === 'active' ? membership.role : null,
    // Either lever silences them: the legacy roster mute (read for one more
    // release) or a 'posting' suspension, which also works for a tier/role member
    // who has no roster row to carry a mute.
    myMuted: (membership?.muted ?? false) || suspensions.posting,
    channels: (channels ?? []) as SpaceChannel[],
    postingPolicy: ((s as { posting_policy?: 'all' | 'moderators' }).posting_policy ?? 'all'),
    allowMemberUploads: ((s as { allow_member_uploads?: boolean }).allow_member_uploads ?? true),
  }
}

/**
 * Whether a member may post in a space, given its posting policy + their role.
 * A muted member can never post (platform admins are exempt — they moderate).
 */
export function canPostInSpace(
  member: CommunityMember,
  postingPolicy: 'all' | 'moderators',
  myRole: SpaceRole | null,
  muted = false
): boolean {
  if (member.isAdmin) return true
  if (muted) return false
  if (postingPolicy === 'all') return true
  return myRole === 'admin' || myRole === 'moderator'
}

/**
 * Resolve a member's access to a space by id (no slug needed). Used to gate
 * space-scoped resources against the Open/Private/Secret model rather than the
 * legacy min_tier_rank. Returns null when the space doesn't exist.
 */
export async function getSpaceAccessById(
  member: CommunityMember,
  spaceId: string
): Promise<SpaceAccess | null> {
  const db = supabaseServer()
  const { data: s } = await db
    .from('community_spaces')
    .select('id, access_type, is_archived')
    .eq('id', spaceId)
    .maybeSingle()
  if (!s || (s as { is_archived: boolean }).is_archived) return null

  const [{ data: tierRows }, { data: roleRows }, { data: mine }] = await Promise.all([
    db.from('community_space_tiers').select('tier_id').eq('space_id', spaceId),
    db.from('community_space_roles').select('role').eq('space_id', spaceId),
    db
      .from('community_space_members')
      .select('role, status, muted')
      .eq('space_id', spaceId)
      .eq('member_id', member.id)
      .maybeSingle(),
  ])

  const isEventLinked = (await loadEventLinkedSpaceIds([spaceId])).has(spaceId)
  const assignedTierIds = isEventLinked ? [] : (tierRows ?? []).map((r) => (r as { tier_id: string }).tier_id)
  const assignedRoles = isEventLinked ? [] : (roleRows ?? []).map((r) => (r as { role: MemberRole }).role)
  const mineRow = mine as { role: SpaceRole; status: 'invited' | 'active'; muted: boolean | null } | null
  const membership: SpaceMembership | null = mineRow
    ? { role: mineRow.role, status: mineRow.status, muted: !!mineRow.muted }
    : null
  const memberRoles = assignedRoles.length > 0 ? await getGlobalRoleNames(member.id) : []
  const suspensions = await loadSuspension(spaceId, member.id)
  return resolveSpaceAccess(member, s as { access_type: SpaceAccessType }, assignedTierIds, membership, assignedRoles, memberRoles, suspensions)
}

// ─── Derived audiences (who is really in a Space) ────────────────────────────
//
// Tier- and role-granted access is resolved at READ time and never writes a
// community_space_members row — only an Object inheritance, an accepted invite
// or joining an open space does. Counting that table alone therefore reported
// every tier and role Space as having zero members while the people who could
// actually enter it were invisible. These helpers derive the real audience the
// same way resolveSpaceAccess does, so directory counts, the Members tab, the
// admin list and announcement fan-out all agree with the access model.

export interface SpaceAudienceEntry {
  memberId: string
  /** Roster role where one exists, otherwise the implicit 'member'. */
  role: SpaceRole
  /** How they got in — mirrors SpaceAccess.reason. */
  reason: 'roster' | 'open' | 'tier' | 'role'
  /** Suspended from posting by an admin — still in the audience, still reads. */
  postingSuspended: boolean
}

/**
 * Members who may enter each of `spaceIds` (every non-archived space when
 * omitted). Batched: a fixed number of queries however many spaces are asked for.
 */
export async function resolveSpaceAudiences(
  spaceIds?: string[]
): Promise<Map<string, SpaceAudienceEntry[]>> {
  const out = new Map<string, SpaceAudienceEntry[]>()
  if (spaceIds && spaceIds.length === 0) return out

  const db = supabaseServer()
  const today = new Date().toISOString().split('T')[0]
  let spaceQuery = db.from('community_spaces').select('id, access_type').eq('is_archived', false)
  if (spaceIds) spaceQuery = spaceQuery.in('id', spaceIds)

  // Explicit ranges: these are the member-scale reads, and PostgREST otherwise
  // caps them at its default page size, silently truncating a large audience.
  const [
    { data: spaces },
    { data: tierRows },
    { data: roleRows },
    { data: roster },
    { data: liveRows },
    { data: memberships },
    { data: globalRoles },
    suspensions,
  ] = await Promise.all([
    spaceQuery,
    db.from('community_space_tiers').select('space_id, tier_id'),
    db.from('community_space_roles').select('space_id, role'),
    db
      .from('community_space_members')
      .select('space_id, member_id, role')
      .eq('status', 'active')
      .range(0, 99_999),
    db.from('members').select('id').eq('is_active', true).is('deleted_at', null).range(0, 99_999),
    db
      .from('member_memberships')
      .select('member_id, tier_id, expires_at')
      .eq('renewal_status', 'active')
      .range(0, 99_999),
    db.from('member_roles').select('member_id, role').eq('scope', 'global').range(0, 99_999),
    // Revoked members are removed from the audience below, so counts, the admin
    // Members tab and announcement fan-out all drop them together.
    loadSpaceSuspensions(spaceIds ? { spaceIds } : {}),
  ])

  // Only live members ever count: a deactivated or soft-deleted person keeps their
  // tier and role rows, so filtering here stops them reappearing in every audience.
  const live = new Set((liveRows ?? []).map((m) => (m as { id: string }).id))

  const byTier = new Map<string, string[]>()
  for (const m of (memberships ?? []) as Array<{
    member_id: string; tier_id: string | null; expires_at: string | null
  }>) {
    if (!m.tier_id || !live.has(m.member_id)) continue
    if (m.expires_at && m.expires_at < today) continue
    const arr = byTier.get(m.tier_id) ?? []
    arr.push(m.member_id)
    byTier.set(m.tier_id, arr)
  }

  const byRole = new Map<string, string[]>()
  for (const r of (globalRoles ?? []) as Array<{ member_id: string; role: string }>) {
    if (!live.has(r.member_id)) continue
    const arr = byRole.get(r.role) ?? []
    arr.push(r.member_id)
    byRole.set(r.role, arr)
  }

  const rosterBySpace = new Map<string, Array<{ memberId: string; role: SpaceRole }>>()
  for (const r of (roster ?? []) as Array<{ space_id: string; member_id: string; role: SpaceRole }>) {
    if (!live.has(r.member_id)) continue
    const arr = rosterBySpace.get(r.space_id) ?? []
    arr.push({ memberId: r.member_id, role: r.role })
    rosterBySpace.set(r.space_id, arr)
  }

  const audienceEventLinked = await loadEventLinkedSpaceIds(spaceIds)
  const tiersBySpace = withoutEventLinkedGrants(
    groupValues(tierRows ?? [], 'space_id', 'tier_id'), audienceEventLinked)
  const rolesBySpace = withoutEventLinkedGrants(
    groupValues(roleRows ?? [], 'space_id', 'role'), audienceEventLinked)

  for (const s of (spaces ?? []) as Array<{ id: string; access_type: SpaceAccessType }>) {
    const entries: SpaceAudienceEntry[] = []
    const seen = new Set<string>()
    const add = (
      memberId: string,
      reason: SpaceAudienceEntry['reason'],
      role: SpaceRole = 'member'
    ) => {
      if (seen.has(memberId)) return
      seen.add(memberId)
      const susp = suspensions.get(`${s.id}:${memberId}`)
      // A revoked member is not in the audience at all — mirrors resolveSpaceAccess
      // checking revocation ahead of every positive grant.
      if (susp?.access) return
      entries.push({ memberId, role, reason, postingSuspended: !!susp?.posting })
    }

    // Roster rows go first — they carry the explicit moderator/admin role.
    for (const r of rosterBySpace.get(s.id) ?? []) add(r.memberId, 'roster', r.role)

    if (s.access_type === 'open') {
      for (const id of live) add(id, 'open')
    } else {
      for (const tierId of tiersBySpace.get(s.id) ?? []) {
        for (const id of byTier.get(tierId) ?? []) add(id, 'tier')
      }
      for (const role of rolesBySpace.get(s.id) ?? []) {
        for (const id of byRole.get(role) ?? []) add(id, 'role')
      }
    }
    out.set(s.id, entries)
  }
  return out
}

/** Audience sizes only — for the directory and admin member counts. */
export async function resolveSpaceMemberCounts(spaceIds?: string[]): Promise<Map<string, number>> {
  const audiences = await resolveSpaceAudiences(spaceIds)
  const out = new Map<string, number>()
  for (const [spaceId, entries] of audiences) out.set(spaceId, entries.length)
  return out
}

/**
 * Would this member reach the Space WITHOUT any roster row — and by what?
 *
 * The Space role (Moderator / Stellr Admin) is an OVERLAY on access, stored as a
 * roster row, while access itself is usually derived. That makes demotion
 * delicate: deleting the row is right for someone who is also tier- or
 * role-granted (their badge should go back to naming the real source), and
 * catastrophic for someone whose roster row is their ONLY way in. This answers
 * which case you are in.
 *
 * Returns null when the roster row is the member's only grant.
 */
export async function resolveDerivedGrant(
  spaceId: string,
  memberId: string
): Promise<{ reason: 'open' | 'tier' | 'role' | 'object'; grantRef: string | null } | null> {
  const db = supabaseServer()
  const today = new Date().toISOString().split('T')[0]

  const [{ data: space }, { data: tierRows }, { data: roleRows }, { data: sourceRows }, { data: myTiers }, { data: myRoles }] =
    await Promise.all([
      db.from('community_spaces').select('access_type').eq('id', spaceId).maybeSingle(),
      db.from('community_space_tiers').select('tier_id').eq('space_id', spaceId),
      db.from('community_space_roles').select('role').eq('space_id', spaceId),
      db.from('community_space_sources').select('object_type, object_ref').eq('space_id', spaceId),
      db
        .from('member_memberships')
        .select('tier_id, expires_at')
        .eq('member_id', memberId)
        .eq('renewal_status', 'active'),
      db.from('member_roles').select('role').eq('member_id', memberId).eq('scope', 'global'),
    ])
  if (!space) return null

  if ((space as { access_type: SpaceAccessType }).access_type === 'open') {
    return { reason: 'open', grantRef: null }
  }

  const sourceList = (sourceRows ?? []) as Array<{ object_type: string; object_ref: string }>
  const eventOwned = sourceList.some((src) => src.object_type === 'event')

  const spaceTierIds = eventOwned ? [] : (tierRows ?? []).map((r) => (r as { tier_id: string }).tier_id)
  const heldTier = ((myTiers ?? []) as Array<{ tier_id: string | null; expires_at: string | null }>)
    .filter((m) => m.tier_id && !(m.expires_at && m.expires_at < today))
    .map((m) => m.tier_id as string)
    .find((id) => spaceTierIds.includes(id))
  if (heldTier) return { reason: 'tier', grantRef: heldTier }

  const spaceRoles = eventOwned ? [] : (roleRows ?? []).map((r) => (r as { role: string }).role)
  const heldRole = ((myRoles ?? []) as Array<{ role: string }>)
    .map((r) => r.role)
    .find((r) => spaceRoles.includes(r))
  if (heldRole) return { reason: 'role', grantRef: heldRole }

  const sources = (sourceRows ?? []) as Array<{ object_type: string; object_ref: string }>
  if (sources.length) {
    const { objectActiveMemberIds } = await import('@/lib/space-inheritance')
    for (const src of sources) {
      try {
        const ids = await objectActiveMemberIds(
          db,
          src.object_type as 'event' | 'training' | 'mentoring' | 'coaching',
          src.object_ref
        )
        if (ids.includes(memberId)) {
          return { reason: 'object', grantRef: `${src.object_type}:${src.object_ref}` }
        }
      } catch (e) {
        console.error('[spaces] derived-grant source check failed (non-fatal):', src, e)
      }
    }
  }
  return null
}

/** One Space a member can reach, as the admin member record needs to see it. */
export interface MemberSpaceGrant {
  spaceId: string
  slug: string
  name: string
  accessType: SpaceAccessType
  role: SpaceRole
  status: 'active' | 'invited'
  reason: 'roster' | 'open' | 'tier' | 'role' | 'object' | 'invited'
  grantRef: string | null
  postingSuspended: boolean
  revoked: boolean
}

/**
 * Every Space this member can reach, and why — the inverse of
 * resolveSpaceAudience, resolved by the same precedence so the two directions
 * always agree.
 *
 * Deliberately does NOT apply the platform-admin bypass: this answers "what has
 * this person been granted", which is the question the admin member record and
 * the Person 360 are asking. Running it for an admin would otherwise return
 * every Space with reason 'admin' and tell you nothing.
 *
 * Revoked Spaces are returned flagged rather than omitted, so an admin can see
 * and lift the block.
 */
export async function resolveMemberSpaces(memberId: string): Promise<MemberSpaceGrant[]> {
  const db = supabaseServer()
  const today = new Date().toISOString().split('T')[0]

  const [
    { data: spaces },
    { data: tierRows },
    { data: roleRows },
    { data: sourceRows },
    { data: roster },
    suspensions,
    { data: myTiers },
    { data: myRoles },
  ] = await Promise.all([
    db
      .from('community_spaces')
      .select('id, slug, name, access_type')
      .eq('is_archived', false)
      .order('display_order', { ascending: true }),
    db.from('community_space_tiers').select('space_id, tier_id'),
    db.from('community_space_roles').select('space_id, role'),
    db.from('community_space_sources').select('space_id, object_type, object_ref'),
    db
      .from('community_space_members')
      .select('space_id, role, status, muted, invited_by')
      .eq('member_id', memberId),
    loadSpaceSuspensions({ memberIds: [memberId] }),
    db
      .from('member_memberships')
      .select('tier_id, expires_at')
      .eq('member_id', memberId)
      .eq('renewal_status', 'active'),
    db.from('member_roles').select('role').eq('member_id', memberId).eq('scope', 'global'),
  ])

  const myTierIds = new Set(
    ((myTiers ?? []) as Array<{ tier_id: string | null; expires_at: string | null }>)
      .filter((m) => m.tier_id && !(m.expires_at && m.expires_at < today))
      .map((m) => m.tier_id as string)
  )
  const myRoleNames = new Set(((myRoles ?? []) as Array<{ role: string }>).map((r) => r.role))

  const memberEventLinked = await loadEventLinkedSpaceIds()
  const tiersBySpace = withoutEventLinkedGrants(
    groupValues(tierRows ?? [], 'space_id', 'tier_id'), memberEventLinked)
  const rolesBySpace = withoutEventLinkedGrants(
    groupValues(roleRows ?? [], 'space_id', 'role'), memberEventLinked)

  const rosterBySpace = new Map<string, {
    role: SpaceRole; status: 'invited' | 'active'; muted: boolean | null; invited_by: string | null
  }>()
  for (const r of (roster ?? []) as Array<{
    space_id: string; role: SpaceRole; status: 'invited' | 'active'; muted: boolean | null; invited_by: string | null
  }>) {
    rosterBySpace.set(r.space_id, r)
  }

  // Only ask an Object for its roster when this member actually has a roster row
  // on a Space that Object feeds — otherwise every member record would fan out
  // into a query per linked Event.
  const sources = (sourceRows ?? []) as Array<{ space_id: string; object_type: string; object_ref: string }>
  const relevantSources = sources.filter((src) => rosterBySpace.has(src.space_id))
  const objectGrant = new Map<string, string>()
  if (relevantSources.length) {
    const { objectActiveMemberIds } = await import('@/lib/space-inheritance')
    await Promise.all(
      relevantSources.map(async (src) => {
        try {
          const ids = await objectActiveMemberIds(
            db,
            src.object_type as 'event' | 'training' | 'mentoring' | 'coaching',
            src.object_ref
          )
          if (ids.includes(memberId) && !objectGrant.has(src.space_id)) {
            objectGrant.set(src.space_id, `${src.object_type}:${src.object_ref}`)
          }
        } catch (e) {
          console.error('[spaces] member source attribution failed (non-fatal):', src, e)
        }
      })
    )
  }

  const out: MemberSpaceGrant[] = []
  for (const sp of (spaces ?? []) as Array<{
    id: string; slug: string; name: string; access_type: SpaceAccessType
  }>) {
    const susp = suspensions.get(`${sp.id}:${memberId}`)
    const mine = rosterBySpace.get(sp.id)
    const objectRef = objectGrant.get(sp.id) ?? null

    let reason: MemberSpaceGrant['reason'] | null = null
    let grantRef: string | null = null

    if (mine) {
      reason = mine.status === 'invited' ? 'invited' : objectRef ? 'object' : mine.invited_by ? 'invited' : 'roster'
      grantRef = objectRef
    } else if (sp.access_type === 'open') {
      reason = 'open'
    } else {
      const tierId = (tiersBySpace.get(sp.id) ?? []).find((id) => myTierIds.has(id))
      if (tierId) {
        reason = 'tier'
        grantRef = tierId
      } else {
        const role = (rolesBySpace.get(sp.id) ?? []).find((r) => myRoleNames.has(r))
        if (role) {
          reason = 'role'
          grantRef = role
        }
      }
    }

    // No grant at all and nothing revoked → this Space simply isn't theirs.
    if (!reason && !susp?.access) continue

    out.push({
      spaceId: sp.id,
      slug: sp.slug,
      name: sp.name,
      accessType: sp.access_type,
      role: mine?.role ?? 'member',
      status: mine?.status ?? 'active',
      reason: reason ?? 'roster',
      grantRef,
      postingSuspended: !!mine?.muted || !!susp?.posting,
      revoked: !!susp?.access,
    })
  }
  return out
}

/** One person in a Space, as the admin roster needs to see them. */
export interface SpaceAudienceMember {
  memberId: string
  name: string
  email: string | null
  tierName: string | null
  /** Roster role where one exists, otherwise the implicit 'member'. */
  role: SpaceRole
  /** Derived-only members are 'active' — they can walk in right now. */
  status: 'active' | 'invited'
  /** How they got in. 'object' = inherited from a linked Event/Training/Cohort. */
  reason: 'roster' | 'open' | 'tier' | 'role' | 'object' | 'invited'
  /**
   * Machine-readable detail for `reason`: a tier id, a web-app role name, or
   * `objectType:objectRef`. Null for 'open' and bare 'roster'. Callers that can
   * reach Sanity (lib/space-admin) turn this into a friendly label.
   */
  grantRef: string | null
  /** Suspended from posting — reads, cannot post. */
  postingSuspended: boolean
  /** Revoked — cannot enter. Listed anyway so an admin can restore them. */
  revoked: boolean
  addedAt: string | null
}

/**
 * The admin roster for ONE space: every person who can enter it, how they got
 * in, and any admin block on them.
 *
 * This is deliberately a superset of resolveSpaceAudiences rather than a second
 * implementation of it — it additionally carries invited-not-yet-accepted rows
 * and revoked members, both of which an admin must see and act on but neither of
 * which belongs in an access audience. spaces.audience.test.ts asserts that
 * filtering this down to (active ∧ not revoked) reproduces resolveSpaceAudiences
 * exactly, so the two cannot drift apart the way the roster table and the access
 * model did.
 *
 * `exceptionsOnly` drops plain derived members, leaving roster rows, role
 * holders and blocked members — the only sane rendering for an `open` space,
 * whose audience is every live member on the platform.
 */
export async function resolveSpaceAudience(
  spaceId: string,
  opts: { exceptionsOnly?: boolean } = {}
): Promise<SpaceAudienceMember[]> {
  const db = supabaseServer()
  const { data: space } = await db
    .from('community_spaces')
    .select('id, access_type')
    .eq('id', spaceId)
    .maybeSingle()
  if (!space) return []
  const accessType = (space as { access_type: SpaceAccessType }).access_type

  const today = new Date().toISOString().split('T')[0]
  const [
    { data: tierRows },
    { data: roleRows },
    { data: sourceRows },
    { data: roster },
    suspensions,
    { data: liveRows },
    { data: memberships },
    { data: globalRoles },
  ] = await Promise.all([
    db.from('community_space_tiers').select('tier_id').eq('space_id', spaceId),
    db.from('community_space_roles').select('role').eq('space_id', spaceId),
    db.from('community_space_sources').select('object_type, object_ref').eq('space_id', spaceId),
    db
      .from('community_space_members')
      .select('member_id, role, status, muted, invited_by, added_at')
      .eq('space_id', spaceId)
      .range(0, 99_999),
    loadSpaceSuspensions({ spaceIds: [spaceId] }),
    db
      .from('members')
      .select('id, first_name, last_name, email')
      .eq('is_active', true)
      .is('deleted_at', null)
      .range(0, 99_999),
    db
      .from('member_memberships')
      .select('member_id, tier_id, expires_at')
      .eq('renewal_status', 'active')
      .range(0, 99_999),
    db.from('member_roles').select('member_id, role').eq('scope', 'global').range(0, 99_999),
  ])

  type LiveMember = { id: string; first_name: string | null; last_name: string | null; email: string | null }
  const liveById = new Map<string, LiveMember>(
    ((liveRows ?? []) as LiveMember[]).map((m) => [m.id, m])
  )

  const audienceEventOwned = ((sourceRows ?? []) as Array<{ object_type: string }>)
    .some((src) => src.object_type === 'event')
  const spaceTierIds = audienceEventOwned ? [] : (tierRows ?? []).map((r) => (r as { tier_id: string }).tier_id)
  const spaceRoles = audienceEventOwned ? [] : (roleRows ?? []).map((r) => (r as { role: string }).role)

  // Which member holds which of THIS space's granting tiers / roles, so the
  // badge can name the specific grant rather than just its kind.
  const tierGrant = new Map<string, string>()
  for (const m of (memberships ?? []) as Array<{ member_id: string; tier_id: string | null; expires_at: string | null }>) {
    if (!m.tier_id || !liveById.has(m.member_id)) continue
    if (m.expires_at && m.expires_at < today) continue
    if (!spaceTierIds.includes(m.tier_id)) continue
    if (!tierGrant.has(m.member_id)) tierGrant.set(m.member_id, m.tier_id)
  }
  const roleGrant = new Map<string, string>()
  for (const r of (globalRoles ?? []) as Array<{ member_id: string; role: string }>) {
    if (!liveById.has(r.member_id)) continue
    if (!spaceRoles.includes(r.role)) continue
    if (!roleGrant.has(r.member_id)) roleGrant.set(r.member_id, r.role)
  }

  // Attribute roster rows to the Object that produced them. syncObjectSpaceRoster
  // writes a bare roster row with no marker, so the only way to tell an inherited
  // member from a manually-added one is to ask each linked Object for its roster.
  // One query per source, not per member.
  const objectGrant = new Map<string, string>()
  const sources = (sourceRows ?? []) as Array<{ object_type: string; object_ref: string }>
  if (sources.length) {
    const { objectActiveMemberIds } = await import('@/lib/space-inheritance')
    await Promise.all(
      sources.map(async (src) => {
        try {
          const ids = await objectActiveMemberIds(
            db,
            src.object_type as 'event' | 'training' | 'mentoring' | 'coaching',
            src.object_ref
          )
          for (const id of ids) {
            if (!objectGrant.has(id)) objectGrant.set(id, `${src.object_type}:${src.object_ref}`)
          }
        } catch (e) {
          // A source whose roster can't be read costs us the badge, not the row.
          console.error('[spaces] source attribution failed (non-fatal):', src, e)
        }
      })
    )
  }

  const rosterRows = (roster ?? []) as Array<{
    member_id: string
    role: SpaceRole
    status: 'invited' | 'active'
    muted: boolean | null
    invited_by: string | null
    added_at: string | null
  }>

  const out: SpaceAudienceMember[] = []
  const seen = new Set<string>()

  const push = (
    memberId: string,
    reason: SpaceAudienceMember['reason'],
    grantRef: string | null,
    role: SpaceRole,
    status: 'active' | 'invited',
    mutedFlag: boolean,
    addedAt: string | null
  ) => {
    if (seen.has(memberId)) return
    const m = liveById.get(memberId)
    // Deactivated and soft-deleted people keep their tier, role and roster rows;
    // skipping them here is what stops them haunting every audience.
    if (!m) return
    seen.add(memberId)
    const susp = suspensions.get(`${spaceId}:${memberId}`)
    out.push({
      memberId,
      name: [m.first_name, m.last_name].filter(Boolean).join(' ') || m.email || 'Member',
      email: m.email,
      tierName: null, // filled in below, in one batched query
      role,
      status,
      reason,
      grantRef,
      postingSuspended: mutedFlag || !!susp?.posting,
      revoked: !!susp?.access,
      addedAt,
    })
  }

  // Same precedence as resolveSpaceAudiences: roster rows first (they carry the
  // explicit moderator/admin role), then open, then tier, then role.
  for (const r of rosterRows) {
    const objectRef = objectGrant.get(r.member_id) ?? null
    const reason: SpaceAudienceMember['reason'] =
      r.status === 'invited' ? 'invited' : objectRef ? 'object' : r.invited_by ? 'invited' : 'roster'
    push(r.member_id, reason, objectRef, r.role, r.status, !!r.muted, r.added_at)
  }

  if (accessType === 'open') {
    for (const id of liveById.keys()) push(id, 'open', null, 'member', 'active', false, null)
  } else {
    for (const [memberId, tierId] of tierGrant) push(memberId, 'tier', tierId, 'member', 'active', false, null)
    for (const [memberId, role] of roleGrant) push(memberId, 'role', role, 'member', 'active', false, null)
  }

  const rows = opts.exceptionsOnly
    ? out.filter((r) => r.reason !== 'open' || r.revoked || r.postingSuspended || r.role !== 'member')
    : out

  // Tier names last, over only the rows we're returning.
  const { getActiveTierNames } = await import('@/lib/tiers-server')
  const tierNames = await getActiveTierNames(rows.map((r) => r.memberId))
  for (const r of rows) r.tierName = tierNames.get(r.memberId) ?? null

  return rows.sort((a, b) => {
    // Blocked people first (they're what an admin came here for), then by role
    // weight, then name.
    const blocked = (r: SpaceAudienceMember) => (r.revoked ? 0 : r.postingSuspended ? 1 : 2)
    const weight = (r: SpaceAudienceMember) => (r.role === 'admin' ? 0 : r.role === 'moderator' ? 1 : 2)
    return blocked(a) - blocked(b) || weight(a) - weight(b) || a.name.localeCompare(b.name)
  })
}

/**
 * Space ids this member may enter — the batched counterpart of
 * getSpaceAccessById, for callers that would otherwise resolve every space
 * one query at a time (the Home feed).
 */
export async function getAccessibleSpaceIds(member: CommunityMember): Promise<Set<string>> {
  const db = supabaseServer()
  const [{ data: spaces }, { data: tierRows }, { data: roleRows }, { data: roster }] =
    await Promise.all([
      db.from('community_spaces').select('id, access_type').eq('is_archived', false),
      db.from('community_space_tiers').select('space_id, tier_id'),
      db.from('community_space_roles').select('space_id, role'),
      db
        .from('community_space_members')
        .select('space_id, role, status, muted')
        .eq('member_id', member.id),
    ])

  const accessibleEventLinked = await loadEventLinkedSpaceIds()
  const tiersBySpace = withoutEventLinkedGrants(
    groupValues(tierRows ?? [], 'space_id', 'tier_id'), accessibleEventLinked)
  const rolesBySpace = withoutEventLinkedGrants(
    groupValues(roleRows ?? [], 'space_id', 'role') as Map<string, MemberRole[]>, accessibleEventLinked)
  const memberRoles = rolesBySpace.size > 0 ? await getGlobalRoleNames(member.id) : []
  const mySuspensions = await loadSpaceSuspensions({ memberIds: [member.id] })

  const mine = new Map<string, SpaceMembership>()
  for (const r of (roster ?? []) as Array<{
    space_id: string; role: SpaceRole; status: 'invited' | 'active'; muted: boolean | null
  }>) {
    mine.set(r.space_id, { role: r.role, status: r.status, muted: !!r.muted })
  }

  const out = new Set<string>()
  for (const s of (spaces ?? []) as Array<{ id: string; access_type: SpaceAccessType }>) {
    const access = resolveSpaceAccess(
      member,
      s,
      tiersBySpace.get(s.id) ?? [],
      mine.get(s.id) ?? null,
      rolesBySpace.get(s.id) ?? [],
      memberRoles,
      mySuspensions.get(`${s.id}:${member.id}`) ?? NO_SUSPENSIONS
    )
    if (access.canAccess) out.add(s.id)
  }
  return out
}

/**
 * The set of member ids who should receive a notification for space-wide events
 * (e.g. a new announcement) — i.e. everyone with access to the space. Previously
 * this resolved roster + open + tier members but not role-granted ones, so an
 * announcement in a role room (Teachers'/Mentors'/Coaches') notified nobody.
 * In-app only.
 */
export async function spaceNotificationAudience(spaceId: string): Promise<string[]> {
  const audiences = await resolveSpaceAudiences([spaceId])
  return (audiences.get(spaceId) ?? []).map((e) => e.memberId)
}

/**
 * Park a space invite for an email that has no account yet (member_id is a hard
 * FK, so we can't roster them). Claimed on signup by claimPendingSpaceInvites.
 * Returns false if the email is blank.
 */
export async function createPendingSpaceInvite(
  spaceId: string,
  email: string,
  role: 'moderator' | 'member',
  invitedBy: string | null
): Promise<boolean> {
  const normalized = normalizeEmail(email)
  if (!normalized) return false
  const db = supabaseServer()
  await db.from('community_space_invites').upsert(
    { space_id: spaceId, email: normalized, role, invited_by: invitedBy, claimed_at: null, claimed_member_id: null },
    { onConflict: 'space_id,email' }
  )
  return true
}

/**
 * Claim any pending space invites for a newly-created member (matched by email):
 * convert each into a real 'invited' roster row so they get the normal
 * accept/decline banner, then mark the pending invite claimed. Best-effort, safe
 * to call on every signup. Returns the number of invites claimed.
 */
export async function claimPendingSpaceInvites(memberId: string, email: string): Promise<number> {
  const normalized = normalizeEmail(email)
  if (!normalized) return 0
  const db = supabaseServer()

  const { data: pending } = await db
    .from('community_space_invites')
    .select('id, space_id, role, invited_by, invited_at')
    .eq('email', normalized)
    .is('claimed_at', null)

  const rows = (pending ?? []) as { id: string; space_id: string; role: 'moderator' | 'member'; invited_by: string | null; invited_at: string }[]
  let claimed = 0
  for (const inv of rows) {
    // Don't clobber an existing roster row (e.g. they already joined).
    await db.from('community_space_members').upsert(
      {
        space_id: inv.space_id,
        member_id: memberId,
        role: inv.role,
        status: 'invited',
        invited_by: inv.invited_by,
        invited_at: inv.invited_at,
      },
      { onConflict: 'space_id,member_id', ignoreDuplicates: true }
    )
    await db
      .from('community_space_invites')
      .update({ claimed_at: new Date().toISOString(), claimed_member_id: memberId })
      .eq('id', inv.id)
    claimed++
  }
  return claimed
}

/**
 * Whether a member is silenced in a given space (for the post/comment write
 * paths). Two sources: the legacy community_space_members.muted flag, which only
 * ever existed for roster members, and a 'posting' suspension, which also covers
 * a tier- or role-granted member who has no roster row to carry a mute.
 */
export async function isMemberMutedInSpace(spaceId: string, memberId: string): Promise<boolean> {
  const db = supabaseServer()
  const [{ data }, suspensions] = await Promise.all([
    db
      .from('community_space_members')
      .select('muted')
      .eq('space_id', spaceId)
      .eq('member_id', memberId)
      .maybeSingle(),
    loadSuspension(spaceId, memberId),
  ])
  return !!(data as { muted: boolean } | null)?.muted || suspensions.posting
}

/**
 * Accept or decline a pending space invite. Accepting flips the roster row to
 * active; declining removes it. Returns false when no pending invite exists.
 */
export async function respondToSpaceInvite(
  spaceId: string,
  memberId: string,
  accept: boolean
): Promise<boolean> {
  const db = supabaseServer()
  const { data: row } = await db
    .from('community_space_members')
    .select('id, status')
    .eq('space_id', spaceId)
    .eq('member_id', memberId)
    .maybeSingle()

  if (!row || (row as { status: string }).status !== 'invited') return false

  if (accept) {
    const { error } = await db
      .from('community_space_members')
      .update({ status: 'active', accepted_at: new Date().toISOString() })
      .eq('id', (row as { id: string }).id)
    return !error
  }
  const { error } = await db
    .from('community_space_members')
    .delete()
    .eq('id', (row as { id: string }).id)
  return !error
}

// ─── small helpers ───────────────────────────────────────────────────────────

function countBy<T extends Record<string, unknown>>(rows: T[], key: keyof T): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rows) {
    const k = r[key] as unknown as string
    if (!k) continue
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return m
}

function groupValues<T extends Record<string, unknown>>(
  rows: T[],
  keyField: keyof T,
  valueField: keyof T
): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const r of rows) {
    const k = r[keyField] as unknown as string
    const v = r[valueField] as unknown as string
    if (!k || !v) continue
    const arr = m.get(k) ?? []
    arr.push(v)
    m.set(k, arr)
  }
  return m
}
