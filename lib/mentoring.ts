// lib/mentoring.ts — server-side domain logic for the Mentoring V2 redesign.
// Mentoring = small-group Cohorts. This module owns the redesign-specific concerns
// layered on top of the existing cohort/session service in lib/sessions.ts:
//   • the mentoring CREDIT ledger (per-tier annual grant, rollover, top-ups),
//   • per-cohort ACCESS resolution (free-with-membership / credit / one-off),
//   • the DISCOVER catalogue of open cohorts and self-registration.
//
// Decisions (2026-06-23): free-mentoring is a per-tier admin toggle
// (membership_tiers.includes_free_mentoring); credits are a per-tier annual grant
// (membership_tiers.mentoring_credits_grant), 1 credit = 1 cohort enrollment;
// unused credits roll over (allowance rows are never expired); paid top-ups are
// allowed; cohort cancellation refunds the spent credit as account credit.
import 'server-only'
import { supabaseServer } from '@/lib/supabase'
import type { CommunityMember } from '@/lib/community'
import type { AccessKind, CohortTheme } from '@/lib/mentoring-format'

// ─── Credits ────────────────────────────────────────────────────────────────

export interface MentoringCredits {
  /** Available to spend now (allowance roll-over + purchased top-ups). */
  remaining: number
  /** Spent on cohort enrollments. */
  used: number
  /** Total ever granted/purchased (remaining + used). */
  total: number
}

/**
 * Idempotently materialise each active membership's annual mentoring-credit
 * allowance as `session_credits` rows. Keying on the membership id means a grant
 * is created exactly once per membership period; because we never expire allowance
 * rows, unused credits simply roll over into the next period (decision D3).
 */
export async function syncMentoringAllowance(member: CommunityMember): Promise<void> {
  const db = supabaseServer()

  // Active memberships + their tier's annual grant.
  const today = new Date().toISOString().split('T')[0]
  const { data: ms } = await db
    .from('member_memberships')
    .select('id, tier_id, renewal_status, expires_at, membership_tiers(mentoring_credits_grant)')
    .eq('member_id', member.id)
    .eq('renewal_status', 'active')

  type Row = {
    id: string
    expires_at: string | null
    membership_tiers: { mentoring_credits_grant: number } | { mentoring_credits_grant: number }[] | null
  }
  const rows = ((ms ?? []) as unknown as Row[]).filter((m) => !m.expires_at || m.expires_at >= today)

  for (const m of rows) {
    const tier = Array.isArray(m.membership_tiers) ? m.membership_tiers[0] : m.membership_tiers
    const grant = tier?.mentoring_credits_grant ?? 0
    if (grant <= 0) continue

    const { count } = await db
      .from('session_credits')
      .select('id', { count: 'exact', head: true })
      .eq('member_id', member.id)
      .eq('session_type', 'mentoring')
      .eq('source', 'allowance')
      .eq('grant_key', m.id)
    const have = count ?? 0
    const missing = grant - have
    if (missing > 0) {
      await db.from('session_credits').insert(
        Array.from({ length: missing }, () => ({
          member_id: member.id,
          session_type: 'mentoring',
          status: 'available',
          source: 'allowance',
          grant_key: m.id,
        })),
      )
    }
  }
}

/** The member's mentoring-credit balance (syncs the annual allowance first). */
export async function getMentoringCredits(member: CommunityMember): Promise<MentoringCredits> {
  await syncMentoringAllowance(member)
  const db = supabaseServer()
  const [{ count: avail }, { count: used }] = await Promise.all([
    db.from('session_credits').select('id', { count: 'exact', head: true })
      .eq('member_id', member.id).eq('session_type', 'mentoring').eq('status', 'available'),
    db.from('session_credits').select('id', { count: 'exact', head: true })
      .eq('member_id', member.id).eq('session_type', 'mentoring').eq('status', 'consumed'),
  ])
  const remaining = avail ?? 0
  const usedN = used ?? 0
  return { remaining, used: usedN, total: remaining + usedN }
}

