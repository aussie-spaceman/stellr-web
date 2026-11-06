import { cache } from 'react'
import { auth } from '@clerk/nextjs/server'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'
import { isUnder13On, isValidDob } from '@/lib/age'

// Who is signed in, as a member row. Split from lib/community.ts (multi-tenancy
// plan S5, B8), which still exports both functions, so existing imports work.
//
// The split alone does not take a page off the community code. An under-13's consent
// check imports lib/pending-consent, whose own imports still reach lib/community
// (test/tenant-surface.test.ts pins the chain). Cutting that is what would let a page
// move here and shrink the tenant surface.

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
   * 'participant' | 'teacher' | 'mentor' | 'parent'). Used to resolve
   * role-targeted training assignments (FR-COM-10). Null when unset.
   */
  event_role: string | null
  /** Age bracket ('adult' | 'high_school' | 'college'), or null when unset.
   *  Drives per-bracket training requirements (community_space_training). */
  age_bracket: string | null
  /** YYYY-MM-DD, or null for an invited member who has not onboarded. */
  date_of_birth?: string | null
  /**
   * DOB or gender is missing — a hand-created or webhook-created row whose owner
   * has not been through /account/onboarding yet. Member surfaces redirect there,
   * so the under-18 gates never run against an unknown DOB. Always false while an
   * admin is viewing as the member: they cannot submit onboarding for them.
   */
  needsOnboarding: boolean
}

/**
 * Resolve the current Clerk user to a community member, including their tier.
 * Returns null when unauthenticated, no member row exists, or the member is inactive.
 */
export async function getCurrentMember(): Promise<CommunityMember | null> {
  return resolveMemberOnce(true)
}

// One lookup per request. A member page renders its layout, nested layouts and
// page, and each asked for the member again: 46 call sites, each a Clerk auth()
// plus a Supabase round trip. React's cache() shares the result within a
// server render (and is a plain call elsewhere, such as route handlers).
const resolveMemberOnce = cache((allowImpersonation: boolean) => resolveMember(allowImpersonation))

/**
 * The REAL signed-in member, never the impersonated one.
 *
 * Admin surfaces use this: they want the acting admin's identity for
 * created_by / resolved_by / author fields, and an admin who happens to be
 * mid-"view as member" must not have their admin actions recorded against the
 * person they were looking at.
 */
export async function getSignedInMember(): Promise<CommunityMember | null> {
  return resolveMemberOnce(false)
}

async function resolveMember(allowImpersonation: boolean): Promise<CommunityMember | null> {
  const { userId, sessionClaims } = await auth()
  if (!userId) return null
  let isAdmin = isAdminClaims(sessionClaims)

  // Admin "view as member": this ONE branch turns the whole member portal into
  // that member's view, because every member-facing page and API route resolves
  // itself through here. lib/impersonation re-checks the admin claim, so a
  // lingering cookie on a non-admin session resolves to null and changes nothing.
  const { impersonatedMemberId } = await import('@/lib/impersonation')
  const viewAsId = allowImpersonation && isAdmin ? await impersonatedMemberId() : null

  const db = supabaseServer()
  const query = db
    .from('members')
    .select(`
      id, first_name, last_name, email, event_role, age_bracket, date_of_birth, gender,
      member_memberships(renewal_status, started_at, expires_at, tier_id, membership_tiers(name, is_free))
    `)
  const { data: member } = viewAsId
    ? await query.eq('id', viewAsId).maybeSingle()
    : await query.eq('clerk_user_id', userId).maybeSingle()

  if (!member) return null

  // Drop the admin bypass while viewing as someone else. Without this the
  // admin's own claims satisfy every tier, entitlement and Space gate, so the
  // portal would show what an ADMIN sees rather than what the member sees —
  // which is the entire point of the feature.
  if (viewAsId) isAdmin = false

  // Decision 24, COPPA: a child under 13 whose
  // parent has not consented is not a member yet. Resolving no member here
  // makes every member page send them to /account/onboarding (the waiting
  // page) and every member API refuse them, reads included. Only asked for
  // an under-13 date of birth (every pending child has one: the age screen
  // writes it), so nobody else pays the extra read; fails closed.
  // An admin viewing as the child still sees their account.
  const dob = member.date_of_birth as string | null
  if (!viewAsId && !isAdmin && isValidDob(dob) && isUnder13On(dob)) {
    const { childAwaitingConsent } = await import('@/lib/pending-consent')
    if (await childAwaitingConsent(db, member.id)) return null
  }

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
    age_bracket: (member.age_bracket as string | null) ?? null,
    date_of_birth: (member.date_of_birth as string | null) ?? null,
    hasPaidTier,
    activeTierName: primaryTier?.name ?? null,
    activeTierIds,
    needsOnboarding: !viewAsId && (!member.date_of_birth || !member.gender),
  } satisfies CommunityMember
}
