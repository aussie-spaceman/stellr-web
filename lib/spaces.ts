import { supabaseServer } from '@/lib/supabase'
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
// Roles within a space are admin / mentor / member (no "staff"/"moderator").

export type SpaceAccessType = 'open' | 'private' | 'secret'
export type SpaceRole = 'admin' | 'mentor' | 'member'
export type SpaceTheme = 'space' | 'enviro' | 'campaign' | 'college'

/** A member's roster row for a space (role + invite status), if any. */
export interface SpaceMembership {
  role: SpaceRole
  status: 'invited' | 'active'
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
  reason: 'admin' | 'open' | 'tier' | 'roster' | 'invited' | 'denied'
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
  membership: SpaceMembership | null
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
        .select('space_id, role, status')
        .eq('member_id', member.id),
      db.from('community_channels').select('space_id').eq('is_archived', false),
    ])

  // Active member counts per space (one query, counted in JS — directory scale).
  const { data: activeRows } = await db
    .from('community_space_members')
    .select('space_id')
    .eq('status', 'active')

  const tiersBySpace = groupValues(tierRows ?? [], 'space_id', 'tier_id')
  const channelCounts = countBy(channels ?? [], 'space_id')
  const memberCounts = countBy(activeRows ?? [], 'space_id')
  const myRoster = new Map<string, SpaceMembership>()
  for (const r of (roster ?? []) as { space_id: string; role: SpaceRole; status: 'invited' | 'active' }[]) {
    myRoster.set(r.space_id, { role: r.role, status: r.status })
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
    const access = resolveSpaceAccess(member, s, assignedTierIds, membership)
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
  channels: SpaceChannel[]
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
    .select('id, slug, name, description, theme, access_type, is_archived')
    .eq('slug', slug)
    .maybeSingle()
  if (!s || s.is_archived) return null

  const [{ data: tierRows }, { data: mine }, { data: channels }, { data: activeRows }] =
    await Promise.all([
      db.from('community_space_tiers').select('tier_id').eq('space_id', s.id),
      db
        .from('community_space_members')
        .select('role, status')
        .eq('space_id', s.id)
        .eq('member_id', member.id)
        .maybeSingle(),
      db
        .from('community_channels')
        .select('id, slug, name, description')
        .eq('space_id', s.id)
        .eq('is_archived', false)
        .order('display_order', { ascending: true }),
      db.from('community_space_members').select('id').eq('space_id', s.id).eq('status', 'active'),
    ])

  const assignedTierIds = (tierRows ?? []).map((r) => (r as { tier_id: string }).tier_id)
  const membership = (mine as SpaceMembership | null) ?? null
  const access = resolveSpaceAccess(member, s, assignedTierIds, membership)

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
    memberCount: (activeRows ?? []).length,
    channelCount: (channels ?? []).length,
    access,
    myRole: membership?.status === 'active' ? membership.role : null,
    channels: (channels ?? []) as SpaceChannel[],
  }
}

/** Whether a member may post in a space, given its posting policy + their role. */
export function canPostInSpace(
  member: CommunityMember,
  postingPolicy: 'all' | 'moderators',
  myRole: SpaceRole | null
): boolean {
  if (member.isAdmin) return true
  if (postingPolicy === 'all') return true
  return myRole === 'admin' || myRole === 'mentor'
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