/** True if any of the member's active tiers includes free mentoring (the toggle). */
export async function memberHasFreeMentoring(member: CommunityMember): Promise<boolean> {
  if (member.isAdmin) return true
  if (member.activeTierIds.length === 0) return false
  const db = supabaseServer()
  const { data } = await db
    .from('membership_tiers')
    .select('id')
    .in('id', member.activeTierIds)
    .eq('includes_free_mentoring', true)
    .limit(1)
  return (data ?? []).length > 0
}

// ─── Cohort access resolution ───────────────────────────────────────────────

export interface CohortAccess {
  /** Already on the roster (or mentor / admin) — no purchase needed. */
  enrolled: boolean
  /** How the member would gain access if not enrolled. */
  kind: AccessKind
  /** Reason free access applies, when kind === 'free'. */
  freeReason?: 'tier-free-mentoring' | 'cohort-free-for-tier'
  /** One-off price in cents (USD), when a paid option exists. */
  priceCents: number | null
  /** Credits to spend to enroll (usually 1). */
  creditCost: number
  /** Whether the member currently has enough credits. */
  canUseCredit: boolean
  /** A pre-made Stripe price id, if the admin set one. */
  stripePriceId: string | null
}

export interface CohortFull {
  id: string
  name: string
  theme: CohortTheme
  timezone: string
  plannedSessions: number
  startDate: string | null
  isOpen: boolean
  blurb: string | null
  freeForTierIds: string[]
  oneOffPriceCents: number | null
  oneOffStripePriceId: string | null
  creditCost: number
  mentorMemberId: string | null
  mentorName: string | null
  memberCount: number
}

const COHORT_COLS =
  'id, name, theme, timezone, planned_sessions, start_date, is_open, blurb, free_for_tier_ids, one_off_price_cents, one_off_stripe_price_id, credit_cost, mentor_member_id, lifecycle, container_type'

function memberName(m: { first_name: string | null; last_name: string | null } | null): string | null {
  if (!m) return null
  return [m.first_name, m.last_name].filter(Boolean).join(' ') || null
}

type RawCohort = {
  id: string
  name: string
  theme: string | null
  timezone: string | null
  planned_sessions: number | null
  start_date: string | null
  is_open: boolean | null
  blurb: string | null
  free_for_tier_ids: string[] | null
  one_off_price_cents: number | null
  one_off_stripe_price_id: string | null
  credit_cost: number | null
  mentor_member_id: string | null
  members?: { first_name: string | null; last_name: string | null } | { first_name: string | null; last_name: string | null }[] | null
  cohort_members?: { member_id: string; status: string }[] | null
}

function toCohortFull(c: RawCohort): CohortFull {
  const mentor = Array.isArray(c.members) ? c.members[0] : c.members
  const active = (c.cohort_members ?? []).filter((m) => m.status === 'active')
  return {
    id: c.id,
    name: c.name,
    theme: (c.theme as CohortTheme) ?? 'space',
    timezone: c.timezone ?? 'America/Chicago',
    plannedSessions: c.planned_sessions ?? 6,
    startDate: c.start_date,
    isOpen: !!c.is_open,
    blurb: c.blurb,
    freeForTierIds: c.free_for_tier_ids ?? [],
    oneOffPriceCents: c.one_off_price_cents,
    oneOffStripePriceId: c.one_off_stripe_price_id,
    creditCost: c.credit_cost ?? 1,
    mentorMemberId: c.mentor_member_id,
    mentorName: memberName(mentor ?? null),
    memberCount: active.length,
  }
}

