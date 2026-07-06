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
import { notifyMembers } from '@/lib/notify'
import { linkCohortTraining, inviteMembersToCohort } from '@/lib/sessions'
import { logActivity } from '@/lib/activity-log'
import { ensureMemberGrants, getKindBalance, bookCohortFromAllocation, cancelCohortViaLedger } from '@/lib/entitlements'
import { reportEnrollmentGate, accessGatesEnforced } from '@/lib/access-gates'
import { addGlobalRole } from '@/lib/member-roles'

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
  // Entitlements cutover: the mentoring allowance is the cohort_access lot, materialised
  // from tier_benefits when a membership is granted; ensure it exists before a read.
  await ensureMemberGrants(member.id)
}

/** The member's mentoring-session balance (cohort_access allocation; ensures grant first). */
export async function getMentoringCredits(member: CommunityMember): Promise<MentoringCredits> {
  await ensureMemberGrants(member.id)
  return getKindBalance(member.id, 'cohort_access')
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
  /**
   * Session credits an enrollment draws from the ledger. The entitlements engine
   * counts mentoring PER SESSION (tier grants are N sessions/year; enrolling in a
   * cohort draws its planned_sessions — see migration 106), so this is the cohort's
   * planned session count, NOT the legacy mentoring_cohorts.credit_cost (1-credit-
   * per-cohort model, superseded 2026-06-26).
   */
  creditCost: number
  /** Whether the member currently has enough session credits. */
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

  // What an enrollment ACTUALLY draws: fn_book_from_allocation consumes the
  // cohort's planned session count (per-session accounting, migration 106).
  const sessionsNeeded = Math.max(1, cohort.plannedSessions)
  const base: Omit<CohortAccess, 'enrolled' | 'kind' | 'freeReason' | 'canUseCredit'> = {
    priceCents: cohort.oneOffPriceCents,
    creditCost: sessionsNeeded,
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

  // Otherwise: session credits if they have enough, else one-off payment.
  const credits = await getMentoringCredits(member)
  const canUseCredit = credits.remaining >= sessionsNeeded
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
  | { ok: false; reason: 'not-open' | 'already-enrolled' | 'no-credit' | 'needs-payment' | 'needs-agreement' | 'error' }

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

/**
 * Roster a member into a cohort after a paid entitlement booking confirms (the
 * Stripe webhook's entitlement_booking branch). The purchase itself is recorded in
 * the entitlements ledger by confirmPaidBooking; this just grants cohort access.
 * Replaces the old enrollAfterPayment session_credits-receipt path.
 */
export async function rosterAfterPaidBooking(cohortId: string, memberId: string): Promise<void> {
  await addToRosterActive(cohortId, memberId)
}

/** Enroll into an open cohort using session credits (draws the cohort's planned sessions). */
export async function enrollWithCredit(member: CommunityMember, cohortId: string): Promise<EnrollResult> {
  const cohort = await getCohortFull(cohortId)
  if (!cohort || !cohort.isOpen) return { ok: false, reason: 'not-open' }
  const access = await resolveCohortAccess(member, cohort)
  if (access.enrolled) return { ok: false, reason: 'already-enrolled' }
  // Minor participation-agreement gate (report-only unless ACCESS_GATES_ENFORCE).
  const gate = await reportEnrollmentGate(member, { kind: 'cohort', containerId: cohortId, containerName: cohort.name })
  if (accessGatesEnforced() && !gate.unlocked) return { ok: false, reason: 'needs-agreement' }
  if (access.kind === 'free') {
    await addToRosterActive(cohortId, member.id)
    return { ok: true }
  }
  if (!access.canUseCredit) return { ok: false, reason: 'no-credit' }

  // Draw the cohort's session count from the member's lots (FIFO across lots —
  // tier grant + purchased top-ups combine; migration 122), tied to this cohort.
  const consumed = await bookCohortFromAllocation(member.id, cohortId)
  if (!consumed) return { ok: false, reason: 'no-credit' }

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
  const gate = await reportEnrollmentGate(member, { kind: 'cohort', containerId: cohortId, containerName: cohort.name })
  if (accessGatesEnforced() && !gate.unlocked) return { ok: false, reason: 'needs-agreement' }
  await addToRosterActive(cohortId, member.id)
  return { ok: true }
}

// ─── Mentor dashboard ───────────────────────────────────────────────────────

export interface MentorStats {
  nextSession: { start: string; end: string | null; cohortName: string; timezone: string } | null
  flaggedCount: number
  actionsDue: number
  mentoredCohortIds: string[]
}

export async function getMentorDashboardStats(mentorId: string): Promise<MentorStats> {
  const db = supabaseServer()
  const { data: cohorts } = await db
    .from('mentoring_cohorts')
    .select('id, name, timezone')
    .eq('mentor_member_id', mentorId)
    .eq('container_type', 'mentoring')
  const list = (cohorts ?? []) as { id: string; name: string; timezone: string | null }[]
  const ids = list.map((c) => c.id)
  if (ids.length === 0) return { nextSession: null, flaggedCount: 0, actionsDue: 0, mentoredCohortIds: [] }

  const nowIso = new Date().toISOString()
  const [{ data: sess }, { count: actionsDue }, { data: channels }] = await Promise.all([
    db.from('sessions').select('cohort_id, scheduled_start, scheduled_end, status')
      .in('cohort_id', ids).eq('status', 'scheduled').gt('scheduled_start', nowIso)
      .order('scheduled_start', { ascending: true }).limit(1),
    db.from('session_actions').select('id', { count: 'exact', head: true })
      .in('cohort_id', ids).eq('is_done', false),
    db.from('chat_channels').select('id').in('cohort_id', ids),
  ])

  let flaggedCount = 0
  const channelIds = (channels ?? []).map((c) => (c as { id: string }).id)
  if (channelIds.length) {
    const { count } = await db
      .from('chat_messages')
      .select('id', { count: 'exact', head: true })
      .in('channel_id', channelIds)
      .not('flagged_at', 'is', null)
      .is('deleted_at', null)
    flaggedCount = count ?? 0
  }

  const ns = (sess ?? [])[0] as { cohort_id: string; scheduled_start: string; scheduled_end: string | null } | undefined
  const cohort = ns ? list.find((c) => c.id === ns.cohort_id) : undefined
  return {
    nextSession: ns ? { start: ns.scheduled_start, end: ns.scheduled_end, cohortName: cohort?.name ?? 'Cohort', timezone: cohort?.timezone ?? 'America/Chicago' } : null,
    flaggedCount,
    actionsDue: actionsDue ?? 0,
    mentoredCohortIds: ids,
  }
}

// ─── Cohort-level actions (Actions tab) ─────────────────────────────────────

export interface AssignActionOpts {
  title: string
  /** Specific mentees, or empty/undefined to assign to all active members. */
  memberIds?: string[]
  dueDate?: string | null
  trainingModuleId?: string | null
  remindBeforeHours?: number | null
}

/** Assign a cohort action to all mentees or selected members (one row each,
 * grouped by a shared batch id for the mentor's completion view). */
export async function assignCohortAction(cohortId: string, mentorId: string, opts: AssignActionOpts): Promise<number> {
  const db = supabaseServer()
  let targets = (opts.memberIds ?? []).filter(Boolean)
  if (targets.length === 0) {
    const { data } = await db
      .from('cohort_members')
      .select('member_id')
      .eq('cohort_id', cohortId)
      .eq('status', 'active')
    targets = (data ?? []).map((r) => r.member_id as string)
  }
  if (targets.length === 0) return 0

  const batchId = crypto.randomUUID()
  const { error } = await db.from('session_actions').insert(
    targets.map((member_id, i) => ({
      cohort_id: cohortId,
      session_id: null,
      member_id,
      batch_id: batchId,
      title: opts.title,
      created_by: mentorId,
      display_order: i,
      due_date: opts.dueDate ?? null,
      training_module_id: opts.trainingModuleId ?? null,
      remind_before_hours: opts.remindBeforeHours ?? null,
    })),
  )
  if (error) return 0

  const { data: cohort } = await db.from('mentoring_cohorts').select('name').eq('id', cohortId).maybeSingle()
  await notifyMembers(targets, {
    type: 'action',
    body: `New action in ${(cohort?.name as string) ?? 'your cohort'}: ${opts.title}`,
    referenceType: 'cohort',
    referenceId: cohortId,
    actorMemberId: mentorId,
  })
  return targets.length
}

export interface MenteeAction {
  id: string
  title: string
  isDone: boolean
  dueDate: string | null
  kind: 'training' | 'task'
}

/** A mentee's actions within a cohort (cohort-tied or session-tied). */
export async function listMemberCohortActions(memberId: string, cohortId: string): Promise<MenteeAction[]> {
  const db = supabaseServer()
  const { data: sess } = await db.from('sessions').select('id').eq('cohort_id', cohortId)
  const sessionIds = (sess ?? []).map((s) => (s as { id: string }).id)

  const orFilter = sessionIds.length
    ? `cohort_id.eq.${cohortId},session_id.in.(${sessionIds.join(',')})`
    : `cohort_id.eq.${cohortId}`
  const { data } = await db
    .from('session_actions')
    .select('id, title, is_done, due_date, training_module_id')
    .eq('member_id', memberId)
    .or(orFilter)
    .order('created_at', { ascending: false })

  return ((data ?? []) as { id: string; title: string; is_done: boolean; due_date: string | null; training_module_id: string | null }[]).map((a) => ({
    id: a.id,
    title: a.title,
    isDone: a.is_done,
    dueDate: a.due_date,
    kind: a.training_module_id ? 'training' : 'task',
  }))
}

export interface CohortActionGroup {
  batchId: string
  title: string
  kind: 'training' | 'task'
  dueDate: string | null
  remindBeforeHours: number | null
  assigneeLabel: string
  doneCount: number
  totalCount: number
}

/** Actions grouped by assignment for the mentor's Actions tab ("5/8"). */
export async function listCohortActionsForMentor(cohortId: string): Promise<CohortActionGroup[]> {
  const db = supabaseServer()
  const { data } = await db
    .from('session_actions')
    .select('id, batch_id, title, is_done, due_date, training_module_id, remind_before_hours, created_at')
    .eq('cohort_id', cohortId)
    .order('created_at', { ascending: false })

  type Row = { id: string; batch_id: string | null; title: string; is_done: boolean; due_date: string | null; training_module_id: string | null; remind_before_hours: number | null }
  const rows = (data ?? []) as Row[]
  const groups = new Map<string, { rows: Row[] }>()
  for (const r of rows) {
    const key = r.batch_id ?? r.id
    if (!groups.has(key)) groups.set(key, { rows: [] })
    groups.get(key)!.rows.push(r)
  }
  return [...groups.entries()].map(([key, g]) => {
    const first = g.rows[0]
    const done = g.rows.filter((r) => r.is_done).length
    return {
      batchId: key,
      title: first.title,
      kind: first.training_module_id ? 'training' : 'task',
      dueDate: first.due_date,
      remindBeforeHours: first.remind_before_hours,
      assigneeLabel: g.rows.length === 1 ? '1 mentee' : `${g.rows.length} mentees`,
      doneCount: done,
      totalCount: g.rows.length,
    }
  })
}

// ─── Cohort CRUD + management ───────────────────────────────────────────────

export interface CreateCohortInput {
  name: string
  mentorMemberId: string | null
  plannedSessions: number
  theme: CohortTheme
  timezone: string
  isOpen: boolean
  blurb?: string | null
  freeForTierIds?: string[]
  oneOffPriceCents?: number | null
  creditCost?: number
  inviteMemberIds?: string[]
  resources?: { moduleId: string; mandatory: boolean; dueAt?: string | null }[]
}

/** Create a mentoring cohort, link resources, and invite members. Returns the id. */
export async function createCohort(input: CreateCohortInput): Promise<string> {
  const db = supabaseServer()
  const { data, error } = await db
    .from('mentoring_cohorts')
    .insert({
      name: input.name,
      mentor_member_id: input.mentorMemberId,
      container_type: 'mentoring',
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
  if (error || !data) throw new Error(error?.message ?? 'Could not create cohort')
  const cohortId = data.id as string

  for (const r of input.resources ?? []) {
    await linkCohortTraining(cohortId, r.moduleId, r.mandatory, r.dueAt ?? null)
  }
  if (input.inviteMemberIds && input.inviteMemberIds.length) {
    await inviteMembersToCohort(cohortId, input.inviteMemberIds)
  }
  return cohortId
}

export interface UpdateCohortInput {
  name?: string
  mentorMemberId?: string | null
  theme?: CohortTheme
  timezone?: string
  isOpen?: boolean
  blurb?: string | null
  freeForTierIds?: string[]
  oneOffPriceCents?: number | null
  creditCost?: number
}

export async function updateCohort(cohortId: string, patch: UpdateCohortInput): Promise<void> {
  const db = supabaseServer()
  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.mentorMemberId !== undefined) row.mentor_member_id = patch.mentorMemberId
  if (patch.theme !== undefined) row.theme = patch.theme
  if (patch.timezone !== undefined) row.timezone = patch.timezone
  if (patch.isOpen !== undefined) row.is_open = patch.isOpen
  if (patch.blurb !== undefined) row.blurb = patch.blurb
  if (patch.freeForTierIds !== undefined) row.free_for_tier_ids = patch.freeForTierIds
  if (patch.oneOffPriceCents !== undefined) row.one_off_price_cents = patch.oneOffPriceCents
  if (patch.creditCost !== undefined) row.credit_cost = patch.creditCost
  if (Object.keys(row).length === 0) return
  await db.from('mentoring_cohorts').update(row).eq('id', cohortId)
}

/** Reassign a cohort's mentor (admin). */
export async function reassignMentor(cohortId: string, newMentorId: string): Promise<void> {
  const db = supabaseServer()
  await db.from('mentoring_cohorts').update({ mentor_member_id: newMentorId }).eq('id', cohortId)
  // Ensure the new mentor holds the global mentor capability.
  await grantMentorRole(newMentorId)
}

/** Grant the platform-wide mentor role (the only entry point is per-cohort UI). */
export async function grantMentorRole(memberId: string): Promise<void> {
  const db = supabaseServer()
  await db
    .from('session_hosts')
    .upsert({ member_id: memberId, can_mentor: true }, { onConflict: 'member_id' })
  await addGlobalRole(db, memberId, 'mentor')
}

/** Archive (keep data, close chat/calls) or permanently delete a cohort. */
export async function archiveCohort(cohortId: string): Promise<void> {
  const db = supabaseServer()
  await db
    .from('mentoring_cohorts')
    .update({ lifecycle: 'archived', is_active: false })
    .eq('id', cohortId)
  // Archive = "close the chat and all video calls, keep all data". Chat re-gates
  // via container persistence; cancel any still-upcoming sessions so their rooms
  // can no longer be joined (the room page 404s cancelled sessions).
  await db
    .from('sessions')
    .update({ status: 'cancelled' })
    .eq('cohort_id', cohortId)
    .eq('status', 'scheduled')
    .gt('scheduled_start', new Date().toISOString())
}

export async function deleteCohort(cohortId: string): Promise<void> {
  // Refund spent enrollments BEFORE deleting — restore drawn allocations + refund
  // paid bookings to account credit via the entitlements ledger (the offering and
  // its bookings vanish when the cohort row is deleted).
  await cancelCohortViaLedger(cohortId)
  const db = supabaseServer()
  // FK cascades remove cohort_members, sessions, actions, training links, chat.
  await db.from('mentoring_cohorts').delete().eq('id', cohortId)
}

// ─── Admin: cohorts list, stats, calendar ──────────────────────────────────

export interface AdminCohortRow {
  id: string
  name: string
  theme: CohortTheme
  mentorName: string | null
  memberCount: number
  plannedSessions: number
  heldSessions: number
  progressPct: number
  lifecycle: 'active' | 'archived'
}

export async function listAllCohorts(): Promise<AdminCohortRow[]> {
  const db = supabaseServer()
  const { data } = await db
    .from('mentoring_cohorts')
    .select(`${COHORT_COLS}, members:mentor_member_id(first_name,last_name), cohort_members(member_id,status)`)
    .eq('container_type', 'mentoring')
    .order('created_at', { ascending: false })

  const cohorts = ((data ?? []) as unknown as (RawCohort & { lifecycle?: string })[]).map((c) => ({
    full: toCohortFull(c),
    lifecycle: (c.lifecycle as 'active' | 'archived') ?? 'active',
  }))
  if (cohorts.length === 0) return []

  const ids = cohorts.map((c) => c.full.id)
  const { data: sess } = await db.from('sessions').select('cohort_id, status, scheduled_start').in('cohort_id', ids)
  const now = Date.now()
  const held = new Map<string, number>()
  for (const s of (sess ?? []) as { cohort_id: string; status: string; scheduled_start: string }[]) {
    if (s.status === 'completed' || (s.status === 'scheduled' && new Date(s.scheduled_start).getTime() <= now)) {
      held.set(s.cohort_id, (held.get(s.cohort_id) ?? 0) + 1)
    }
  }

  return cohorts.map(({ full, lifecycle }) => {
    const heldN = held.get(full.id) ?? 0
    return {
      id: full.id,
      name: full.name,
      theme: full.theme,
      mentorName: full.mentorName,
      memberCount: full.memberCount,
      plannedSessions: full.plannedSessions,
      heldSessions: heldN,
      progressPct: full.plannedSessions > 0 ? Math.min(100, Math.round((heldN / full.plannedSessions) * 100)) : 0,
      lifecycle,
    }
  })
}

export interface CohortAccessRow {
  id: string
  name: string
  freeForTierIds: string[]
  oneOffPriceCents: number | null
  creditCost: number
}

/** Per-cohort access config for the Membership & access table. */
export async function listCohortAccessRows(): Promise<CohortAccessRow[]> {
  const db = supabaseServer()
  const { data } = await db
    .from('mentoring_cohorts')
    .select('id, name, free_for_tier_ids, one_off_price_cents, credit_cost')
    .eq('container_type', 'mentoring')
    .eq('lifecycle', 'active')
    .order('name', { ascending: true })
  return ((data ?? []) as { id: string; name: string; free_for_tier_ids: string[] | null; one_off_price_cents: number | null; credit_cost: number | null }[]).map((c) => ({
    id: c.id,
    name: c.name,
    freeForTierIds: c.free_for_tier_ids ?? [],
    oneOffPriceCents: c.one_off_price_cents,
    creditCost: c.credit_cost ?? 1,
  }))
}

export interface AdminCohortStats {
  activeCohorts: number
  membersEnrolled: number
  sessionsThisWeek: number
  pendingInvites: number
}

export async function getAdminCohortStats(): Promise<AdminCohortStats> {
  const db = supabaseServer()
  const { data: cohorts } = await db
    .from('mentoring_cohorts')
    .select('id, lifecycle')
    .eq('container_type', 'mentoring')
  const ids = (cohorts ?? []).map((c) => (c as { id: string }).id)
  const activeCohorts = (cohorts ?? []).filter((c) => ((c as { lifecycle?: string }).lifecycle ?? 'active') === 'active').length

  if (ids.length === 0) return { activeCohorts: 0, membersEnrolled: 0, sessionsThisWeek: 0, pendingInvites: 0 }

  const weekAhead = new Date(Date.now() + 7 * 86_400_000).toISOString()
  const nowIso = new Date().toISOString()
  const [{ count: enrolled }, { count: pending }, { count: thisWeek }] = await Promise.all([
    db.from('cohort_members').select('member_id', { count: 'exact', head: true }).in('cohort_id', ids).eq('status', 'active'),
    db.from('cohort_members').select('member_id', { count: 'exact', head: true }).in('cohort_id', ids).eq('status', 'invited'),
    db.from('sessions').select('id', { count: 'exact', head: true }).in('cohort_id', ids).eq('status', 'scheduled').gte('scheduled_start', nowIso).lte('scheduled_start', weekAhead),
  ])
  return {
    activeCohorts,
    membersEnrolled: enrolled ?? 0,
    sessionsThisWeek: thisWeek ?? 0,
    pendingInvites: pending ?? 0,
  }
}

export interface CalendarSession {
  id: string
  title: string | null
  start: string
  end: string | null
  cohortId: string
  cohortName: string
  theme: CohortTheme
}

/** All mentoring sessions for the calendar (optionally bounded to a month). */
export async function listAllMentoringSessions(): Promise<CalendarSession[]> {
  const db = supabaseServer()
  const { data } = await db
    .from('sessions')
    .select('id, title, scheduled_start, scheduled_end, cohort_id, mentoring_cohorts!inner(name, theme, container_type)')
    .eq('mentoring_cohorts.container_type', 'mentoring')
    .order('scheduled_start', { ascending: true })

  type Row = {
    id: string
    title: string | null
    scheduled_start: string
    scheduled_end: string | null
    cohort_id: string
    mentoring_cohorts: { name: string; theme: string | null } | { name: string; theme: string | null }[] | null
  }
  return ((data ?? []) as unknown as Row[]).map((s) => {
    const c = Array.isArray(s.mentoring_cohorts) ? s.mentoring_cohorts[0] : s.mentoring_cohorts
    return {
      id: s.id,
      title: s.title,
      start: s.scheduled_start,
      end: s.scheduled_end,
      cohortId: s.cohort_id,
      cohortName: c?.name ?? 'Cohort',
      theme: (c?.theme as CohortTheme) ?? 'space',
    }
  })
}

// ─── Membership tiers (Membership & access admin) ───────────────────────────

import Stripe from 'stripe'
import { ALL_TIER_NAMES, tierGroupOf, type TierGroupKey } from '@/lib/tiers'

function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY
  return key ? new Stripe(key, { apiVersion: '2026-05-27.dahlia' }) : null
}

export interface MentoringTier {
  id: string
  name: string
  group: TierGroupKey | null
  isFree: boolean
  /** Monthly USD price in cents, read live from Stripe (null if not on Stripe). */
  monthlyPriceCents: number | null
  includesFreeMentoring: boolean
  /** Annual cohort-credit grant (membership_tiers.mentoring_credits_grant). */
  creditsGrant: number
  /** Annual workshop-credit grant (membership_tiers.workshop_credits_grant). */
  workshopCreditsGrant: number
}

/** The 9 buyable membership tiers with live Stripe pricing + mentoring config,
 * for the admin Membership & access table. */
export async function listMentoringTiers(): Promise<MentoringTier[]> {
  const db = supabaseServer()
  const { data } = await db
    .from('membership_tiers')
    .select('id, name, is_free, stripe_price_id_monthly, includes_free_mentoring, mentoring_credits_grant, workshop_credits_grant')
    .in('name', ALL_TIER_NAMES)

  type Row = {
    id: string
    name: string
    is_free: boolean
    stripe_price_id_monthly: string | null
    includes_free_mentoring: boolean | null
    mentoring_credits_grant: number | null
    workshop_credits_grant: number | null
  }
  const rows = (data ?? []) as Row[]
  const stripe = stripeClient()

  const tiers = await Promise.all(
    rows.map(async (r) => {
      let monthlyPriceCents: number | null = null
      if (stripe && r.stripe_price_id_monthly) {
        try {
          const p = await stripe.prices.retrieve(r.stripe_price_id_monthly)
          monthlyPriceCents = p.unit_amount ?? null
        } catch {
          monthlyPriceCents = null
        }
      }
      return {
        id: r.id,
        name: r.name,
        group: tierGroupOf(r.name),
        isFree: r.is_free,
        monthlyPriceCents,
        includesFreeMentoring: !!r.includes_free_mentoring,
        creditsGrant: r.mentoring_credits_grant ?? 0,
        workshopCreditsGrant: r.workshop_credits_grant ?? 0,
      } satisfies MentoringTier
    }),
  )
  // Order to match the 9-tier display order.
  return tiers.sort((a, b) => ALL_TIER_NAMES.indexOf(a.name) - ALL_TIER_NAMES.indexOf(b.name))
}

/** Update a tier's mentoring config (admin Membership & access). */
export async function updateTierMentoring(
  tierId: string,
  patch: { includesFreeMentoring?: boolean; creditsGrant?: number; workshopCreditsGrant?: number },
): Promise<void> {
  const db = supabaseServer()
  const row: Record<string, unknown> = {}
  if (patch.includesFreeMentoring !== undefined) row.includes_free_mentoring = patch.includesFreeMentoring
  if (patch.creditsGrant !== undefined) row.mentoring_credits_grant = Math.max(0, Math.floor(patch.creditsGrant))
  if (patch.workshopCreditsGrant !== undefined) row.workshop_credits_grant = Math.max(0, Math.floor(patch.workshopCreditsGrant))
  if (Object.keys(row).length === 0) return
  await db.from('membership_tiers').update(row).eq('id', tierId)
}

// ─── Roster ─────────────────────────────────────────────────────────────────

export interface RosterMember {
  memberId: string
  name: string
  email: string | null
  status: 'invited' | 'active'
  /** Open + done actions for this member within the cohort (mentor/admin view). */
  actionsDone: number
  actionsTotal: number
}

/** Roster for a cohort with per-member action progress (mentor + admin Members tab). */
export async function listCohortRoster(cohortId: string): Promise<RosterMember[]> {
  const db = supabaseServer()
  const { data: rows } = await db
    .from('cohort_members')
    .select('member_id, status, members:member_id(first_name, last_name, email)')
    .eq('cohort_id', cohortId)
    .order('status', { ascending: true })

  type Row = {
    member_id: string
    status: string
    members: { first_name: string | null; last_name: string | null; email: string | null } | { first_name: string | null; last_name: string | null; email: string | null }[] | null
  }
  const roster = (rows ?? []) as unknown as Row[]
  if (roster.length === 0) return []

  // Per-member action progress for this cohort (cohort_id covers both
  // cohort-level and backfilled session-level actions).
  const doneByMember = new Map<string, number>()
  const totalByMember = new Map<string, number>()
  const { data: acts } = await db
    .from('session_actions')
    .select('member_id, is_done')
    .eq('cohort_id', cohortId)
  for (const a of (acts ?? []) as { member_id: string; is_done: boolean }[]) {
    totalByMember.set(a.member_id, (totalByMember.get(a.member_id) ?? 0) + 1)
    if (a.is_done) doneByMember.set(a.member_id, (doneByMember.get(a.member_id) ?? 0) + 1)
  }

  return roster.map((r) => {
    const m = Array.isArray(r.members) ? r.members[0] : r.members
    return {
      memberId: r.member_id,
      name: [m?.first_name, m?.last_name].filter(Boolean).join(' ') || (m?.email ?? 'Member'),
      email: m?.email ?? null,
      status: (r.status as 'invited' | 'active') ?? 'active',
      actionsDone: doneByMember.get(r.member_id) ?? 0,
      actionsTotal: totalByMember.get(r.member_id) ?? 0,
    }
  })
}

// ─── Cohort file/link resources (community_resources via container_contents) ──
// The Resources tab unifies training courses (cohort_training_links) + auto
// recordings + standalone files attached from the community resource library.

export interface CohortFileResource {
  resourceId: string
  title: string
  fileType: string | null
  isMandatory: boolean
  dueAt: string | null
  /** Per-attachment membership floor (decision 6b): null/0 = all, >0 = paid. */
  minMembership: number | null
}

/** Standalone file resources attached to a cohort (content_type='resource'). */
export async function listCohortFileResources(cohortId: string): Promise<CohortFileResource[]> {
  const db = supabaseServer()
  const { data: links } = await db
    .from('container_contents')
    .select('content_ref, is_mandatory, due_at, display_order, min_membership')
    .eq('container_id', cohortId)
    .eq('content_type', 'resource')
    .order('display_order')
  if (!links || links.length === 0) return []
  const refs = links.map((l) => l.content_ref as string)
  const { data: res } = await db
    .from('community_resources')
    .select('id, title, file_type')
    .in('id', refs)
  const meta = new Map((res ?? []).map((r) => [r.id as string, r as { id: string; title: string; file_type: string | null }]))
  return links
    .filter((l) => meta.has(l.content_ref as string))
    .map((l) => {
      const m = meta.get(l.content_ref as string)!
      return {
        resourceId: m.id,
        title: m.title,
        fileType: m.file_type,
        isMandatory: !!l.is_mandatory,
        dueAt: (l.due_at as string | null) ?? null,
        minMembership: (l.min_membership as number | null) ?? null,
      }
    })
}

/** Search the community resource library to attach to a cohort (mentor picker). */
export async function searchAttachableResources(q: string): Promise<{ id: string; title: string; fileType: string | null }[]> {
  const db = supabaseServer()
  let query = db.from('community_resources').select('id, title, file_type').order('created_at', { ascending: false }).limit(10)
  if (q.trim()) query = query.ilike('title', `%${q.trim()}%`)
  const { data } = await query
  return (data ?? []).map((r) => ({ id: r.id as string, title: r.title as string, fileType: (r.file_type as string | null) ?? null }))
}

/** Attach (or update meta of) a community resource on a cohort. Idempotent. */
export async function attachCohortResource(cohortId: string, resourceId: string, mandatory: boolean, dueAt: string | null): Promise<void> {
  const db = supabaseServer()
  await db.from('container_contents').upsert(
    { container_id: cohortId, content_type: 'resource', content_ref: resourceId, is_mandatory: mandatory, due_at: dueAt },
    { onConflict: 'container_id,content_type,content_ref' },
  )
}

export async function detachCohortResource(cohortId: string, resourceId: string): Promise<void> {
  const db = supabaseServer()
  await db
    .from('container_contents')
    .delete()
    .eq('container_id', cohortId)
    .eq('content_type', 'resource')
    .eq('content_ref', resourceId)
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

  // Open actions for this member in these cohorts (cohort_id backfilled for
  // session-tied actions, so this covers both cohort- and session-level tasks).
  const { data: acts } = await db
    .from('session_actions')
    .select('cohort_id')
    .eq('member_id', member.id)
    .eq('is_done', false)
    .in('cohort_id', ids)

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
  for (const a of (acts ?? []) as { cohort_id: string | null }[]) {
    if (a.cohort_id) actionsByCohort.set(a.cohort_id, (actionsByCohort.get(a.cohort_id) ?? 0) + 1)
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

