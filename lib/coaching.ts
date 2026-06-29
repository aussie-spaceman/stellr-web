// lib/coaching.ts — server-side domain logic for Coaching (1-on-1 "Workshops").
//
// Coaching mirrors Mentoring (lib/mentoring.ts) with one structural change: a
// Workshop is strictly 1-on-1 — a mentoring_cohorts row with
// container_type='coaching', mentor_member_id = the coach, and EXACTLY ONE
// coachee on the roster (cohort_members, relationship='participant'). It reuses
// the session/chat/training/actions machinery in lib/sessions.ts + lib/mentoring.ts
// (all container-generic on cohort_id) and specialises the parts that differ:
//   • billing is a FREE-SESSION counter ("X free sessions left") from
//     session_entitlements('coaching') + paid top-ups (session_credits), NOT
//     mentoring credits;
//   • access is always 1-on-1: invite-don't-add, auto-name "<Coach> + <Member>
//     Coaching", no roster/audience pickers;
//   • the coaching accent is always violet (no space/enviro theme).
//
// Decisions (2026-06-24): free-coaching tiers mirror free-mentoring tiers;
// allowance resets annually (validity_days), no rollover; paid top-ups allowed;
// a cancelled session returns to the allowance (refund-on-cancel).
import 'server-only'
import { supabaseServer } from '@/lib/supabase'
import type { CommunityMember } from '@/lib/community'
import { notifyMember, notifyMembers } from '@/lib/notify'
import { linkCohortTraining } from '@/lib/sessions'
import { logActivity } from '@/lib/activity-log'
import { reportEnrollmentGate, accessGatesEnforced } from '@/lib/access-gates'
import { addGlobalRole } from '@/lib/member-roles'
import { DEFAULT_TZ } from '@/lib/mentoring-format'
import { autoWorkshopName } from '@/lib/coaching-format'
import Stripe from 'stripe'
import { ALL_TIER_NAMES, tierGroupOf, type TierGroupKey } from '@/lib/tiers'

const CONTAINER = 'coaching' as const

// ─── Free-session allowance ("X free sessions left") ─────────────────────────

export interface CoachingAllowance {
  /** Free sessions included by the member's most generous tier (per period). */
  included: number
  /** Free sessions consumed this period (scheduled or completed, not cancelled). */
  used: number
  /** Free sessions still available this period. */
  remaining: number
  /** Purchased extra sessions on top of the included allowance. */
  extraCredits: number
  /** Start of the current allowance period (annual reset anchor). */
  periodStart: string | null
  /** When the current allowance period ends, if the tier sets a validity window. */
  periodEnd: string | null
  /** Name of the tier providing the allowance, for "Included with your … membership". */
  tierName: string | null
}

/**
 * The member's coaching free-session allowance for the CURRENT membership year.
 * Unlike the lifetime counter in sessions.getEntitlement, this windows `used` to
 * the active period (annual reset, no rollover) and excludes cancelled sessions
 * (refund-on-cancel).
 */