/** Resolve how a member accesses a cohort (and whether they already have it). */
export async function resolveCohortAccess(member: CommunityMember, cohort: CohortFull): Promise<CohortAccess> {
  const db = supabaseServer()

  // Already enrolled? (mentor, admin, or active roster row)
  let enrolled = member.isAdmin || cohort.mentorMemberId === member.id
  if (!enrolled) {
    const { data } = await db
      .from('cohort_members')
      .select('member_id')
      .eq('cohort_id', cohort.id)
      .eq('member_id', member.id)
      .eq('status', 'active')
      .maybeSingle()
    enrolled = !!data
  }

  const base: Omit<CohortAccess, 'enrolled' | 'kind' | 'freeReason' | 'canUseCredit'> = {
    priceCents: cohort.oneOffPriceCents,
    creditCost: cohort.creditCost,
    stripePriceId: cohort.oneOffStripePriceId,
  }

  // Free path 1: cohort explicitly free for one of the member's tiers.
  const freeForTier = cohort.freeForTierIds.some((id) => member.activeTierIds.includes(id))
  // Free path 2: member's tier includes free mentoring globally.
  const tierFree = await memberHasFreeMentoring(member)
  if (freeForTier || tierFree) {
    return {
      enrolled,
      kind: 'free',
      freeReason: freeForTier ? 'cohort-free-for-tier' : 'tier-free-mentoring',
      canUseCredit: false,
      ...base,
    }
  }

  // Otherwise: credit if they have one, else one-off payment.
  const credits = await getMentoringCredits(member)
  const canUseCredit = credits.remaining >= cohort.creditCost
  if (canUseCredit) {
    return { enrolled, kind: 'credit', canUseCredit, ...base }
  }
  return { enrolled, kind: 'paid', canUseCredit: false, ...base }
}

/** A single full cohort with mentor + counts (admin/mentor/discover detail). */
export async function getCohortFull(cohortId: string): Promise<CohortFull | null> {
  const db = supabaseServer()
  const { data } = await db
    .from('mentoring_cohorts')
    .select(`${COHORT_COLS}, members:mentor_member_id(first_name, last_name), cohort_members(member_id, status)`)
    .eq('id', cohortId)
    .eq('container_type', 'mentoring')
    .maybeSingle()
  if (!data) return null
  return toCohortFull(data as unknown as RawCohort)
}

export interface OpenCohort extends CohortFull {
  access: CohortAccess
}

/** Open cohorts the member is NOT already on, with access resolved (Discover). */
export async function listOpenCohorts(member: CommunityMember): Promise<OpenCohort[]> {
  const db = supabaseServer()
  const { data } = await db
    .from('mentoring_cohorts')
    .select(`${COHORT_COLS}, members:mentor_member_id(first_name, last_name), cohort_members(member_id, status)`)
    .eq('container_type', 'mentoring')
    .eq('is_open', true)
    .eq('lifecycle', 'active')
    .order('start_date', { ascending: true })

  const cohorts = ((data ?? []) as unknown as RawCohort[]).map(toCohortFull)
  const out: OpenCohort[] = []
  for (const c of cohorts) {
    const access = await resolveCohortAccess(member, c)
    if (access.enrolled) continue // hide ones they're already in
    out.push({ ...c, access })
  }
  return out
}

// ─── Enrollment (self-register) ─────────────────────────────────────────────

export type EnrollResult =
  | { ok: true }
  | { ok: false; reason: 'not-open' | 'already-enrolled' | 'no-credit' | 'needs-payment' | 'error' }

async function addToRosterActive(cohortId: string, memberId: string): Promise<void> {
  const db = supabaseServer()
  const nowIso = new Date().toISOString()
  await db
    .from('cohort_members')
    .upsert(
      { cohort_id: cohortId, member_id: memberId, status: 'active', accepted_at: nowIso },
      { onConflict: 'cohort_id,member_id' },
    )
}

/** Enroll into an open cohort using one mentoring credit. */
export async function enrollWithCredit(member: CommunityMember, cohortId: string): Promise<EnrollResult> {
  const db = supabaseServer()
  const cohort = await getCohortFull(cohortId)
  if (!cohort || !cohort.isOpen) return { ok: false, reason: 'not-open' }
  const access = await resolveCohortAccess(member, cohort)
  if (access.enrolled) return { ok: false, reason: 'already-enrolled' }
  if (access.kind === 'free') {
    await addToRosterActive(cohortId, member.id)
    return { ok: true }
  }
  if (!access.canUseCredit) return { ok: false, reason: 'no-credit' }

  // Consume the oldest available credit (FIFO) and tie it to this cohort.
  const { data: credit } = await db
    .from('session_credits')
    .select('id')
    .eq('member_id', member.id)
    .eq('session_type', 'mentoring')
    .eq('status', 'available')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!credit) return { ok: false, reason: 'no-credit' }

  await db
    .from('session_credits')
    .update({ status: 'consumed', consumed_at: new Date().toISOString(), consumed_cohort_id: cohortId })
    .eq('id', credit.id)
  await addToRosterActive(cohortId, member.id)
  return { ok: true }
}

