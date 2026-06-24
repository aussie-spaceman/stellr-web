import { auth } from '@clerk/nextjs/server'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'

// Private Supabase Storage bucket for community resources (FR-COM-03).
// Create this bucket manually in the Supabase dashboard: name = community-resources, public = false.
export const RESOURCES_BUCKET = 'community-resources'

// Signed URL TTL for downloads — short enough to prevent sharing, long enough for slow connections.
const SIGNED_URL_TTL_SECONDS = 120

/**
 * Generate a short-lived signed download URL for a private resource.
 * Only call this after a server-side tier check (FR-COM-03).
 */
export async function signedDownloadUrl(storagePath: string): Promise<string | null> {
  const db = supabaseServer()
  const { data, error } = await db.storage
    .from(RESOURCES_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS)
  if (error) {
    console.error('[community] signed URL error:', error)
    return null
  }
  return data.signedUrl
}

// Shared helpers for the Community module (Component 3).
// All community routes resolve the Clerk user to a member row, then gate access
// in the server layer (the DB tables are service-role only — see migration 012).

export interface CommunityMember {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  /** Platform admin (Clerk role=admin). Bypasses all entitlement/tier gates. */
  isAdmin: boolean
  /** Highest paid status across the member's active memberships. */
  hasPaidTier: boolean
  /** Display name of the active tier, if any. */
  activeTierName: string | null
  /** tier_id of every active membership — used by the entitlement engine. */
  activeTierIds: string[]
  /**
   * The member's primary Event Participation Role (members.event_role enum, e.g.
   * 'school_student' | 'teacher' | 'mentor' | 'parent'). Used to resolve
   * role-targeted training assignments (FR-COM-10). Null when unset.
   */
  event_role: string | null
}

/**
 * Resolve the current Clerk user to a community member, including their tier.
 * Returns null when unauthenticated, no member row exists, or the member is inactive.
 */
export async function getCurrentMember(): Promise<CommunityMember | null> {
  const { userId, sessionClaims } = await auth()
  if (!userId) return null
  const isAdmin = isAdminClaims(sessionClaims)

  const db = supabaseServer()
  const { data: member } = await db
    .from('members')
    .select(`
      id, first_name, last_name, email, event_role,
      member_memberships(renewal_status, started_at, expires_at, tier_id, membership_tiers(name, is_free))
    `)
    .eq('clerk_user_id', userId)
    .maybeSingle()

  if (!member) return null

  // The Supabase client types the nested join loosely (membership_tiers can come
  // back as an object or array depending on cardinality), so normalize here.
  type RawMembership = {
    renewal_status: string
    started_at: string
    expires_at: string | null
    tier_id: string | null
    membership_tiers: { name: string; is_free: boolean } | { name: string; is_free: boolean }[] | null
  }

  const tierOf = (m: RawMembership) =>
    Array.isArray(m.membership_tiers) ? m.membership_tiers[0] ?? null : m.membership_tiers

  // A membership grants access only while active AND not past its expiry — so a
  // lapsed complimentary grant loses access immediately, before the nightly
  // expiry cron flips renewal_status.
  const today = new Date().toISOString().split('T')[0]
  const activeMemberships = ((member.member_memberships ?? []) as unknown as RawMembership[])
    .filter((m) => m.renewal_status === 'active' && (!m.expires_at || m.expires_at >= today))
    .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())

  const primaryTier = activeMemberships[0] ? tierOf(activeMemberships[0]) : null
  const hasPaidTier = activeMemberships.some((m) => tierOf(m)?.is_free === false)
  const activeTierIds = activeMemberships
    .map((m) => m.tier_id)
    .filter((id): id is string => !!id)

  return {
    id: member.id,
    first_name: member.first_name,
    last_name: member.last_name,
    email: member.email,
    isAdmin,
    event_role: (member.event_role as string | null) ?? null,
    hasPaidTier,
    activeTierName: primaryTier?.name ?? null,
    activeTierIds,
  } satisfies CommunityMember
}