export async function getCoachingAllowance(member: CommunityMember): Promise<CoachingAllowance> {
  const db = supabaseServer()

  // Purchased extra sessions are available regardless of tier/period.
  const { count: creditCount } = await db
    .from('session_credits')
    .select('id', { count: 'exact', head: true })
    .eq('member_id', member.id)
    .eq('session_type', 'coaching')
    .eq('status', 'available')
  const extraCredits = creditCount ?? 0

  if (member.activeTierIds.length === 0) {
    return { included: 0, used: 0, remaining: 0, extraCredits, periodStart: null, periodEnd: null, tierName: null }
  }

  // Most generous coaching entitlement among the member's active tiers.
  const { data: ents } = await db
    .from('session_entitlements')
    .select('tier_id, included_sessions, validity_days, membership_tiers(name)')
    .eq('session_type', 'coaching')
    .in('tier_id', member.activeTierIds)

  type EntRow = {
    tier_id: string
    included_sessions: number | null
    validity_days: number | null
    membership_tiers: { name?: string } | { name?: string }[] | null
  }
  const best = ((ents ?? []) as EntRow[]).reduce<{ included: number; validity: number | null; tierName: string | null }>(
    (acc, r) => {
      const inc = r.included_sessions ?? 0
      if (inc > acc.included) {
        const t = Array.isArray(r.membership_tiers) ? r.membership_tiers[0] : r.membership_tiers
        return { included: inc, validity: r.validity_days ?? null, tierName: t?.name ?? null }
      }
      return acc
    },
    { included: 0, validity: null, tierName: null },
  )

  // Period window: anchor on the member's earliest active membership start, then
  // roll forward by `validity` days to the current period (annual reset).
  let periodStart: string | null = null
  let periodEnd: string | null = null
  if (best.included > 0) {
    const { data: ms } = await db
      .from('member_memberships')
      .select('started_at')
      .eq('member_id', member.id)
      .eq('renewal_status', 'active')
      .order('started_at', { ascending: true })
      .limit(1)
    const startStr = ms?.[0]?.started_at as string | undefined
    const validity = best.validity ?? 365
    if (startStr) {
      const anchor = new Date(startStr)
      if (validity > 0) {
        const periodMs = validity * 86_400_000
        const elapsed = Date.now() - anchor.getTime()
        const periods = elapsed > 0 ? Math.floor(elapsed / periodMs) : 0
        const ps = new Date(anchor.getTime() + periods * periodMs)
        periodStart = ps.toISOString()
        periodEnd = new Date(ps.getTime() + periodMs).toISOString()
      } else {
        periodStart = anchor.toISOString()
      }
    }
  }

  // Used = coaching sessions the member attends this period that aren't paid extra
  // and aren't cancelled.
  let used = 0
  if (best.included > 0) {
    const { data: attended } = await db
      .from('session_participants')
      .select('sessions!inner(session_type, status, is_paid_extra, scheduled_start)')
      .eq('member_id', member.id)
    type Row = { sessions: { session_type: string; status: string; is_paid_extra: boolean; scheduled_start: string } | { session_type: string; status: string; is_paid_extra: boolean; scheduled_start: string }[] }
    const psMs = periodStart ? new Date(periodStart).getTime() : 0
    used = ((attended ?? []) as unknown as Row[])
      .map((r) => (Array.isArray(r.sessions) ? r.sessions[0] : r.sessions))
      .filter(
        (s) =>
          s &&
          s.session_type === 'coaching' &&
          !s.is_paid_extra &&
          (s.status === 'scheduled' || s.status === 'completed') &&
          (!periodStart || new Date(s.scheduled_start).getTime() >= psMs),
      ).length
  }

  return {
    included: best.included,
    used,
    remaining: Math.max(best.included - used, 0),
    extraCredits,
    periodStart,
    periodEnd,
    tierName: best.tierName,
  }
}

// ─── Workshop model ──────────────────────────────────────────────────────────

export interface WorkshopFull {
  id: string
  name: string
  timezone: string
  plannedSessions: number
  startDate: string | null
  freeForTierIds: string[]
  oneOffPriceCents: number | null
  coachMemberId: string | null
  coachName: string | null
  /** The single coachee (active or invited), if any. */
  memberId: string | null
  memberName: string | null
  memberEmail: string | null
  memberStatus: 'active' | 'invited' | null
  lifecycle: 'active' | 'archived'
}

const WS_COLS =
  'id, name, timezone, planned_sessions, start_date, free_for_tier_ids, one_off_price_cents, mentor_member_id, lifecycle, container_type'

function fullName(m: { first_name: string | null; last_name: string | null } | null): string | null {
  if (!m) return null
  return [m.first_name, m.last_name].filter(Boolean).join(' ') || null
}

type RawWorkshop = {
  id: string
  name: string
  timezone: string | null
  planned_sessions: number | null
  start_date: string | null
  free_for_tier_ids: string[] | null
  one_off_price_cents: number | null
  mentor_member_id: string | null
  lifecycle?: string | null
  members?: { first_name: string | null; last_name: string | null } | { first_name: string | null; last_name: string | null }[] | null
  cohort_members?: { member_id: string; status: string; members?: { first_name: string | null; last_name: string | null; email?: string | null } | { first_name: string | null; last_name: string | null; email?: string | null }[] | null }[] | null
}

function toWorkshopFull(c: RawWorkshop): WorkshopFull {
  const coach = Array.isArray(c.members) ? c.members[0] : c.members
  // Single coachee: prefer active, else invited.
  const roster = c.cohort_members ?? []
  const row = roster.find((r) => r.status === 'active') ?? roster.find((r) => r.status === 'invited') ?? null
  const rm = row ? (Array.isArray(row.members) ? row.members[0] : row.members) : null
  return {
    id: c.id,
    name: c.name,
    timezone: c.timezone ?? DEFAULT_TZ,
    plannedSessions: c.planned_sessions ?? 6,
    startDate: c.start_date,
    freeForTierIds: c.free_for_tier_ids ?? [],
    oneOffPriceCents: c.one_off_price_cents,
    coachMemberId: c.mentor_member_id,
    coachName: fullName(coach ?? null),
    memberId: row?.member_id ?? null,
    memberName: fullName(rm ?? null),
    memberEmail: rm?.email ?? null,
    memberStatus: (row?.status as 'active' | 'invited' | null) ?? null,
    lifecycle: (c.lifecycle as 'active' | 'archived') ?? 'active',
  }
}