/** Enroll into a cohort that is free for this member (no credit spent). */
export async function enrollFree(member: CommunityMember, cohortId: string): Promise<EnrollResult> {
  const cohort = await getCohortFull(cohortId)
  if (!cohort || !cohort.isOpen) return { ok: false, reason: 'not-open' }
  const access = await resolveCohortAccess(member, cohort)
  if (access.enrolled) return { ok: false, reason: 'already-enrolled' }
  if (access.kind !== 'free') return { ok: false, reason: 'needs-payment' }
  await addToRosterActive(cohortId, member.id)
  return { ok: true }
}

// ─── Mentee landing aggregation ─────────────────────────────────────────────

export interface MenteeCohortCard {
  id: string
  name: string
  theme: CohortTheme
  timezone: string
  isMentor: boolean
  lifecycle: 'active' | 'archived'
  mentorName: string | null
  memberCount: number
  plannedSessions: number
  /** Next upcoming session start/end ISO, if any. */
  nextSessionStart: string | null
  nextSessionEnd: string | null
  /** 0–100 completion across sessions held + mandatory resources + done actions. */
  progressPct: number
  /** Open (not-done) actions for this cohort. */
  actionsDue: number
}

export interface PendingInviteDetail {
  cohortId: string
  name: string
  theme: CohortTheme
  mentorName: string | null
  startDate: string | null
  plannedSessions: number
  invitedAt: string
}

/** Active + completed cohorts for the mentee landing, enriched with the design's
 * card fields (theme, mentor, next session, progress, actions-due). */
