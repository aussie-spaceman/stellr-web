// Membership grant engine (migration 025).
//
// One place that knows how to put a member on a tier, and how to decide which
// tier a trigger should grant. Replaces the hardcoded bracket→role→tier logic in
// lib/membership-rules.ts and the scattered inline membership inserts.
//
// Two entry points:
//   • grantTier()         — low-level: place a member on a tier for N months.
//   • applyGrantTrigger() — high-level: evaluate tier_grant_rules for an event
//                           ("attended", "won award", "signed up", …) and grant
//                           the highest-priority matching tier, if any.
//
// All gating reads stay in lib/community.ts; this module only WRITES memberships.

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseServer } from '@/lib/supabase'

export type GrantTrigger =
  | 'signup'
  | 'event_attendance'
  | 'event_award'
  | 'mentor_at_event'
  | 'subscribe_website'
  | 'graduation'
  | 'manual'

export type GrantSource = 'stripe' | 'rule' | 'manual' | 'system'

export interface GrantRule {
  id: string
  name: string
  trigger_type: GrantTrigger
  conditions: {
    age_bracket?: string
    event_role?: string
    award_contains?: string
  }
  grant_tier_id: string
  duration_kind: 'months' | 'until_grad_july1' | 'lifetime'
  duration_months: number | null
  replaces_free: boolean
  priority: number
  is_active: boolean
}

const LIFETIME_DAYS = 365 * 100

/** Date string (YYYY-MM-DD) `months` from now, or null for an open-ended grant. */
function expiryFromMonths(months: number | null | undefined): string | null {
  if (months == null) return null
  const d = new Date()
  d.setMonth(d.getMonth() + months)
  return d.toISOString().split('T')[0]
}

/** July 1 of `year` as a YYYY-MM-DD string. */
function julyFirst(year: number): string {
  return `${year}-07-01`
}

export interface GrantTierOptions {
  memberId: string
  tierId: string
  /** Months until expiry; null/undefined → lifetime (≈100yr). Ignored if expiresAt given. */
  months?: number | null
  /** Explicit expiry (YYYY-MM-DD). Wins over `months`. */
  expiresAt?: string | null
  source: GrantSource
  ruleId?: string | null
  /** Expire the member's active FREE memberships when granting (default true). */
  replacesFree?: boolean
  /** Complimentary = not a paid Stripe membership (default true for non-stripe sources). */
  complimentary?: boolean
}

export interface GrantResult {
  granted: boolean
  /** Why nothing happened, when granted is false. */
  reason?: 'already_active' | 'no_tier'
  membershipId?: string
}

/**
 * Put `memberId` on `tierId`. Idempotent: if the member already holds an active,
 * non-expired membership on this tier, nothing is inserted. Optionally expires
 * the member's active FREE memberships first (the upgrade/downgrade behaviour).
 */
