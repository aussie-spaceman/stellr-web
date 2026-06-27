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
import { logActivity, type Actor, type ActorType } from '@/lib/activity-log'
import { grantCredits, type CreditType } from '@/lib/credits'

export type GrantTrigger =
  | 'signup'
  | 'event_attendance'
  | 'event_award'
  | 'mentor_at_event'
  | 'subscribe_website'
  | 'graduation'
  | 'manual'
  // Fired for every member registered into a competition (event or campaign), at
  // registration time. The seeded rule grants school students Pathfinder for 12mo.
  | 'competition_registration'
  // Fired when a member acquires a membership tier (Stripe purchase or admin
  // assignment), carrying the acquired tier in ctx.sourceTierId. Powers the
  // "educator buys Innovator/Trailblazer → their registered students get
  // Pathfinder" fan-out rule (grant_target='registered_students').
  | 'tier_purchased'
  // Dormant: legacy content-tier enrollment trigger (content tiers retired). Kept
  // so existing rows validate; no caller fires it.
  | 'campaign_enrollment'

export type GrantSource = 'stripe' | 'rule' | 'manual' | 'system'

/** Who receives a rule's grant: the triggering member, or the students they registered. */
export type GrantTarget = 'self' | 'registered_students'

export interface GrantRule {
  id: string
  name: string
  trigger_type: GrantTrigger
  conditions: {
    age_bracket?: string
    event_role?: string
    award_contains?: string
    /** tier_purchased only: the acquired tier must be one of these for the rule to fire. */
    source_tier_ids?: string[]
  }
  /** Null for credit-granting rules (grant_kind='credits'). */
  grant_tier_id: string | null
  duration_kind: 'months' | 'until_grad_july1' | 'lifetime' | 'match_source'
  duration_months: number | null
  grant_target: GrantTarget
  replaces_free: boolean
  priority: number
  is_active: boolean
  /** 'tier' (grant a membership tier) | 'credits' (grant wallet credits). Default 'tier'. */
  grant_kind?: 'tier' | 'credits'
  /** credits only: which wallet to top up. */
  grant_credit_type?: CreditType | null
  /** credits only: how many credits to grant. */
  grant_quantity?: number | null
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
  /**
   * Who is performing the grant, for the activity log. When omitted the actor
   * type is inferred from `source` (stripe→stripe, manual→admin, rule/system→system).
   */
  logActor?: Actor
}

/** Default activity-log actor type when a grant doesn't specify one. */
function actorTypeForSource(source: GrantSource): ActorType {
  if (source === 'stripe') return 'stripe'
  if (source === 'manual') return 'admin'
  return 'system' // rule | system
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
    logActor,
  } = opts

  if (!tierId) return { granted: false, reason: 'no_tier' }

  // Tier name + is_free, used for both the complimentary inference below and the
  // activity-log summary after a successful insert.
  const { data: tierRow } = await db
    .from('membership_tiers')
    .select('name, is_free')
    .eq('id', tierId)
    .maybeSingle()
  const tierName = tierRow?.name ?? 'membership'

  // Resolve is_complimentary when the caller didn't force it: a Stripe grant is
  // never complimentary; a comped PAID tier (e.g. "1yr free Pathfinder") is; a
  // plain FREE default tier (e.g. Explorer at signup) is not.
  let isComplimentary = complimentary
  if (isComplimentary === undefined) {
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

  // Audit trail — captures every grant path (manual, rule, signup, cron, Stripe).
  const isLifetime = resolvedExpiry == null
  await logActivity(
    {
      memberId,
      category: 'membership',
      action: 'tier_granted',
      summary: isLifetime
        ? `Granted ${tierName} membership (no expiry)`
        : `Granted ${tierName} membership through ${expiresAtValue}`,
      metadata: {
        tierId,
        tierName,
        source,
        complimentary: isComplimentary,
        expiresAt: resolvedExpiry,
        ruleId,
      },
      actorType: logActor?.actorType ?? actorTypeForSource(source),
      actorMemberId: logActor?.actorMemberId ?? null,
      actorLabel: logActor?.actorLabel ?? null,
    },
    db,
  )

  return { granted: true, membershipId: inserted.id }
}