// ─── Entitlement engine (content_entitlements, migration 017) ──────────────
// The flexible tier→content gating map. While the business is still mapping out
// which tiers get which gated content, gating is editable at runtime via the
// admin matrix UI — no code or schema change required.
//
// Resolution rule: if ANY entitlement row exists for a (target_type, target_ref),
// access is decided ONLY by the table. If NO rows exist for that target, callers
// fall back to the legacy min_tier_rank path so existing content is unaffected.

export type EntitlementTargetType =
  | 'space'
  | 'resource'
  | 'training_module'
  | 'event_material'
  | 'campaign_material'
  | 'mentoring'
  | 'coaching'

export type AccessLevel = 'view' | 'download' | 'enroll' | 'host'

/**
 * Whether `member` is entitled to a specific target at (at least) `accessLevel`.
 *
 * Returns one of:
 *   - true  → an entitlement row grants this tier the access
 *   - false → entitlement rows exist for this target but none match the member
 *   - null  → NO entitlement rows configured for this target; caller should fall
 *             back to legacy min_tier_rank gating (memberMeetsTier)
 */
export async function memberHasEntitlement(
  member: CommunityMember,
  targetType: EntitlementTargetType,
  targetRef: string,
  accessLevel: AccessLevel = 'view'
): Promise<boolean | null> {
  const db = supabaseServer()
  // Match the specific target OR a category-wide ('*') grant.
  const { data: rows } = await db
    .from('content_entitlements')
    .select('tier_id, access_level, target_ref')
    .eq('target_type', targetType)
    .in('target_ref', [targetRef, '*'])

  if (!rows || rows.length === 0) return null // not configured → legacy fallback

  // Higher access levels imply the lower ones (download implies view, etc.).
  const rank: Record<AccessLevel, number> = { view: 0, download: 1, enroll: 2, host: 3 }
  const needed = rank[accessLevel]
  const tierSet = new Set(member.activeTierIds)

  return rows.some((r) => {
    if (rank[r.access_level as AccessLevel] < needed) return false
    return r.tier_id ? tierSet.has(r.tier_id) : false // membership-tier row
  })
}

/**
 * Combined gate: entitlement table first, legacy min_tier_rank as fallback.
 * Use this everywhere content has a min_tier_rank column.
 */
export async function memberCanAccess(
  member: CommunityMember,
  targetType: EntitlementTargetType,
  targetRef: string,
  minTierRank: number,
  accessLevel: AccessLevel = 'view'
): Promise<boolean> {
  // Platform admins bypass every entitlement/tier/prerequisite gate.
  if (member.isAdmin) return true
  const entitled = await memberHasEntitlement(member, targetType, targetRef, accessLevel)
  let allowed = entitled !== null ? entitled : memberMeetsTier(member, minTierRank)
  // Space-assigned training is available to active members of any space it was
  // assigned to, regardless of their tier (a course attached to a Space the member
  // belongs to should never read "Locked").
  if (!allowed && targetType === 'training_module') {
    allowed = await memberHasSpaceTrainingGrant(member.id, targetRef)
  }
  if (!allowed) return false
  // Prerequisite gate (Phase 5): even when a source grants access, a target stays
  // locked until its predecessor is complete. Completion is member-level (D6).
  return prerequisitesMet(member, targetType, targetRef)
}

/**
 * Whether a training module was assigned (via the admin Space config) to any
 * Space the member is an *active* roster member of. Such courses are open to the
 * space's members regardless of their membership tier.
 */
export async function memberHasSpaceTrainingGrant(
  memberId: string,
  moduleId: string
): Promise<boolean> {
  const db = supabaseServer()
  const { data: assigned } = await db
    .from('community_space_training')
    .select('space_id')
    .eq('training_module_id', moduleId)
  const spaceIds = (assigned ?? []).map((r) => (r as { space_id: string }).space_id)
  if (spaceIds.length === 0) return false

  const { data: roster } = await db
    .from('community_space_members')
    .select('space_id')
    .eq('member_id', memberId)
    .eq('status', 'active')
    .in('space_id', spaceIds)
  return (roster ?? []).length > 0
}

