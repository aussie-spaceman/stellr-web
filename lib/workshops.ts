// lib/workshops.ts — server-side domain logic for coaching WORKSHOPS (Rec 3 of
// the Workshops & Cohorts access plan, docs/WORKSHOP-COHORT-ACCESS-PLAN.md).
//
// A workshop = mentoring_cohorts(container_type='workshop'): a discoverable,
// multi-seat, priced coaching container that mirrors a mentoring cohort. It reuses
// the same pricing/discovery columns (added 070) and the shared credit WALLET
// (lib/credits.ts) scoped to the 'workshop' credit type. The legacy 1:1 coaching
// backfill containers (container_type='coaching', migration 064) are separate and
// untouched by this module.
//
// Access resolution: free if the workshop is free for one of the member's tiers
// (free_for_tier_ids), else spend a workshop credit, else a one-off Stripe payment.
import 'server-only'
import { supabaseServer } from '@/lib/supabase'
import type { CommunityMember } from '@/lib/community'
import type { AccessKind, CohortTheme } from '@/lib/mentoring-format'
import type { CohortAccess, CohortFull, EnrollResult } from '@/lib/mentoring'
import { getCredits, consumeOldestCredit, grantCredits } from '@/lib/credits'
import { logActivity } from '@/lib/activity-log'
import { reportEnrollmentGate, accessGatesEnforced } from '@/lib/access-gates'

const WORKSHOP_COLS =
  'id, name, theme, timezone, planned_sessions, start_date, is_open, blurb, free_for_tier_ids, one_off_price_cents, one_off_stripe_price_id, credit_cost, mentor_member_id, lifecycle, container_type'

function memberName(m: { first_name: string | null; last_name: string | null } | null): string | null {
  if (!m) return null
  return [m.first_name, m.last_name].filter(Boolean).join(' ') || null
}

