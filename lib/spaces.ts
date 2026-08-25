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
}

export interface SpaceAccess {
  /** Whether the member may enter the space and read its content. */
  canAccess: boolean
  /** Whether the space should appear in the directory at all. */
  visible: boolean
  /** Why access was (not) granted — drives copy + grouping. */
  reason: 'admin' | 'open' | 'tier' | 'role' | 'roster' | 'invited' | 'denied'
  /** Private/secret space the member can't currently enter. */
  gated: boolean
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
  memberRoles: MemberRole[] = []
): SpaceAccess {
  // Platform admins bypass every gate and can see everything.
  if (member.isAdmin) {
    return { canAccess: true, visible: true, reason: 'admin', gated: false }
  }

  // An accepted roster row (any role) grants access regardless of tier.
  if (membership?.status === 'active') {
    return { canAccess: true, visible: true, reason: 'roster', gated: false }
  }

  if (space.access_type === 'open') {
    return { canAccess: true, visible: true, reason: 'open', gated: false }
  }

  // Private / secret: tier match auto-grants.
  const tierMatch = member.activeTierIds.some((id) => assignedTierIds.includes(id))
  if (tierMatch) {
    return { canAccess: true, visible: true, reason: 'tier', gated: false }
  }

  // Web-app role match auto-grants (e.g. a Volunteer Space granted to 'volunteer').
  const roleMatch = assignedRoles.length > 0 && memberRoles.some((r) => assignedRoles.includes(r))
  if (roleMatch) {
    return { canAccess: true, visible: true, reason: 'role', gated: false }
  }

  // No access. Private stays visible (greyed/Restricted); secret is hidden.
  return {
    canAccess: false,
    visible: space.access_type === 'private',
    reason: 'denied',
    gated: true,
  }
}

export interface PendingInvite {
  spaceId: string
  spaceSlug: string
  spaceName: string
  theme: SpaceTheme
  role: SpaceRole
  inviterName: string | null
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
  const rolesBySpace = groupValues(roleRows ?? [], 'space_id', 'role') as Map<string, MemberRole[]>
  // Only worth loading the member's own roles when some space actually grants one.
  const memberRoles = rolesBySpace.size > 0 ? await getGlobalRoleNames(member.id) : []

  // Counts come from the derived audience, never from the roster table alone:
  // tier and role access is resolved at read time and writes no roster row, so
  // counting rows reported every tier/role Space as empty.
  const memberCounts = await resolveSpaceMemberCounts()

  const tiersBySpace = groupValues(tierRows ?? [], 'space_id', 'tier_id')
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
    const access = resolveSpaceAccess(member, s, assignedTierIds, membership, assignedRoles, memberRoles)
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

  const assignedTierIds = (tierRows ?? []).map((r) => (r as { tier_id: string }).tier_id)
  const assignedRoles = (roleRows ?? []).map((r) => (r as { role: MemberRole }).role)
  const mineRow = mine as { role: SpaceRole; status: 'invited' | 'active'; muted: boolean | null } | null
  const membership: SpaceMembership | null = mineRow
    ? { role: mineRow.role, status: mineRow.status, muted: !!mineRow.muted }
    : null
  // Member's global roles only matter when the space actually grants some (most don't).
  const memberRoles = assignedRoles.length > 0 ? await getGlobalRoleNames(member.id) : []
  const access = resolveSpaceAccess(member, s, assignedTierIds, membership, assignedRoles, memberRoles)

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
    myMuted: membership?.muted ?? false,
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

  const assignedTierIds = (tierRows ?? []).map((r) => (r as { tier_id: string }).tier_id)
  const assignedRoles = (roleRows ?? []).map((r) => (r as { role: MemberRole }).role)
  const mineRow = mine as { role: SpaceRole; status: 'invited' | 'active'; muted: boolean | null } | null
  const membership: SpaceMembership | null = mineRow
    ? { role: mineRow.role, status: mineRow.status, muted: !!mineRow.muted }
    : null
  const memberRoles = assignedRoles.length > 0 ? await getGlobalRoleNames(member.id) : []
  return resolveSpaceAccess(member, s as { access_type: SpaceAccessType }, assignedTierIds, membership, assignedRoles, memberRoles)
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

  const tiersBySpace = groupValues(tierRows ?? [], 'space_id', 'tier_id')
  const rolesBySpace = groupValues(roleRows ?? [], 'space_id', 'role')

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
      entries.push({ memberId, role, reason })
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

  const tiersBySpace = groupValues(tierRows ?? [], 'space_id', 'tier_id')
  const rolesBySpace = groupValues(roleRows ?? [], 'space_id', 'role') as Map<string, MemberRole[]>
  const memberRoles = rolesBySpace.size > 0 ? await getGlobalRoleNames(member.id) : []

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
      memberRoles
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

/** Whether a member is muted in a given space (for the comment write path). */
export async function isMemberMutedInSpace(spaceId: string, memberId: string): Promise<boolean> {
  const db = supabaseServer()
  const { data } = await db
    .from('community_space_members')
    .select('muted')
    .eq('space_id', spaceId)
    .eq('member_id', memberId)
    .maybeSingle()
  return !!(data as { muted: boolean } | null)?.muted
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
