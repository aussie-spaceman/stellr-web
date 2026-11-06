import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { isMinorOn } from '@/lib/age'
import { isLiteralStoragePath } from '@/lib/storage-path'
import {
  getCurrentMember as currentMember,
  getSignedInMember as signedInMember,
  type CommunityMember,
} from '@/lib/member-session'

/**
 * deep review MEM-10 (safeguarding / minors' PII): is this member a minor, for
 * the purpose of directory discovery and @mentions? True when their date of
 * birth says so, or — DOB missing — when they are classified high-school. A
 * minor must never be listable in the directory, returned by mention-search, or
 * emailed an @mention by an arbitrary adult.
 */
export function memberIsMinor(m: { date_of_birth?: string | null; age_bracket?: string | null }): boolean {
  return isMinorOn(m.date_of_birth) || m.age_bracket === 'high_school'
}

/**
 * What a member may do in the community, by age and consent (decision 24,
 * 3 Nov 2026). The ONE place every community write route asks:
 *
 *   'full'            — no age restriction beyond the existing gates.
 *   'consent_pending' — a self-registered minor whose parent or guardian has
 *                       not signed yet (lib/pending-consent). Read-only: no
 *                       posting, comments, chat, reactions, uploads,
 *                       contributions or Space joins.
 *   'child'           — under 13, consent given. No directory listing and no
 *                       mentions (memberIsMinor already covers both); posting
 *                       only in moderated spaces, and no pre-moderated space
 *                       exists yet, so no posts, comments, chat, uploads or
 *                       contributions. Reacting and joining a Space stay open.
 *                       Applies while MINOR_SELF_SIGNUP_ENABLED is on, so the
 *                       live behaviour of existing members does not change
 *                       before the owner approves the revised Terms.
 *   'inactive'        — under 13, parent not yet consented. Nothing at all.
 *                       getCurrentMember already resolves no member for them,
 *                       so this is the backstop for a caller that resolved the
 *                       member another way.
 *
 * Fails closed: when the pending-consent read fails, a member whose date of
 * birth says under 18 (or cannot be read) is treated as pending, never 'full'.
 *
 * Directory listing and mention search need nothing extra: every account this
 * can return other than 'full' is under 18, and memberIsMinor already keeps
 * minors out of both (deep review MEM-10).
 */
export type CommunityTier = 'full' | 'consent_pending' | 'child' | 'inactive'

export async function memberCommunityTier(
  member: { id: string; date_of_birth?: string | null; isAdmin?: boolean },
): Promise<CommunityTier> {
  if (member.isAdmin) return 'full'
  const pc = await import('@/lib/pending-consent')
  const db = supabaseServer()
  const read = await pc.readPendingConsent(db, member.id)
  if (read.state === 'unknown') {
    if (!isMinorOn(member.date_of_birth)) return 'full'
    return pc.isKnownUnder13(member.date_of_birth) ? 'inactive' : 'consent_pending'
  }
  if (read.state === 'pending' && !(await pc.settlePendingConsent(db, member.id))) {
    return read.row.band === 'child' ? 'inactive' : 'consent_pending'
  }
  if (pc.minorSelfSignupEnabled() && pc.isKnownUnder13(member.date_of_birth)) return 'child'
  return 'full'
}

/**
 * The kinds of member-initiated community write. Every POST/PUT/PATCH/DELETE
 * handler under app/api/community asks communityWriteBlock with one of these,
 * or is named with its reason in COMMUNITY_WRITE_EXEMPT
 * (app/api/community/write-gate.test.ts fails the build otherwise).
 *
 *   post, comment, chat — content other members read
 *   react               — a reaction on someone's post
 *   upload, contribute  — a file into a post, a Space or a resource container
 *   join                — joining a Space, cohort or workshop (or accepting an invite to one)
 *   request             — asking for, or booking, a coaching session with a coach
 *   purchase            — buying session credits
 *   host                — running a cohort or workshop: schedules, actions, attendees
 *   message             — contacting other members directly (a teacher's nudge)
 *   moderate            — moderator actions on other members' posts
 */
export type CommunityWrite =
  | 'post' | 'comment' | 'chat' | 'react' | 'upload' | 'contribute' | 'join'
  | 'request' | 'purchase' | 'host' | 'message' | 'moderate'

/**
 * What a consented under-13 may do. Joining (a Space, a cohort) and reacting,
 * as before, and buying the credits a cohort costs. Never one-to-one coaching
 * with an adult, hosting, messaging or moderating.
 */
const CHILD_ALLOWED: ReadonlySet<CommunityWrite> = new Set(['react', 'join', 'purchase'])

/** Whether a member of `tier` may make this kind of community write. */
export function tierAllows(tier: CommunityTier, action: CommunityWrite): boolean {
  if (tier === 'full') return true
  if (tier === 'consent_pending' || tier === 'inactive') return false
  return CHILD_ALLOWED.has(action)
}

/**
 * The 403 a community write route returns when the member's age or consent
 * state does not allow the action, or null to carry on. Call it straight after
 * resolving the member, before any other work.
 */
export async function communityWriteBlock(
  member: { id: string; date_of_birth?: string | null; isAdmin?: boolean },
  action: CommunityWrite,
): Promise<NextResponse | null> {
  const tier = await memberCommunityTier(member)
  if (tierAllows(tier, action)) return null
  if (tier === 'consent_pending' || tier === 'inactive') {
    const { consentPendingResponse } = await import('@/lib/pending-consent')
    return consentPendingResponse()
  }
  return NextResponse.json(
    { code: 'community_restricted', error: 'This part of the community isn’t available on your account.' },
    { status: 403 },
  )
}