export async function grantTier(
  opts: GrantTierOptions,
  client?: SupabaseClient,
): Promise<GrantResult> {
  const db = client ?? supabaseServer()
  const {
    memberId, tierId, months, expiresAt,
    source, ruleId = null,
    replacesFree = true,
    complimentary,
  } = opts

  if (!tierId) return { granted: false, reason: 'no_tier' }

  // Resolve is_complimentary when the caller didn't force it: a Stripe grant is
  // never complimentary; a comped PAID tier (e.g. "1yr free Pathfinder") is; a
  // plain FREE default tier (e.g. Explorer at signup) is not.
  let isComplimentary = complimentary
  if (isComplimentary === undefined) {
    const { data: tierRow } = await db.from('membership_tiers').select('is_free').eq('id', tierId).maybeSingle()
    isComplimentary = source !== 'stripe' && tierRow?.is_free === false
  }

  // Idempotency: skip if already actively on this tier and not past expiry.
  const { data: existing } = await db
    .from('member_memberships')
    .select('id, expires_at')
    .eq('member_id', memberId)
    .eq('tier_id', tierId)
    .eq('renewal_status', 'active')
    .maybeSingle()
  if (existing && (!existing.expires_at || existing.expires_at >= new Date().toISOString().split('T')[0])) {
    return { granted: false, reason: 'already_active', membershipId: existing.id }
  }

  // Expire active FREE memberships when this grant replaces them.
  if (replacesFree) {
    const { data: actives } = await db
      .from('member_memberships')
      .select('id, membership_tiers(is_free)')
      .eq('member_id', memberId)
      .eq('renewal_status', 'active')
    for (const a of actives ?? []) {
      const tier = Array.isArray(a.membership_tiers) ? a.membership_tiers[0] : a.membership_tiers
      if ((tier as { is_free?: boolean } | null)?.is_free) {
        await db.from('member_memberships').update({ renewal_status: 'expired' }).eq('id', a.id)
      }
    }
  }

  const resolvedExpiry =
    expiresAt !== undefined
      ? expiresAt
      : months === null
        ? expiryFromMonths(null) // lifetime → null, but column may be NOT NULL; handled below
        : expiryFromMonths(months ?? null)

  // The base member_memberships.expires_at carries a NOT NULL default in some
  // environments, so never write a literal null — use a far-future date instead.
  const expiresAtValue =
    resolvedExpiry ?? new Date(Date.now() + LIFETIME_DAYS * 86_400_000).toISOString().split('T')[0]

  const { data: inserted, error } = await db
    .from('member_memberships')
    .insert({
      member_id: memberId,
      tier_id: tierId,
      started_at: new Date().toISOString().split('T')[0],
      expires_at: expiresAtValue,
      renewal_status: 'active',
      is_complimentary: isComplimentary,
      source,
      granted_by_rule: ruleId,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[membership-grants] grantTier insert error:', error)
    return { granted: false, reason: 'no_tier' }
  }
  return { granted: true, membershipId: inserted.id }
}

export interface TriggerContext {
  /** event_award only: the award text, matched against rule.conditions.award_contains. */
  award?: string | null
  /** Overrides member.graduation_year for the 'graduation' trigger. */
  graduationYear?: number | null
}

/**
 * Evaluate the active tier_grant_rules for `trigger` against `memberId` and grant
 * the single highest-priority matching tier. Returns the grant result plus the
 * rule that fired (if any). Safe to call from request handlers and crons.
 */
export async function applyGrantTrigger(
  memberId: string,
  trigger: GrantTrigger,
  ctx: TriggerContext = {},
  client?: SupabaseClient,
): Promise<{ rule: GrantRule | null } & GrantResult> {
  const db = client ?? supabaseServer()

  const [{ data: member }, { data: rules }] = await Promise.all([
    db.from('members').select('age_bracket, event_role, graduation_year').eq('id', memberId).maybeSingle(),
    db.from('tier_grant_rules')
      .select('*')
      .eq('trigger_type', trigger)
      .eq('is_active', true)
      .order('priority', { ascending: false }),
  ])

  if (!member || !rules?.length) return { rule: null, granted: false, reason: 'no_tier' }

  const rule = (rules as GrantRule[]).find((r) => matchesConditions(r, member, ctx)) ?? null
  if (!rule) return { rule: null, granted: false, reason: 'no_tier' }

  // Resolve duration.
  let months: number | null | undefined
  let expiresAt: string | null | undefined
  if (rule.duration_kind === 'until_grad_july1') {
    const gradYear = ctx.graduationYear ?? (member.graduation_year as number | null)
    expiresAt = gradYear ? julyFirst(gradYear) : null
  } else if (rule.duration_kind === 'lifetime') {
    months = null
  } else {
    months = rule.duration_months
  }

  const result = await grantTier(
    {
      memberId,
      tierId: rule.grant_tier_id,
      months,
      expiresAt,
      source: 'rule',
      ruleId: rule.id,
      replacesFree: rule.replaces_free,
    },
    db,
  )
  return { rule, ...result }
}

function matchesConditions(
  rule: GrantRule,
  member: { age_bracket?: string | null; event_role?: string | null },
  ctx: TriggerContext,
): boolean {
  const c = rule.conditions ?? {}
  if (c.age_bracket && member.age_bracket !== c.age_bracket) return false
  if (c.event_role && member.event_role !== c.event_role) return false
  if (c.award_contains) {
    const award = (ctx.award ?? '').toLowerCase()
    if (!award.includes(c.award_contains.toLowerCase())) return false
  }
  return true
}

/**
 * Expire complimentary/rule-granted memberships whose expires_at has passed.
 * Paid (Stripe) memberships are left to the Stripe webhook. Returns the count.
 */
export async function expireLapsedGrants(client?: SupabaseClient): Promise<number> {
  const db = client ?? supabaseServer()
  const today = new Date().toISOString().split('T')[0]

  const { data: lapsed } = await db
    .from('member_memberships')
    .select('id')
    .eq('renewal_status', 'active')
    .is('stripe_subscription_id', null)
    .lt('expires_at', today)

  if (!lapsed?.length) return 0
  await db
    .from('member_memberships')
    .update({ renewal_status: 'expired' })
    .in('id', lapsed.map((r) => r.id))
  return lapsed.length
}