type RawWorkshop = {
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

function toWorkshopFull(c: RawWorkshop): CohortFull {
  const coach = Array.isArray(c.members) ? c.members[0] : c.members
  const active = (c.cohort_members ?? []).filter((m) => m.status === 'active')
  return {
    id: c.id,
    name: c.name,
    theme: (c.theme as CohortTheme) ?? 'space',
    timezone: c.timezone ?? 'America/Chicago',
    plannedSessions: c.planned_sessions ?? 1,
    startDate: c.start_date,
    isOpen: !!c.is_open,
    blurb: c.blurb,
    freeForTierIds: c.free_for_tier_ids ?? [],
    oneOffPriceCents: c.one_off_price_cents,
    oneOffStripePriceId: c.one_off_stripe_price_id,
    creditCost: c.credit_cost ?? 1,
    mentorMemberId: c.mentor_member_id,
    mentorName: memberName(coach ?? null),
    memberCount: active.length,
  }
}

/** A single workshop with coach + active-seat count. */
export async function getWorkshopFull(workshopId: string): Promise<CohortFull | null> {
  const db = supabaseServer()
  const { data } = await db
    .from('mentoring_cohorts')
    .select(`${WORKSHOP_COLS}, members:mentor_member_id(first_name, last_name), cohort_members(member_id, status)`)
    .eq('id', workshopId)
    .eq('container_type', 'workshop')
    .maybeSingle()
  if (!data) return null
  return toWorkshopFull(data as unknown as RawWorkshop)
}

/** Resolve how a member accesses a workshop (and whether they already have it). */
export async function resolveWorkshopAccess(member: CommunityMember, workshop: CohortFull): Promise<CohortAccess> {
  const db = supabaseServer()

  let enrolled = member.isAdmin || workshop.mentorMemberId === member.id
  if (!enrolled) {
    const { data } = await db
      .from('cohort_members')
      .select('member_id')
      .eq('cohort_id', workshop.id)
      .eq('member_id', member.id)
      .eq('status', 'active')
      .maybeSingle()
    enrolled = !!data
  }

  const base = {
    priceCents: workshop.oneOffPriceCents,
    creditCost: workshop.creditCost,
    stripePriceId: workshop.oneOffStripePriceId,
  }

  // Free path: workshop explicitly free for one of the member's tiers.
  const freeForTier = workshop.freeForTierIds.some((id) => member.activeTierIds.includes(id))
  if (freeForTier) {
    return { enrolled, kind: 'free' as AccessKind, freeReason: 'cohort-free-for-tier', canUseCredit: false, ...base }
  }

  // Otherwise: workshop credit if they have one, else one-off payment.
  const credits = await getCredits(member, 'workshop')
  const canUseCredit = credits.remaining >= workshop.creditCost
  if (canUseCredit) return { enrolled, kind: 'credit' as AccessKind, canUseCredit, ...base }
  return { enrolled, kind: 'paid' as AccessKind, canUseCredit: false, ...base }
}

export interface OpenWorkshop extends CohortFull {
  access: CohortAccess
}

/** Open workshops the member is NOT already on, with access resolved (Discover). */
export async function listOpenWorkshops(member: CommunityMember): Promise<OpenWorkshop[]> {
  const db = supabaseServer()
  const { data } = await db
    .from('mentoring_cohorts')
    .select(`${WORKSHOP_COLS}, members:mentor_member_id(first_name, last_name), cohort_members(member_id, status)`)
    .eq('container_type', 'workshop')
    .eq('is_open', true)
    .eq('lifecycle', 'active')
    .order('start_date', { ascending: true })

  const workshops = ((data ?? []) as unknown as RawWorkshop[]).map(toWorkshopFull)
  const out: OpenWorkshop[] = []
  for (const w of workshops) {
    const access = await resolveWorkshopAccess(member, w)
    if (access.enrolled) continue
    out.push({ ...w, access })
  }
  return out
}

async function addToRosterActive(workshopId: string, memberId: string): Promise<void> {
  const db = supabaseServer()
  await db
    .from('cohort_members')
    .upsert(
      { cohort_id: workshopId, member_id: memberId, relationship: 'participant', status: 'active', accepted_at: new Date().toISOString() },
      { onConflict: 'cohort_id,member_id' },
    )
}

/** Enroll into an open workshop using one workshop credit. */
export async function enrollWithWorkshopCredit(member: CommunityMember, workshopId: string): Promise<EnrollResult> {
  const workshop = await getWorkshopFull(workshopId)
  if (!workshop || !workshop.isOpen) return { ok: false, reason: 'not-open' }
  const access = await resolveWorkshopAccess(member, workshop)
  if (access.enrolled) return { ok: false, reason: 'already-enrolled' }
  // Minor participation-agreement gate (report-only unless ACCESS_GATES_ENFORCE).
  const gate = await reportEnrollmentGate(member, { kind: 'workshop', containerId: workshopId, containerName: workshop.name })
  if (accessGatesEnforced() && !gate.unlocked) return { ok: false, reason: 'needs-agreement' }
  if (access.kind === 'free') {
    await addToRosterActive(workshopId, member.id)
    return { ok: true }
  }
  if (!access.canUseCredit) return { ok: false, reason: 'no-credit' }

  const consumed = await consumeOldestCredit(member.id, 'workshop', workshopId)
  if (!consumed) return { ok: false, reason: 'no-credit' }

  await addToRosterActive(workshopId, member.id)
  return { ok: true }
}

/** Enroll into a workshop that is free for this member (no credit spent). */
export async function enrollWorkshopFree(member: CommunityMember, workshopId: string): Promise<EnrollResult> {
  const workshop = await getWorkshopFull(workshopId)
  if (!workshop || !workshop.isOpen) return { ok: false, reason: 'not-open' }
  const access = await resolveWorkshopAccess(member, workshop)
  if (access.enrolled) return { ok: false, reason: 'already-enrolled' }
  if (access.kind !== 'free') return { ok: false, reason: 'needs-payment' }
  const gate = await reportEnrollmentGate(member, { kind: 'workshop', containerId: workshopId, containerName: workshop.name })
  if (accessGatesEnforced() && !gate.unlocked) return { ok: false, reason: 'needs-agreement' }
  await addToRosterActive(workshopId, member.id)
  return { ok: true }
}

/** Called by the Stripe webhook after a successful one-off workshop payment. */
export async function enrollWorkshopAfterPayment(memberId: string, workshopId: string, stripeSessionId: string): Promise<void> {
  const db = supabaseServer()
  // Record the purchase as a consumed workshop credit for an audit trail.
  await db.from('session_credits').insert({
    member_id: memberId,
    session_type: 'workshop',
    status: 'consumed',
    source: 'purchase',
    consumed_cohort_id: workshopId,
    consumed_at: new Date().toISOString(),
    stripe_session_id: stripeSessionId,
  })
  await addToRosterActive(workshopId, memberId)
}

/** Grant `quantity` available workshop credits from a paid top-up (Stripe webhook). */
export async function grantWorkshopTopup(memberId: string, quantity: number, stripeSessionId: string): Promise<number> {
  return grantCredits(memberId, 'workshop', quantity, { source: 'topup', stripeSessionId })
}

// ─── Member landing: a member's workshops ───────────────────────────────────

export interface MemberWorkshopCard {
  id: string
  name: string
  theme: CohortTheme
  mentorName: string | null
  memberCount: number
  plannedSessions: number
  isCoach: boolean
  lifecycle: 'active' | 'archived'
}

/** Workshops the member is an active participant in, or coaches. */
export async function listMemberWorkshops(member: CommunityMember): Promise<MemberWorkshopCard[]> {
  const db = supabaseServer()
  const [{ data: asMember }, { data: asCoach }] = await Promise.all([
    db.from('cohort_members')
      .select(`mentoring_cohorts!inner(${WORKSHOP_COLS}, members:mentor_member_id(first_name,last_name), cohort_members(member_id,status))`)
      .eq('member_id', member.id).eq('status', 'active')
      .eq('mentoring_cohorts.container_type', 'workshop'),
    db.from('mentoring_cohorts')
      .select(`${WORKSHOP_COLS}, members:mentor_member_id(first_name,last_name), cohort_members(member_id,status)`)
      .eq('mentor_member_id', member.id).eq('container_type', 'workshop'),
  ])

  const raw: (RawWorkshop & { lifecycle?: string })[] = []
  for (const r of asMember ?? []) {
    const c = (Array.isArray(r.mentoring_cohorts) ? r.mentoring_cohorts[0] : r.mentoring_cohorts) as (RawWorkshop & { lifecycle?: string }) | null
    if (c) raw.push(c)
  }
  for (const c of (asCoach ?? []) as unknown as (RawWorkshop & { lifecycle?: string })[]) raw.push(c)

  const byId = new Map<string, MemberWorkshopCard>()
  for (const c of raw) {
    if (byId.has(c.id)) continue
    const full = toWorkshopFull(c)
    byId.set(c.id, {
      id: full.id,
      name: full.name,
      theme: full.theme,
      mentorName: full.mentorName,
      memberCount: full.memberCount,
      plannedSessions: full.plannedSessions,
      isCoach: c.mentor_member_id === member.id,
      lifecycle: (c.lifecycle as 'active' | 'archived') ?? 'active',
    })
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// ─── Admin: workshop CRUD ───────────────────────────────────────────────────

export interface CreateWorkshopInput {
  name: string
  coachMemberId: string | null
  plannedSessions: number
  theme: CohortTheme
  timezone: string
  isOpen: boolean
  blurb?: string | null
  freeForTierIds?: string[]
  oneOffPriceCents?: number | null
  creditCost?: number
}

/** Create a coaching workshop container. Returns the id. */
export async function createWorkshop(input: CreateWorkshopInput): Promise<string> {
  const db = supabaseServer()
  const { data, error } = await db
    .from('mentoring_cohorts')
    .insert({
      name: input.name,
      mentor_member_id: input.coachMemberId,
      container_type: 'workshop',
      lifecycle: 'active',
      is_active: true,
      theme: input.theme,
      timezone: input.timezone,
      planned_sessions: input.plannedSessions,
      is_open: input.isOpen,
      blurb: input.blurb ?? null,
      free_for_tier_ids: input.freeForTierIds ?? [],
      one_off_price_cents: input.oneOffPriceCents ?? null,
      credit_cost: input.creditCost ?? 1,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(error?.message ?? 'Could not create workshop')
  return data.id as string
}

export interface UpdateWorkshopInput {
  name?: string
  coachMemberId?: string | null
  theme?: CohortTheme
  timezone?: string
  isOpen?: boolean
  blurb?: string | null
  freeForTierIds?: string[]
  oneOffPriceCents?: number | null
  creditCost?: number
}

export async function updateWorkshop(workshopId: string, patch: UpdateWorkshopInput): Promise<void> {
  const db = supabaseServer()
  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.coachMemberId !== undefined) row.mentor_member_id = patch.coachMemberId
  if (patch.theme !== undefined) row.theme = patch.theme
  if (patch.timezone !== undefined) row.timezone = patch.timezone
  if (patch.isOpen !== undefined) row.is_open = patch.isOpen
  if (patch.blurb !== undefined) row.blurb = patch.blurb
  if (patch.freeForTierIds !== undefined) row.free_for_tier_ids = patch.freeForTierIds
  if (patch.oneOffPriceCents !== undefined) row.one_off_price_cents = patch.oneOffPriceCents
  if (patch.creditCost !== undefined) row.credit_cost = patch.creditCost
  if (Object.keys(row).length === 0) return
  await db.from('mentoring_cohorts').update(row).eq('id', workshopId).eq('container_type', 'workshop')
}

export async function archiveWorkshop(workshopId: string): Promise<void> {
  const db = supabaseServer()
  await db.from('mentoring_cohorts').update({ lifecycle: 'archived', is_active: false }).eq('id', workshopId).eq('container_type', 'workshop')
}

export async function deleteWorkshop(workshopId: string): Promise<void> {
  await refundWorkshopMembers(workshopId)
  const db = supabaseServer()
  await db.from('mentoring_cohorts').delete().eq('id', workshopId).eq('container_type', 'workshop')
}

export interface AdminWorkshopRow {
  id: string
  name: string
  theme: CohortTheme
  mentorName: string | null
  memberCount: number
  isOpen: boolean
  oneOffPriceCents: number | null
  creditCost: number
  freeForTierIds: string[]
  lifecycle: 'active' | 'archived'
}

/** All workshops for the admin console. */
export async function listAllWorkshops(): Promise<AdminWorkshopRow[]> {
  const db = supabaseServer()
  const { data } = await db
    .from('mentoring_cohorts')
    .select(`${WORKSHOP_COLS}, members:mentor_member_id(first_name,last_name), cohort_members(member_id,status)`)
    .eq('container_type', 'workshop')
    .order('created_at', { ascending: false })

  return ((data ?? []) as unknown as (RawWorkshop & { lifecycle?: string })[]).map((c) => {
    const full = toWorkshopFull(c)
    return {
      id: full.id,
      name: full.name,
      theme: full.theme,
      mentorName: full.mentorName,
      memberCount: full.memberCount,
      isOpen: full.isOpen,
      oneOffPriceCents: full.oneOffPriceCents,
      creditCost: full.creditCost,
      freeForTierIds: full.freeForTierIds,
      lifecycle: (c.lifecycle as 'active' | 'archived') ?? 'active',
    }
  })
}

/**
 * Refund every member who spent something to enroll in a (cancelled) workshop.
 * Mirrors lib/mentoring.ts refundCohortMembers: a paid one-off becomes account
 * credit; any other source (allowance / topup / grant) returns to the wallet.
 */
export async function refundWorkshopMembers(workshopId: string): Promise<void> {
  const db = supabaseServer()
  const workshop = await getWorkshopFull(workshopId)
  const name = workshop?.name ?? 'a coaching workshop'

  const { data: spent } = await db
    .from('session_credits')
    .select('id, member_id, source')
    .eq('consumed_cohort_id', workshopId)
    .eq('session_type', 'workshop')
    .eq('status', 'consumed')

  for (const c of (spent ?? []) as { id: string; member_id: string; source: string }[]) {
    if (c.source === 'purchase') {
      const cents = workshop?.oneOffPriceCents ?? 0
      if (cents > 0) {
        await db.from('account_credits').insert({
          member_id: c.member_id,
          currency: 'usd',
          amount_cents: cents,
          remaining_cents: cents,
          source_type: 'workshop_refund',
          reason: `Account credit for cancelled workshop: ${name}`,
        })
        await logActivity({
          memberId: c.member_id,
          category: 'billing',
          action: 'refund_issued',
          summary: `Account credit issued for cancelled workshop ${name}`,
          metadata: { kind: 'workshop_refund', workshopId, amount: cents, currency: 'usd' },
          actorType: 'admin',
        }, db)
      }
    } else {
      await db
        .from('session_credits')
        .update({ status: 'available', consumed_at: null, consumed_cohort_id: null })
        .eq('id', c.id)
      await logActivity({
        memberId: c.member_id,
        category: 'billing',
        action: 'refund_issued',
        summary: `Workshop credit returned — workshop ${name} was cancelled`,
        metadata: { kind: 'workshop_credit_return', workshopId },
        actorType: 'admin',
      }, db)
    }
  }
}