export interface TriggerContext {
  /** event_award only: the award text, matched against rule.conditions.award_contains. */
  award?: string | null
  /** Overrides member.graduation_year for the 'graduation' trigger. */
  graduationYear?: number | null
  /** tier_purchased only: the tier the member just acquired (rule match + match_source expiry). */
  sourceTierId?: string | null
  /**
   * Idempotency seed for credit grants — pass the underlying event id (event
   * participation id, source membership id, …) so a credit-granting rule fires
   * once per real occurrence, not once per webhook retry / re-fire. Defaults to
   * the member id (one grant ever) when omitted.
   */
  grantKeySeed?: string | null
}

/**
 * Evaluate the active tier_grant_rules for `trigger` against `memberId` and grant
 * the single highest-priority matching tier. The grant lands on the triggering
 * member ('self') or fans out to the students that member registered
 * ('registered_students'). Returns the grant result plus the rule that fired.
 */
export async function applyGrantTrigger(
  memberId: string,
  trigger: GrantTrigger,
  ctx: TriggerContext = {},
  client?: SupabaseClient,
): Promise<{ rule: GrantRule | null; grantedCount?: number } & GrantResult> {
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

  // Credit-pack grant: hand out N wallet credits (cohort/workshop) instead of a
  // tier. Honours the same self / registered_students fan-out as the tier path.
  if (rule.grant_kind === 'credits') {
    const creditType = rule.grant_credit_type ?? null
    const qty = rule.grant_quantity ?? 0
    if (!creditType || qty <= 0) return { rule, granted: false, reason: 'no_tier' }

    const seed = ctx.grantKeySeed ?? memberId
    const targets =
      rule.grant_target === 'registered_students' ? await registeredStudentIds(db, memberId) : [memberId]

    let grantedCount = 0
    for (const tid of targets) {
      const n = await grantCredits(tid, creditType, qty, {
        source: 'grant',
        grantKey: `${rule.id}:${seed}:${tid}`,
      })
      if (n > 0) {
        grantedCount++
        await logActivity(
          {
            memberId: tid,
            category: 'billing',
            action: 'credit_granted',
            summary: `Granted ${n} ${creditType === 'workshop' ? 'workshop' : 'cohort'} credit${n === 1 ? '' : 's'} (${rule.name})`,
            metadata: { ruleId: rule.id, creditType, quantity: n, trigger },
            actorType: 'system',
          },
          db,
        )
      }
    }
    return { rule, granted: grantedCount > 0, grantedCount }
  }

  // Tier grant path: a tier rule always names a tier (DB shape constraint).
  const grantTierId = rule.grant_tier_id
  if (!grantTierId) return { rule, granted: false, reason: 'no_tier' }

  // Resolve duration → months | expiresAt.
  let months: number | null | undefined
  let expiresAt: string | null | undefined
  if (rule.duration_kind === 'until_grad_july1') {
    const gradYear = ctx.graduationYear ?? (member.graduation_year as number | null)
    expiresAt = gradYear ? julyFirst(gradYear) : null
  } else if (rule.duration_kind === 'lifetime') {
    months = null
  } else if (rule.duration_kind === 'match_source') {
    // Expire with the triggering membership (students' Pathfinder lapses when the
    // educator's Innovator/Trailblazer does). Fall back to 12mo if not resolvable.
    expiresAt = await sourceMembershipExpiry(db, memberId, ctx.sourceTierId ?? null)
    if (expiresAt === undefined) months = rule.duration_months ?? 12
  } else {
    months = rule.duration_months
  }

  // Fan-out: grant to the students this (educator) member registered.
  if (rule.grant_target === 'registered_students') {
    const studentIds = await registeredStudentIds(db, memberId)
    let grantedCount = 0
    for (const sid of studentIds) {
      const r = await grantTier(
        { memberId: sid, tierId: grantTierId, months, expiresAt, source: 'rule', ruleId: rule.id, replacesFree: rule.replaces_free },
        db,
      )
      if (r.granted) grantedCount++
    }
    return { rule, granted: grantedCount > 0, grantedCount }
  }

  const result = await grantTier(
    {
      memberId,
      tierId: grantTierId,
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

/** YYYY-MM-DD expiry of the member's active membership on `tierId`, or undefined if none. */
async function sourceMembershipExpiry(
  db: SupabaseClient,
  memberId: string,
  tierId: string | null,
): Promise<string | undefined> {
  if (!tierId) return undefined
  const { data } = await db
    .from('member_memberships')
    .select('expires_at')
    .eq('member_id', memberId)
    .eq('tier_id', tierId)
    .eq('renewal_status', 'active')
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data?.expires_at as string | null) ?? undefined
}

/**
 * The distinct student member ids an educator registered: participants of the
 * group registrations they own (registrations.teacher_member_id), filtered to
 * student roles so an adult co-registrant never receives a student grant.
 */
async function registeredStudentIds(db: SupabaseClient, educatorMemberId: string): Promise<string[]> {
  const { data: regs } = await db
    .from('registrations')
    .select('id')
    .eq('teacher_member_id', educatorMemberId)
  const regIds = (regs ?? []).map((r) => r.id as string)
  if (regIds.length === 0) return []

  const { data: parts } = await db
    .from('participants')
    .select('member_id, members(event_role)')
    .in('registration_id', regIds)
    .not('member_id', 'is', null)

  const STUDENT_ROLES = new Set(['participant', 'school_student_manager'])
  const ids = new Set<string>()
  for (const p of parts ?? []) {
    const m = Array.isArray(p.members) ? p.members[0] : p.members
    const role = (m as { event_role?: string } | null)?.event_role
    if (p.member_id && role && STUDENT_ROLES.has(role)) ids.add(p.member_id as string)
  }
  return [...ids]
}

/**
 * Fire the tier_purchased trigger for a member who just acquired `tierId` (Stripe
 * activation or admin assignment). Non-fatal: tier acquisition must never fail
 * because a downstream fan-out grant errored.
 */
export async function fireTierPurchased(
  memberId: string,
  tierId: string,
  client?: SupabaseClient,
): Promise<void> {
  try {
    await applyGrantTrigger(memberId, 'tier_purchased', { sourceTierId: tierId }, client)
  } catch (e) {
    console.error('[membership-grants] fireTierPurchased failed (non-fatal):', e)
  }
}

function matchesConditions(
  rule: GrantRule,
  member: { age_bracket?: string | null; event_role?: string | null },
  ctx: TriggerContext,
): boolean {
  const c = rule.conditions ?? {}
  if (c.age_bracket && member.age_bracket !== c.age_bracket) return false
  if (c.event_role) {
    // A Student Manager is a student who also organises the group, so any rule
    // scoped to plain school students (e.g. attend → Pathfinder, award → Scholar)
    // applies to them too. Teacher/mentor-scoped rules are unaffected.
    const matches =
      member.event_role === c.event_role ||
      (c.event_role === 'participant' && member.event_role === 'school_student_manager')
    if (!matches) return false
  }
  if (c.award_contains) {
    const award = (ctx.award ?? '').toLowerCase()
    if (!award.includes(c.award_contains.toLowerCase())) return false
  }
  // tier_purchased: the acquired tier must be in the rule's source list (if set).
  if (c.source_tier_ids && c.source_tier_ids.length) {
    if (!ctx.sourceTierId || !c.source_tier_ids.includes(ctx.sourceTierId)) return false
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
    .select('id, member_id, membership_tiers(name)')
    .eq('renewal_status', 'active')
    .is('stripe_subscription_id', null)
    .lt('expires_at', today)

  if (!lapsed?.length) return 0
  await db
    .from('member_memberships')
    .update({ renewal_status: 'expired' })
    .in('id', lapsed.map((r) => r.id))

  // Audit trail — one entry per member whose grant lapsed.
  for (const row of lapsed) {
    const tier = Array.isArray(row.membership_tiers) ? row.membership_tiers[0] : row.membership_tiers
    const tierName = (tier as { name?: string } | null)?.name ?? 'membership'
    await logActivity(
      {
        memberId: row.member_id as string,
        category: 'membership',
        action: 'tier_expired',
        summary: `${tierName} membership expired`,
        metadata: { membershipId: row.id, tierName },
        actorType: 'system',
      },
      db,
    )
  }

  return lapsed.length
}