export async function listMenteeCohortCards(member: CommunityMember): Promise<MenteeCohortCard[]> {
  const db = supabaseServer()

  // Cohorts where active roster member OR mentor.
  const [{ data: asMember }, { data: asMentor }] = await Promise.all([
    db.from('cohort_members')
      .select(`mentoring_cohorts!inner(${COHORT_COLS}, members:mentor_member_id(first_name,last_name), cohort_members(member_id,status))`)
      .eq('member_id', member.id).eq('status', 'active')
      .eq('mentoring_cohorts.container_type', 'mentoring'),
    db.from('mentoring_cohorts')
      .select(`${COHORT_COLS}, members:mentor_member_id(first_name,last_name), cohort_members(member_id,status)`)
      .eq('mentor_member_id', member.id).eq('container_type', 'mentoring'),
  ])

  const raw: RawCohort[] = []
  for (const r of asMember ?? []) {
    const c = (Array.isArray(r.mentoring_cohorts) ? r.mentoring_cohorts[0] : r.mentoring_cohorts) as RawCohort | null
    if (c) raw.push(c)
  }
  for (const c of (asMentor ?? []) as unknown as RawCohort[]) raw.push(c)

  const byId = new Map<string, CohortFull & { lifecycle: string; isMentor: boolean }>()
  for (const c of raw) {
    if (byId.has(c.id)) continue
    byId.set(c.id, {
      ...toCohortFull(c),
      lifecycle: ((c as RawCohort & { lifecycle?: string }).lifecycle as string) ?? 'active',
      isMentor: c.mentor_member_id === member.id,
    })
  }
  const cohorts = [...byId.values()]
  if (cohorts.length === 0) return []
  const ids = cohorts.map((c) => c.id)

  // Sessions for these cohorts (for next-session + held count).
  const { data: sess } = await db
    .from('sessions')
    .select('cohort_id, scheduled_start, scheduled_end, status')
    .in('cohort_id', ids)
    .order('scheduled_start', { ascending: true })

  // Open actions for this member, mapped to their cohort via the session.
  const { data: acts } = await db
    .from('session_actions')
    .select('is_done, sessions!inner(cohort_id)')
    .eq('member_id', member.id)
    .eq('is_done', false)

  const now = Date.now()
  const nextByCohort = new Map<string, { start: string; end: string | null }>()
  const heldByCohort = new Map<string, number>()
  for (const s of (sess ?? []) as { cohort_id: string; scheduled_start: string; scheduled_end: string | null; status: string }[]) {
    if (s.status === 'completed' || (s.status === 'scheduled' && new Date(s.scheduled_start).getTime() <= now)) {
      heldByCohort.set(s.cohort_id, (heldByCohort.get(s.cohort_id) ?? 0) + 1)
    }
    if (s.status === 'scheduled' && new Date(s.scheduled_start).getTime() > now && !nextByCohort.has(s.cohort_id)) {
      nextByCohort.set(s.cohort_id, { start: s.scheduled_start, end: s.scheduled_end })
    }
  }
  const actionsByCohort = new Map<string, number>()
  for (const a of (acts ?? []) as unknown as { sessions: { cohort_id: string } | { cohort_id: string }[] }[]) {
    const sx = Array.isArray(a.sessions) ? a.sessions[0] : a.sessions
    if (sx?.cohort_id) actionsByCohort.set(sx.cohort_id, (actionsByCohort.get(sx.cohort_id) ?? 0) + 1)
  }

  return cohorts
    .map((c) => {
      const next = nextByCohort.get(c.id) ?? null
      const held = heldByCohort.get(c.id) ?? 0
      const progressPct = c.plannedSessions > 0 ? Math.min(100, Math.round((held / c.plannedSessions) * 100)) : 0
      return {
        id: c.id,
        name: c.name,
        theme: c.theme,
        timezone: c.timezone,
        isMentor: c.isMentor,
        lifecycle: (c.lifecycle as 'active' | 'archived') ?? 'active',
        mentorName: c.mentorName,
        memberCount: c.memberCount,
        plannedSessions: c.plannedSessions,
        nextSessionStart: next?.start ?? null,
        nextSessionEnd: next?.end ?? null,
        progressPct,
        actionsDue: actionsByCohort.get(c.id) ?? 0,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Pending cohort invites with the banner's detail fields. */
export async function listPendingInvitesDetailed(member: CommunityMember): Promise<PendingInviteDetail[]> {
  const db = supabaseServer()
  const { data } = await db
    .from('cohort_members')
    .select(`invited_at, mentoring_cohorts!inner(id, name, theme, planned_sessions, start_date, container_type, members:mentor_member_id(first_name,last_name))`)
    .eq('member_id', member.id)
    .eq('status', 'invited')
    .eq('mentoring_cohorts.container_type', 'mentoring')

  type Row = {
    invited_at: string | null
    mentoring_cohorts: RawCohort | RawCohort[] | null
  }
  return ((data ?? []) as unknown as Row[]).map((r) => {
    const c = (Array.isArray(r.mentoring_cohorts) ? r.mentoring_cohorts[0] : r.mentoring_cohorts) as RawCohort
    const mentor = Array.isArray(c.members) ? c.members[0] : c.members
    return {
      cohortId: c.id,
      name: c.name,
      theme: (c.theme as CohortTheme) ?? 'space',
      mentorName: memberName(mentor ?? null),
      startDate: c.start_date,
      plannedSessions: c.planned_sessions ?? 6,
      invitedAt: r.invited_at ?? new Date().toISOString(),
    }
  })
}

/** Called by the Stripe webhook after a successful one-off cohort payment. */
export async function enrollAfterPayment(memberId: string, cohortId: string, stripeSessionId: string): Promise<void> {
  const db = supabaseServer()
  // Record the purchase as a consumed credit for an audit trail, then add to roster.
  await db.from('session_credits').insert({
    member_id: memberId,
    session_type: 'mentoring',
    status: 'consumed',
    source: 'purchase',
    consumed_cohort_id: cohortId,
    consumed_at: new Date().toISOString(),
    stripe_session_id: stripeSessionId,
  })
  await addToRosterActive(cohortId, memberId)
}