/**
 * Space access convenience wrapper — entitlement-aware (Access Map) with the
 * space's min_tier_rank as legacy fallback. Use for every space view/feed gate
 * so the page, posts, comments and chat all agree.
 */
export async function memberCanAccessSpace(
  member: CommunityMember,
  space: { id: string; min_tier_rank: number }
): Promise<boolean> {
  return memberCanAccess(member, 'space', space.id, space.min_tier_rank, 'view')
}

/**
 * Whether every prerequisite of (targetType, targetRef) is satisfied for `member`.
 * Returns true when no prerequisites are configured. Supports requirements on a
 * training module (all its items completed) — the common case in the PRD.
 */
export async function prerequisitesMet(
  member: CommunityMember,
  targetType: EntitlementTargetType,
  targetRef: string
): Promise<boolean> {
  const db = supabaseServer()
  const { data: prereqs } = await db
    .from('content_prerequisites')
    .select('requires_target_type, requires_target_ref')
    .eq('target_type', targetType)
    .eq('target_ref', targetRef)

  if (!prereqs || prereqs.length === 0) return true

  for (const p of prereqs as { requires_target_type: string; requires_target_ref: string }[]) {
    if (p.requires_target_type === 'training_module') {
      if (!(await trainingModuleCompleted(member.id, p.requires_target_ref))) return false
    }
    // 'resource' prerequisites have no completion signal yet — treated as met.
  }
  return true
}

/** True when the member has completed every item in the training module. */
async function trainingModuleCompleted(memberId: string, moduleId: string): Promise<boolean> {
  const db = supabaseServer()
  const { data: items } = await db.from('training_items').select('id').eq('module_id', moduleId)
  const itemIds = (items ?? []).map((i) => i.id)
  if (itemIds.length === 0) return true // nothing to complete

  const { data: done } = await db
    .from('training_progress')
    .select('item_id')
    .eq('member_id', memberId)
    .eq('status', 'completed')
    .in('item_id', itemIds)

  return (done?.length ?? 0) >= itemIds.length
}

/**
 * Whether a member meets a content's required tier rank.
 *   rank 0 → any authenticated member (free included)
 *   rank 1 → requires a paid tier
 * Mirrors `min_tier_rank` on community_spaces / community_resources.
 */
export function memberMeetsTier(member: CommunityMember, minTierRank: number): boolean {
  if (minTierRank <= 0) return true
  return member.hasPaidTier
}

export interface CommunitySpace {
  id: string
  slug: string
  name: string
  description: string | null
  min_tier_rank: number
  is_archived: boolean
}

/** Fetch a single non-archived space by slug, or null. */
export async function getSpaceBySlug(slug: string): Promise<CommunitySpace | null> {
  const db = supabaseServer()
  const { data } = await db
    .from('community_spaces')
    .select('id, slug, name, description, min_tier_rank, is_archived')
    .eq('slug', slug)
    .eq('is_archived', false)
    .maybeSingle()
  return data ?? null
}

/**
 * Flatten a TipTap document into plain text for the `body_text` search column
 * (FR-COM-09). Walks the node tree collecting `text` leaves, separating block
 * nodes with newlines. Safe to call on null/unknown shapes.
 */
export function tiptapToPlainText(doc: unknown): string {
  if (!doc || typeof doc !== 'object') return ''
  const parts: string[] = []
  const blockTypes = new Set(['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock'])

  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    const n = node as { type?: string; text?: string; content?: unknown[]; attrs?: Record<string, unknown> }
    if (typeof n.text === 'string') parts.push(n.text)
    if (n.type === 'mention' && typeof n.attrs?.label === 'string') parts.push(`@${n.attrs.label}`)
    if (Array.isArray(n.content)) n.content.forEach(walk)
    if (n.type && blockTypes.has(n.type)) parts.push('\n')
  }

  walk(doc)
  return parts.join(' ').replace(/\s*\n\s*/g, '\n').replace(/[ \t]+/g, ' ').trim()
}