export async function getWorkshopFull(workshopId: string): Promise<WorkshopFull | null> {
  const db = supabaseServer()
  const { data } = await db
    .from('mentoring_cohorts')
    .select(`${WS_COLS}, members:mentor_member_id(first_name, last_name), cohort_members(member_id, status, members:member_id(first_name, last_name, email))`)
    .eq('id', workshopId)
    .eq('container_type', CONTAINER)
    .maybeSingle()
  if (!data) return null
  return toWorkshopFull(data as unknown as RawWorkshop)
}

// ─── Workshop space resolution (member + coach) ──────────────────────────────

export interface WorkshopSpace {
  id: string
  name: string
  lifecycle: 'active' | 'archived'
  /** True when the viewer is the coach (mentor_member_id). */
  isCoach: boolean
}

/** Resolve a workshop for a viewer who is its coachee or coach; null otherwise. */
export async function getWorkshopSpace(memberId: string, workshopId: string): Promise<WorkshopSpace | null> {
  const db = supabaseServer()
  const { data: c } = await db
    .from('mentoring_cohorts')
    .select('id, name, lifecycle, mentor_member_id')
    .eq('id', workshopId)
    .eq('container_type', CONTAINER)
    .maybeSingle()
  if (!c) return null

  const isCoach = c.mentor_member_id === memberId
  let allowed = isCoach
  if (!allowed) {
    const { data: cm } = await db
      .from('cohort_members')
      .select('member_id')
      .eq('cohort_id', workshopId)
      .eq('member_id', memberId)
      .eq('status', 'active')
      .maybeSingle()
    allowed = !!cm
  }
  if (!allowed) return null
  return {
    id: c.id as string,
    name: c.name as string,
    lifecycle: ((c.lifecycle as string) ?? 'active') as 'active' | 'archived',
    isCoach,
  }
}

// ─── Member landing aggregation ──────────────────────────────────────────────

export interface WorkshopCard {
  id: string
  name: string
  timezone: string
  isCoach: boolean
  lifecycle: 'active' | 'archived'
  coachName: string | null
  memberName: string | null
  plannedSessions: number
  nextSessionStart: string | null
  nextSessionEnd: string | null
  progressPct: number
  actionsDue: number
}

export interface PendingWorkshopInvite {
  workshopId: string
  name: string
  coachName: string | null
  startDate: string | null
  plannedSessions: number
  invitedAt: string
}