// Private Supabase Storage bucket for community resources (FR-COM-03).
// Create this bucket manually in the Supabase dashboard: name = community-resources, public = false.
export const RESOURCES_BUCKET = 'community-resources'

// Signed URL TTL for downloads — short enough to prevent sharing, long enough for slow connections.
const SIGNED_URL_TTL_SECONDS = 120
// A player requests a video in ranges for as long as someone is watching, so a
// pause or a seek after a two-minute URL has expired would break playback.
export const VIDEO_SIGNED_URL_TTL_SECONDS = 4 * 60 * 60

/**
 * Generate a short-lived signed download URL for a private resource.
 * Only call this after a server-side tier check (FR-COM-03).
 */
export async function signedDownloadUrl(storagePath: string, ttlSeconds = SIGNED_URL_TTL_SECONDS): Promise<string | null> {
  // deep review MEM-1: this helper is shared by every download route and signs
  // with the service_role key, so it fails closed on any path that could escape
  // its intended prefix. storage-js and the WHATWG URL parser normalise `..`/`//`
  // — and `%2e%2e`, `.\t.`, `./`, `?…` — before the request leaves; no
  // legitimate caller passes those (every path is `<prefix>/<id>/<ts>-<safeName>`
  // built server-side), so reject them outright (lib/storage-path).
  if (!isLiteralStoragePath(storagePath)) {
    console.error('[community] refused suspicious storage path')
    return null
  }
  const db = supabaseServer()
  const { data, error } = await db.storage
    .from(RESOURCES_BUCKET)
    .createSignedUrl(storagePath, ttlSeconds)
  if (error) {
    console.error('[community] signed URL error:', error)
    return null
  }
  return data.signedUrl
}

// Shared helpers for the Community module (Component 3).
// All community routes resolve the Clerk user to a member row, then gate access
// in the server layer (the DB tables are service-role only — see migration 012).

export type { CommunityMember }

// Real functions, not `export { … } from`: the route guard check reads a delegate's
// body, and 146 files import these two from here. The work is in lib/member-session.
/** See lib/member-session. Resolves the view-as member while an admin is viewing as one. */
export async function getCurrentMember(): Promise<CommunityMember | null> {
  return currentMember()
}

/** See lib/member-session. The real signed-in member, never the impersonated one. */
export async function getSignedInMember(): Promise<CommunityMember | null> {
  return signedInMember()
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

/**
 * Whether `member` is entitled to a specific target. Access is binary — an
 * entitlement row either grants the member's tier the target or it doesn't.
 * What the member can DO there is decided by their role on the object, never by
 * a graded access "level" (admin/access convergence; levels removed 2026-07).
 *
 * Returns one of:
 *   - true  → an entitlement row grants this tier the access
 *   - false → entitlement rows exist for this target but none match the member
 *   - null  → NO entitlement rows configured for this target; caller should fall
 *             back to legacy min_tier_rank gating (memberMeetsTier)
 */
async function memberHasEntitlement(
  member: CommunityMember,
  targetType: EntitlementTargetType,
  targetRef: string
): Promise<boolean | null> {
  const db = supabaseServer()
  // Match the specific target OR a category-wide ('*') grant.
  const { data: rows } = await db
    .from('content_entitlements')
    .select('tier_id, target_ref')
    .eq('target_type', targetType)
    .in('target_ref', [targetRef, '*'])

  if (!rows || rows.length === 0) return null // not configured → legacy fallback

  const tierSet = new Set(member.activeTierIds)
  return rows.some((r) => (r.tier_id ? tierSet.has(r.tier_id) : false))
}

/**
 * Combined gate: entitlement table first, legacy min_tier_rank as fallback.
 * Use this everywhere content has a min_tier_rank column.
 */
export async function memberCanAccess(
  member: CommunityMember,
  targetType: EntitlementTargetType,
  targetRef: string,
  minTierRank: number
): Promise<boolean> {
  // Platform admins bypass every entitlement/tier/prerequisite gate.
  if (member.isAdmin) return true
  const entitled = await memberHasEntitlement(member, targetType, targetRef)
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
async function memberHasSpaceTrainingGrant(
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
 * Space access convenience wrapper. Delegates to the Space access model
 * (open/private/secret + assigned tiers + assigned roles + roster), which is what
 * the directory and the space pages already use.
 *
 * It used to go through memberCanAccess('space', …), i.e. the content_entitlements
 * matrix with min_tier_rank as fallback. That was a second, disagreeing access
 * system: an entitlement row pinned the OPEN General space to two tiers, so every
 * other tier was blocked from its feed, posts and chat while the directory
 * correctly advertised it as open to all. Conversely min_tier_rank 0 let every
 * member read posts from private tier spaces they could not enter. One resolver
 * now decides, so the page, posts, comments, chat and feed always agree.
 */
export async function memberCanAccessSpace(
  member: CommunityMember,
  space: { id: string }
): Promise<boolean> {
  const { getSpaceAccessById } = await import('@/lib/spaces')
  const access = await getSpaceAccessById(member, space.id)
  return !!access?.canAccess
}

/**
 * Whether every prerequisite of (targetType, targetRef) is satisfied for `member`.
 * Returns true when no prerequisites are configured. Supports requirements on a
 * training module (all its items completed) — the common case in the PRD.
 */
async function prerequisitesMet(
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