/** Active + completed workshops for the member landing (coachee or coach). */
export async function listMemberWorkshops(member: CommunityMember): Promise<WorkshopCard[]> {
  const db = supabaseServer()
  const [{ data: asMember }, { data: asCoach }] = await Promise.all([
    db
      .from('cohort_members')
      .select(`mentoring_cohorts!inner(${WS_COLS}, members:mentor_member_id(first_name,last_name), cohort_members(member_id,status,members:member_id(first_name,last_name)))`)
      .eq('member_id', member.id)
      .eq('status', 'active')
      .eq('mentoring_cohorts.container_type', CONTAINER),
    db
      .from('mentoring_cohorts')
      .select(`${WS_COLS}, members:mentor_member_id(first_name,last_name), cohort_members(member_id,status,members:member_id(first_name,last_name))`)
      .eq('mentor_member_id', member.id)
      .eq('container_type', CONTAINER),
  ])

  const raw: RawWorkshop[] = []
  for (const r of asMember ?? []) {
    const c = (Array.isArray(r.mentoring_cohorts) ? r.mentoring_cohorts[0] : r.mentoring_cohorts) as RawWorkshop | null
    if (c) raw.push(c)
  }
  for (const c of (asCoach ?? []) as unknown as RawWorkshop[]) raw.push(c)

  const byId = new Map<string, WorkshopFull & { isCoach: boolean }>()
  for (const c of raw) {
    if (byId.has(c.id)) continue
    byId.set(c.id, { ...toWorkshopFull(c), isCoach: c.mentor_member_id === member.id })
  }
  const workshops = [...byId.values()]
  if (workshops.length === 0) return []
  const ids = workshops.map((w) => w.id)

  const { data: sess } = await db
    .from('sessions')
    .select('cohort_id, scheduled_start, scheduled_end, status')
    .in('cohort_id', ids)
    .order('scheduled_start', { ascending: true })

  const { data: acts } = await db
    .from('session_actions')
    .select('cohort_id')
    .eq('member_id', member.id)
    .eq('is_done', false)
    .in('cohort_id', ids)

  const now = Date.now()
  const nextByWs = new Map<string, { start: string; end: string | null }>()
  const heldByWs = new Map<string, number>()
  for (const s of (sess ?? []) as { cohort_id: string; scheduled_start: string; scheduled_end: string | null; status: string }[]) {
    if (s.status === 'completed' || (s.status === 'scheduled' && new Date(s.scheduled_start).getTime() <= now)) {
      heldByWs.set(s.cohort_id, (heldByWs.get(s.cohort_id) ?? 0) + 1)
    }
    if (s.status === 'scheduled' && new Date(s.scheduled_start).getTime() > now && !nextByWs.has(s.cohort_id)) {
      nextByWs.set(s.cohort_id, { start: s.scheduled_start, end: s.scheduled_end })
    }
  }
  const actionsByWs = new Map<string, number>()
  for (const a of (acts ?? []) as { cohort_id: string | null }[]) {
    if (a.cohort_id) actionsByWs.set(a.cohort_id, (actionsByWs.get(a.cohort_id) ?? 0) + 1)
  }

  return workshops
    .map((w) => {
      const next = nextByWs.get(w.id) ?? null
      const held = heldByWs.get(w.id) ?? 0
      const progressPct = w.plannedSessions > 0 ? Math.min(100, Math.round((held / w.plannedSessions) * 100)) : 0
      return {
        id: w.id,
        name: w.name,
        timezone: w.timezone,
        isCoach: w.isCoach,
        lifecycle: w.lifecycle,
        coachName: w.coachName,
        memberName: w.memberName,
        plannedSessions: w.plannedSessions,
        nextSessionStart: next?.start ?? null,
        nextSessionEnd: next?.end ?? null,
        progressPct,
        actionsDue: actionsByWs.get(w.id) ?? 0,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Pending workshop invites awaiting this member's response (banner). */
export async function listPendingWorkshopInvites(member: CommunityMember): Promise<PendingWorkshopInvite[]> {
  const db = supabaseServer()
  const { data } = await db
    .from('cohort_members')
    .select(`invited_at, mentoring_cohorts!inner(id, name, planned_sessions, start_date, container_type, members:mentor_member_id(first_name,last_name))`)
    .eq('member_id', member.id)
    .eq('status', 'invited')
    .eq('mentoring_cohorts.container_type', CONTAINER)

  type Row = { invited_at: string | null; mentoring_cohorts: RawWorkshop | RawWorkshop[] | null }
  return ((data ?? []) as unknown as Row[]).map((r) => {
    const c = (Array.isArray(r.mentoring_cohorts) ? r.mentoring_cohorts[0] : r.mentoring_cohorts) as RawWorkshop
    const coach = Array.isArray(c.members) ? c.members[0] : c.members
    return {
      workshopId: c.id,
      name: c.name,
      coachName: fullName(coach ?? null),
      startDate: c.start_date,
      plannedSessions: c.planned_sessions ?? 6,
      invitedAt: r.invited_at ?? new Date().toISOString(),
    }
  })
}

// ─── Invite (single-select; invite-don't-add) ────────────────────────────────

/** Invite the single member to a workshop (status 'invited'; joins on accept). */
export async function inviteWorkshopMember(workshopId: string, memberId: string): Promise<boolean> {
  const db = supabaseServer()
  const now = new Date().toISOString()
  const { error } = await db.from('cohort_members').upsert(
    { cohort_id: workshopId, member_id: memberId, relationship: 'participant', status: 'invited', invited_at: now },
    { onConflict: 'cohort_id,member_id', ignoreDuplicates: true },
  )
  if (error) return false

  const { data: ws } = await db.from('mentoring_cohorts').select('name').eq('id', workshopId).maybeSingle()
  const name = (ws?.name as string) ?? 'a coaching workshop'
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'
  const inviteUrl = `${base}/community/coaching/${workshopId}/invite`
  await notifyMembers([memberId], {
    type: 'announcement',
    body: `You've been invited to a coaching workshop: ${name}.`,
    referenceType: 'coaching_invite',
    referenceId: workshopId,
    email: {
      subject: `You're invited to coaching: ${name}`,
      html: `<p>You've been invited to a 1-on-1 coaching workshop on Stellr: <strong>${name}</strong>.</p>
             <p><a href="${inviteUrl}">Review and accept your invitation →</a></p>`,
      text: `You've been invited to coaching: ${name}. Review and accept: ${inviteUrl}`,
    },
  })
  return true
}

// ─── Workshop CRUD ───────────────────────────────────────────────────────────

export interface CreateWorkshopInput {
  coachMemberId: string | null
  memberId: string | null
  /** Optional explicit name; defaults to auto "<Coach> + <Member> Coaching". */
  name?: string | null
  plannedSessions: number
  timezone: string
  freeForTierIds?: string[]
  oneOffPriceCents?: number | null
  resources?: { moduleId: string; mandatory: boolean; dueAt?: string | null }[]
}

/** Create a 1-on-1 coaching workshop, link resources, and invite the member. */
export async function createWorkshop(input: CreateWorkshopInput): Promise<string> {
  const db = supabaseServer()

  // Resolve names for the auto-name.
  const ids = [input.coachMemberId, input.memberId].filter(Boolean) as string[]
  const names = new Map<string, string | null>()
  if (ids.length) {
    const { data } = await db.from('members').select('id, first_name, last_name').in('id', ids)
    for (const m of data ?? []) names.set(m.id as string, fullName(m as { first_name: string | null; last_name: string | null }))
  }
  const name =
    input.name?.trim() || autoWorkshopName(names.get(input.coachMemberId ?? '') ?? null, names.get(input.memberId ?? '') ?? null)

  const { data, error } = await db
    .from('mentoring_cohorts')
    .insert({
      name,
      mentor_member_id: input.coachMemberId,
      container_type: CONTAINER,
      lifecycle: 'active',
      is_active: true,
      theme: 'space',
      timezone: input.timezone,
      planned_sessions: input.plannedSessions,
      is_open: false,
      free_for_tier_ids: input.freeForTierIds ?? [],
      one_off_price_cents: input.oneOffPriceCents ?? null,
      credit_cost: 1,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(error?.message ?? 'Could not create workshop')
  const workshopId = data.id as string

  for (const r of input.resources ?? []) {
    await linkCohortTraining(workshopId, r.moduleId, r.mandatory, r.dueAt ?? null)
  }
  // Ensure the coach holds the platform coach capability.
  if (input.coachMemberId) await grantCoachRole(input.coachMemberId)
  if (input.memberId) await inviteWorkshopMember(workshopId, input.memberId)
  return workshopId
}

export interface UpdateWorkshopInput {
  name?: string
  coachMemberId?: string | null
  timezone?: string
  freeForTierIds?: string[]
  oneOffPriceCents?: number | null
}

export async function updateWorkshop(workshopId: string, patch: UpdateWorkshopInput): Promise<void> {
  const db = supabaseServer()
  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.coachMemberId !== undefined) row.mentor_member_id = patch.coachMemberId
  if (patch.timezone !== undefined) row.timezone = patch.timezone
  if (patch.freeForTierIds !== undefined) row.free_for_tier_ids = patch.freeForTierIds
  if (patch.oneOffPriceCents !== undefined) row.one_off_price_cents = patch.oneOffPriceCents
  if (Object.keys(row).length === 0) return
  await db.from('mentoring_cohorts').update(row).eq('id', workshopId)
  if (patch.coachMemberId) await grantCoachRole(patch.coachMemberId)
}

/** Grant the platform-wide coach capability (only entry point is the workshop UI). */
export async function grantCoachRole(memberId: string): Promise<void> {
  const db = supabaseServer()
  await db.from('session_hosts').upsert({ member_id: memberId, can_coach: true }, { onConflict: 'member_id' })
  await addGlobalRole(db, memberId, 'coach')
}

/** Reassign a workshop's coach (admin). */
export async function reassignCoach(workshopId: string, newCoachId: string): Promise<void> {
  await updateWorkshop(workshopId, { coachMemberId: newCoachId })
}

/** Replace the workshop's member (single-select invite). Removes the existing
 *  coachee, then invites the new one. */
export async function replaceWorkshopMember(workshopId: string, newMemberId: string): Promise<void> {
  const db = supabaseServer()
  await db.from('cohort_members').delete().eq('cohort_id', workshopId)
  await inviteWorkshopMember(workshopId, newMemberId)
}

export async function removeWorkshopMember(workshopId: string, memberId: string): Promise<void> {
  const db = supabaseServer()
  await db.from('cohort_members').delete().eq('cohort_id', workshopId).eq('member_id', memberId)
}

/** Archive: keep all data, close the chat + cancel upcoming sessions. */
export async function archiveWorkshop(workshopId: string): Promise<void> {
  const db = supabaseServer()
  await db.from('mentoring_cohorts').update({ lifecycle: 'archived', is_active: false }).eq('id', workshopId)
  await db
    .from('sessions')
    .update({ status: 'cancelled' })
    .eq('cohort_id', workshopId)
    .eq('status', 'scheduled')
    .gt('scheduled_start', new Date().toISOString())
}

/** Permanently delete a workshop and all its data (refunds paid top-ups first). */
export async function deleteWorkshop(workshopId: string): Promise<void> {
  await refundWorkshop(workshopId)
  const db = supabaseServer()
  await db.from('mentoring_cohorts').delete().eq('id', workshopId)
}

/** Return any top-up credits spent on this workshop to the member's balance. Free
 *  allowance auto-refunds (cancelled sessions stop counting), so nothing to do
 *  there. Paid one-off → monetary account credit. */
export async function refundWorkshop(workshopId: string): Promise<void> {
  const db = supabaseServer()
  const ws = await getWorkshopFull(workshopId)
  const wsName = ws?.name ?? 'a coaching workshop'
  const { data: spent } = await db
    .from('session_credits')
    .select('id, member_id, source')
    .eq('consumed_cohort_id', workshopId)
    .eq('status', 'consumed')
  for (const c of (spent ?? []) as { id: string; member_id: string; source: string }[]) {
    if (c.source === 'purchase') {
      const cents = ws?.oneOffPriceCents ?? 0
      if (cents > 0) {
        await db.from('account_credits').insert({
          member_id: c.member_id,
          currency: 'usd',
          amount_cents: cents,
          remaining_cents: cents,
          source_type: 'coaching_workshop_refund',
          reason: `Account credit for cancelled coaching workshop: ${wsName}`,
        })
      }
    } else {
      await db
        .from('session_credits')
        .update({ status: 'available', consumed_at: null, consumed_cohort_id: null })
        .eq('id', c.id)
    }
    await logActivity({
      memberId: c.member_id,
      category: 'billing',
      action: 'refund_issued',
      summary: `Coaching credit returned — workshop ${wsName} was cancelled`,
      metadata: { kind: 'coaching_workshop_refund', workshopId },
      actorType: 'admin',
    }, db)
  }
}

// ─── Request a session (member → coach) ──────────────────────────────────────

/** A member asks their coach for a session at a preferred time (no booking). */
export async function requestSession(
  member: CommunityMember,
  workshopId: string,
  prefs: { preferredDate?: string | null; preferredTime?: string | null; note?: string | null },
): Promise<boolean> {
  const ws = await getWorkshopFull(workshopId)
  if (!ws || !ws.coachMemberId) return false
  const when = [prefs.preferredDate, prefs.preferredTime].filter(Boolean).join(' ')
  const memberName = [member.first_name, member.last_name].filter(Boolean).join(' ') || 'A member'
  await notifyMember(ws.coachMemberId, {
    type: 'session',
    body: `${memberName} requested a coaching session${when ? ` around ${when}` : ''}${prefs.note ? `: "${prefs.note}"` : '.'}`,
    referenceType: 'coaching',
    referenceId: workshopId,
    actorMemberId: member.id,
  })
  await logActivity({
    memberId: member.id,
    actorType: 'member',
    actorMemberId: member.id,
    category: 'community',
    action: 'coaching_session_requested',
    summary: `Requested a coaching session in ${ws.name}`,
    metadata: { workshopId, ...prefs },
  })
  return true
}

// ─── Coach dashboard ─────────────────────────────────────────────────────────

export interface CoachStats {
  nextSession: { start: string; end: string | null; workshopName: string; timezone: string } | null
  flaggedCount: number
  actionsDue: number
  coachedWorkshopIds: string[]
}

export async function getCoachDashboardStats(coachId: string): Promise<CoachStats> {
  const db = supabaseServer()
  const { data: ws } = await db
    .from('mentoring_cohorts')
    .select('id, name, timezone')
    .eq('mentor_member_id', coachId)
    .eq('container_type', CONTAINER)
    .eq('lifecycle', 'active')
  const list = (ws ?? []) as { id: string; name: string; timezone: string | null }[]
  const ids = list.map((c) => c.id)
  if (ids.length === 0) return { nextSession: null, flaggedCount: 0, actionsDue: 0, coachedWorkshopIds: [] }

  const nowIso = new Date().toISOString()
  const [{ data: sess }, { count: actionsDue }, { data: channels }] = await Promise.all([
    db.from('sessions').select('cohort_id, scheduled_start, scheduled_end, status')
      .in('cohort_id', ids).eq('status', 'scheduled').gt('scheduled_start', nowIso)
      .order('scheduled_start', { ascending: true }).limit(1),
    db.from('session_actions').select('id', { count: 'exact', head: true }).in('cohort_id', ids).eq('is_done', false),
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
  const w = ns ? list.find((c) => c.id === ns.cohort_id) : undefined
  return {
    nextSession: ns ? { start: ns.scheduled_start, end: ns.scheduled_end, workshopName: w?.name ?? 'Workshop', timezone: w?.timezone ?? DEFAULT_TZ } : null,
    flaggedCount,
    actionsDue: actionsDue ?? 0,
    coachedWorkshopIds: ids,
  }
}

// ─── Admin: list, stats, calendar, access ────────────────────────────────────

export interface AdminWorkshopRow {
  id: string
  name: string
  coachName: string | null
  memberName: string | null
  memberStatus: 'active' | 'invited' | null
  plannedSessions: number
  heldSessions: number
  progressPct: number
  lifecycle: 'active' | 'archived'
}

export async function listAllWorkshops(): Promise<AdminWorkshopRow[]> {
  const db = supabaseServer()
  const { data } = await db
    .from('mentoring_cohorts')
    .select(`${WS_COLS}, members:mentor_member_id(first_name,last_name), cohort_members(member_id,status,members:member_id(first_name,last_name))`)
    .eq('container_type', CONTAINER)
    .order('created_at', { ascending: false })

  const workshops = ((data ?? []) as unknown as RawWorkshop[]).map(toWorkshopFull)
  if (workshops.length === 0) return []
  const ids = workshops.map((w) => w.id)
  const { data: sess } = await db.from('sessions').select('cohort_id, status, scheduled_start').in('cohort_id', ids)
  const now = Date.now()
  const held = new Map<string, number>()
  for (const s of (sess ?? []) as { cohort_id: string; status: string; scheduled_start: string }[]) {
    if (s.status === 'completed' || (s.status === 'scheduled' && new Date(s.scheduled_start).getTime() <= now)) {
      held.set(s.cohort_id, (held.get(s.cohort_id) ?? 0) + 1)
    }
  }
  return workshops.map((w) => {
    const heldN = held.get(w.id) ?? 0
    return {
      id: w.id,
      name: w.name,
      coachName: w.coachName,
      memberName: w.memberName,
      memberStatus: w.memberStatus,
      plannedSessions: w.plannedSessions,
      heldSessions: heldN,
      progressPct: w.plannedSessions > 0 ? Math.min(100, Math.round((heldN / w.plannedSessions) * 100)) : 0,
      lifecycle: w.lifecycle,
    }
  })
}

export interface AdminWorkshopStats {
  activeWorkshops: number
  coaches: number
  sessionsThisWeek: number
  pendingInvites: number
}

export async function getAdminWorkshopStats(): Promise<AdminWorkshopStats> {
  const db = supabaseServer()
  const { data: ws } = await db
    .from('mentoring_cohorts')
    .select('id, lifecycle, mentor_member_id')
    .eq('container_type', CONTAINER)
  const rows = (ws ?? []) as { id: string; lifecycle?: string; mentor_member_id: string | null }[]
  const ids = rows.map((c) => c.id)
  const activeWorkshops = rows.filter((c) => (c.lifecycle ?? 'active') === 'active').length
  const coaches = new Set(rows.map((c) => c.mentor_member_id).filter(Boolean)).size
  if (ids.length === 0) return { activeWorkshops: 0, coaches: 0, sessionsThisWeek: 0, pendingInvites: 0 }

  const nowIso = new Date().toISOString()
  const weekAhead = new Date(Date.now() + 7 * 86_400_000).toISOString()
  const [{ count: pending }, { count: thisWeek }] = await Promise.all([
    db.from('cohort_members').select('member_id', { count: 'exact', head: true }).in('cohort_id', ids).eq('status', 'invited'),
    db.from('sessions').select('id', { count: 'exact', head: true }).in('cohort_id', ids).eq('status', 'scheduled').gte('scheduled_start', nowIso).lte('scheduled_start', weekAhead),
  ])
  return { activeWorkshops, coaches, sessionsThisWeek: thisWeek ?? 0, pendingInvites: pending ?? 0 }
}

export interface CoachingCalendarSession {
  id: string
  title: string | null
  start: string
  end: string | null
  workshopId: string
  workshopName: string
  memberName: string | null
}

/** All coaching sessions for the admin calendar (per-member colour chips). */
export async function listAllCoachingSessions(): Promise<CoachingCalendarSession[]> {
  const db = supabaseServer()
  const { data } = await db
    .from('sessions')
    .select('id, title, scheduled_start, scheduled_end, cohort_id, member_id, mentoring_cohorts!inner(name, container_type), members:member_id(first_name, last_name)')
    .eq('mentoring_cohorts.container_type', CONTAINER)
    .order('scheduled_start', { ascending: true })

  type Row = {
    id: string
    title: string | null
    scheduled_start: string
    scheduled_end: string | null
    cohort_id: string
    mentoring_cohorts: { name: string } | { name: string }[] | null
    members: { first_name: string | null; last_name: string | null } | { first_name: string | null; last_name: string | null }[] | null
  }
  return ((data ?? []) as unknown as Row[]).map((s) => {
    const w = Array.isArray(s.mentoring_cohorts) ? s.mentoring_cohorts[0] : s.mentoring_cohorts
    const m = Array.isArray(s.members) ? s.members[0] : s.members
    return {
      id: s.id,
      title: s.title,
      start: s.scheduled_start,
      end: s.scheduled_end,
      workshopId: s.cohort_id,
      workshopName: w?.name ?? 'Workshop',
      memberName: fullName(m ?? null),
    }
  })
}

export interface WorkshopAccessRow {
  id: string
  name: string
  freeForTierIds: string[]
  oneOffPriceCents: number | null
}

export async function listWorkshopAccessRows(): Promise<WorkshopAccessRow[]> {
  const db = supabaseServer()
  const { data } = await db
    .from('mentoring_cohorts')
    .select('id, name, free_for_tier_ids, one_off_price_cents')
    .eq('container_type', CONTAINER)
    .eq('lifecycle', 'active')
    .order('name', { ascending: true })
  return ((data ?? []) as { id: string; name: string; free_for_tier_ids: string[] | null; one_off_price_cents: number | null }[]).map((c) => ({
    id: c.id,
    name: c.name,
    freeForTierIds: c.free_for_tier_ids ?? [],
    oneOffPriceCents: c.one_off_price_cents,
  }))
}

// ─── Membership tiers (Membership & access admin) ────────────────────────────

function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY
  return key ? new Stripe(key, { apiVersion: '2026-05-27.dahlia' }) : null
}

export interface CoachingTier {
  id: string
  name: string
  group: TierGroupKey | null
  isFree: boolean
  monthlyPriceCents: number | null
  /** Free coaching sessions included per membership year (0 = no coaching access). */
  freeSessions: number
  /** Days the allowance is valid before reset (365 = annual). */
  validityDays: number | null
}

/** The 9 buyable tiers with live Stripe pricing + coaching allowance config. */
export async function listCoachingTiers(): Promise<CoachingTier[]> {
  const db = supabaseServer()
  const [{ data: tierRows }, { data: entRows }] = await Promise.all([
    db.from('membership_tiers').select('id, name, is_free, stripe_price_id_monthly').in('name', ALL_TIER_NAMES),
    db.from('session_entitlements').select('tier_id, included_sessions, validity_days').eq('session_type', 'coaching'),
  ])
  type TR = { id: string; name: string; is_free: boolean; stripe_price_id_monthly: string | null }
  const ents = new Map(
    ((entRows ?? []) as { tier_id: string; included_sessions: number | null; validity_days: number | null }[]).map((e) => [e.tier_id, e]),
  )
  const stripe = stripeClient()

  const tiers = await Promise.all(
    ((tierRows ?? []) as TR[]).map(async (r) => {
      let monthlyPriceCents: number | null = null
      if (stripe && r.stripe_price_id_monthly) {
        try {
          const p = await stripe.prices.retrieve(r.stripe_price_id_monthly)
          monthlyPriceCents = p.unit_amount ?? null
        } catch {
          monthlyPriceCents = null
        }
      }
      const e = ents.get(r.id)
      return {
        id: r.id,
        name: r.name,
        group: tierGroupOf(r.name),
        isFree: r.is_free,
        monthlyPriceCents,
        freeSessions: e?.included_sessions ?? 0,
        validityDays: e?.validity_days ?? null,
      } satisfies CoachingTier
    }),
  )
  return tiers.sort((a, b) => ALL_TIER_NAMES.indexOf(a.name) - ALL_TIER_NAMES.indexOf(b.name))
}

/** Set a tier's free coaching allowance (upserts session_entitlements). */
export async function updateTierCoaching(tierId: string, freeSessions: number, validityDays = 365): Promise<void> {
  const db = supabaseServer()
  const n = Math.max(0, Math.floor(freeSessions))
  await db.from('session_entitlements').upsert(
    { tier_id: tierId, session_type: 'coaching', included_sessions: n, validity_days: validityDays },
    { onConflict: 'tier_id,session_type' },
  )
}

/** Called by the Stripe webhook after a successful one-off workshop payment. */
export async function enrollAfterPayment(memberId: string, workshopId: string, stripeSessionId: string): Promise<void> {
  const db = supabaseServer()
  // Minor-agreement backstop: never roster a minor into a live workshop without a signed
  // agreement on file. Report-only unless ACCESS_GATES_ENFORCE; logs for admin follow-up
  // (the member has paid, so a blocked enrolment needs manual resolution / refund).
  const gate = await reportEnrollmentGate({ id: memberId }, { kind: 'workshop', containerId: workshopId })
  if (accessGatesEnforced() && !gate.unlocked) {
    console.error('[coaching] enrolment blocked by minor-agreement gate (paid):', { memberId, workshopId })
    return
  }
  await db.from('session_credits').insert({
    member_id: memberId,
    session_type: 'coaching',
    status: 'consumed',
    source: 'purchase',
    consumed_cohort_id: workshopId,
    consumed_at: new Date().toISOString(),
    stripe_session_id: stripeSessionId,
  })
  await db.from('cohort_members').upsert(
    { cohort_id: workshopId, member_id: memberId, relationship: 'participant', status: 'active', accepted_at: new Date().toISOString() },
    { onConflict: 'cohort_id,member_id' },
  )
}
