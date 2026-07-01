// Member-initiated coaching requests (Academy "Request a coaching session" —
// handover Workstream C / Option A).
//
// This is the inbound half of coaching: a member submits an intake request, an
// admin matches a coach + resolves eligibility, then the member schedules a slot.
// It deliberately reuses the existing coaching machinery rather than adding a
// parallel one:
//   • the session itself → bookCoaching() (lib/sessions) → `sessions` + room + notify
//   • the entitlement    → the ledger (coaching_session kind): included/award draw
//                          an allocation, paid draws a purchased lot after Stripe
//   • notifications      → notify.ts (in-app + email)
// Only the request/queue record (coaching_requests) is net-new.

import { supabaseServer } from '@/lib/supabase'
import type { CommunityMember } from '@/lib/community'
import { bookCoaching, type BookResult } from '@/lib/sessions'
import { getCoachingAllowance } from '@/lib/coaching'
import { grantAdhocEntitlement } from '@/lib/entitlements'
import { notifyMember } from '@/lib/notify'
import { sendEmail } from '@/lib/email'

export type CoachingEligibility = 'included' | 'award' | 'paid'
export type CoachingRequestStatus = 'pending' | 'matched' | 'scheduled' | 'declined'

const LIVE_STATUSES: CoachingRequestStatus[] = ['pending', 'matched', 'scheduled']

const COACHING_TEAM_EMAIL =
  process.env.COACHING_TEAM_EMAIL ?? process.env.TRANSACTIONAL_REPLY_TO ?? 'david.shaw@insimeducation.com'
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

const fullName = (m: { first_name?: string | null; last_name?: string | null } | null) =>
  [m?.first_name, m?.last_name].filter(Boolean).join(' ') || null

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CoachingRequestInput {
  topic: string
  stage?: string | null
  focusArea?: string | null
  availability?: string[]
  note?: string | null
}

export interface CoachOption {
  id: string
  name: string | null
}

export interface CoachingRequest {
  id: string
  memberId: string
  memberName: string | null
  memberEmail: string | null
  topic: string
  stage: string | null
  focusArea: string | null
  availability: string[]
  note: string | null
  status: CoachingRequestStatus
  coachId: string | null
  coachName: string | null
  eligibility: CoachingEligibility | null
  workshopId: string | null
  sessionId: string | null
  declineReason: string | null
  createdAt: string
  matchedAt: string | null
  scheduledAt: string | null
  /** Set when status = scheduled — the booked session's time. */
  session: { start: string; end: string | null; joinUrl: string | null } | null
}

// Raw row shape from a select that joins member, coach and session.
interface RawRow {
  id: string
  member_id: string
  topic: string
  stage: string | null
  focus_area: string | null
  availability: string[] | null
  note: string | null
  status: CoachingRequestStatus
  coach_id: string | null
  eligibility: CoachingEligibility | null
  workshop_id: string | null
  session_id: string | null
  decline_reason: string | null
  created_at: string
  matched_at: string | null
  scheduled_at: string | null
  member?: { first_name: string | null; last_name: string | null; email: string | null } | { first_name: string | null; last_name: string | null; email: string | null }[] | null
  coach?: { first_name: string | null; last_name: string | null } | { first_name: string | null; last_name: string | null }[] | null
  session?: { scheduled_start: string; scheduled_end: string | null; join_url: string | null } | { scheduled_start: string; scheduled_end: string | null; join_url: string | null }[] | null
}

const ONE = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))

const SELECT =
  'id, member_id, topic, stage, focus_area, availability, note, status, coach_id, eligibility, workshop_id, session_id, decline_reason, created_at, matched_at, scheduled_at, ' +
  'member:members!coaching_requests_member_id_fkey(first_name, last_name, email), ' +
  'coach:members!coaching_requests_coach_id_fkey(first_name, last_name), ' +
  'session:sessions!coaching_requests_session_id_fkey(scheduled_start, scheduled_end, join_url)'

function mapRow(r: RawRow): CoachingRequest {
  const member = ONE(r.member)
  const coach = ONE(r.coach)
  const session = ONE(r.session)
  return {
    id: r.id,
    memberId: r.member_id,
    memberName: fullName(member),
    memberEmail: member?.email ?? null,
    topic: r.topic,
    stage: r.stage,
    focusArea: r.focus_area,
    availability: r.availability ?? [],
    note: r.note,
    status: r.status,
    coachId: r.coach_id,
    coachName: fullName(coach),
    eligibility: r.eligibility,
    workshopId: r.workshop_id,
    sessionId: r.session_id,
    declineReason: r.decline_reason,
    createdAt: r.created_at,
    matchedAt: r.matched_at,
    scheduledAt: r.scheduled_at,
    session: session ? { start: session.scheduled_start, end: session.scheduled_end, joinUrl: session.join_url } : null,
  }
}

// ─── Reads ───────────────────────────────────────────────────────────────────

/** The member's single live (non-declined) request, if any. */
export async function getActiveRequestForMember(memberId: string): Promise<CoachingRequest | null> {
  const db = supabaseServer()
  const { data } = await db
    .from('coaching_requests')
    .select(SELECT)
    .eq('member_id', memberId)
    .in('status', LIVE_STATUSES)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ? mapRow(data as unknown as RawRow) : null
}

export async function getRequestById(id: string): Promise<CoachingRequest | null> {
  const db = supabaseServer()
  const { data } = await db.from('coaching_requests').select(SELECT).eq('id', id).maybeSingle()
  return data ? mapRow(data as unknown as RawRow) : null
}

/** Admin queue. Pending first (oldest first — FIFO), then the rest newest-first. */
export async function listRequests(filter?: CoachingRequestStatus): Promise<CoachingRequest[]> {
  const db = supabaseServer()
  let q = db.from('coaching_requests').select(SELECT)
  if (filter) q = q.eq('status', filter)
  const { data } = await q.order('created_at', { ascending: true })
  const rows = (data ?? []).map((r) => mapRow(r as unknown as RawRow))
  const rank: Record<CoachingRequestStatus, number> = { pending: 0, matched: 1, scheduled: 2, declined: 3 }
  return rows.sort((a, b) => rank[a.status] - rank[b.status])
}

export async function countPendingRequests(): Promise<number> {
  const db = supabaseServer()
  const { count } = await db
    .from('coaching_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
  return count ?? 0
}

/** Members who can coach (session_hosts.can_coach), for the admin match picker. */
export async function listCoachOptions(): Promise<CoachOption[]> {
  const db = supabaseServer()
  const { data } = await db
    .from('session_hosts')
    .select('member_id, members(first_name, last_name)')
    .eq('can_coach', true)
  return (data ?? [])
    .map((r) => ({ id: r.member_id as string, name: fullName(ONE(r.members as never)) }))
    .filter((c) => c.id)
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
}

/** Suggest an eligibility for the admin: included if the member has free coaching
 *  allowance left this period, otherwise paid. (award is always a manual choice.) */
export async function suggestEligibility(member: CommunityMember): Promise<CoachingEligibility> {
  const allowance = await getCoachingAllowance(member)
  return allowance.remaining + allowance.extraCredits > 0 ? 'included' : 'paid'
}

// ─── Writes ──────────────────────────────────────────────────────────────────

export interface CreateResult {
  ok: boolean
  requestId?: string
  alreadyExists?: boolean
  error?: string
}

/** Create a pending request. One live request per member (the member is routed to
 *  their existing one rather than stacking duplicates). Alerts the coaching team
 *  and confirms receipt to the member. */
export async function createCoachingRequest(member: CommunityMember, input: CoachingRequestInput): Promise<CreateResult> {
  const topic = input.topic?.trim()
  if (!topic) return { ok: false, error: 'Please tell us what you would like coaching on.' }

  const existing = await getActiveRequestForMember(member.id)
  if (existing) return { ok: true, requestId: existing.id, alreadyExists: true }

  const db = supabaseServer()
  const { data, error } = await db
    .from('coaching_requests')
    .insert({
      member_id: member.id,
      topic,
      stage: input.stage ?? null,
      focus_area: input.focusArea ?? null,
      availability: input.availability ?? [],
      note: input.note ?? null,
      status: 'pending',
    })
    .select('id')
    .single()

  if (error || !data) {
    // Unique partial index → a concurrent live request already exists.
    const again = await getActiveRequestForMember(member.id)
    if (again) return { ok: true, requestId: again.id, alreadyExists: true }
    console.error('[coaching-requests] create error:', error)
    return { ok: false, error: 'Could not submit your request. Please try again.' }
  }

  const memberName = fullName(member) ?? member.email ?? 'A member'

  // Confirm receipt to the member (in-app + email).
  await notifyMember(member.id, {
    type: 'announcement',
    body: 'Your coaching request was received — we’ll match you with a coach and email you within two working days.',
    referenceType: 'coaching_request',
    referenceId: data.id,
    email: {
      subject: 'We received your coaching request',
      html: `<p>Hi ${member.first_name ?? 'there'},</p><p>Thanks for requesting a coaching session. Our team will match you with a coach and email you within two working days.</p><p>You can track your request any time at <a href="${SITE_URL}/community/coaching">your coaching page</a>.</p>`,
      text: `Hi ${member.first_name ?? 'there'},\n\nThanks for requesting a coaching session. Our team will match you with a coach and email you within two working days.\n\nTrack your request: ${SITE_URL}/community/coaching`,
    },
  })

  // Alert the coaching team (best-effort — never fail the request on email).
  try {
    await sendEmail({
      to: COACHING_TEAM_EMAIL,
      subject: `New coaching request — ${memberName}`,
      html: `<p>A new coaching request needs matching.</p><ul><li><strong>Member:</strong> ${memberName} (${member.email ?? 'no email'})</li><li><strong>Topic:</strong> ${topic}</li><li><strong>Stage:</strong> ${input.stage ?? '—'}</li><li><strong>Focus:</strong> ${input.focusArea ?? '—'}</li><li><strong>Availability:</strong> ${(input.availability ?? []).join(', ') || '—'}</li></ul><p><a href="${SITE_URL}/admin/academy/coaching/requests">Open the match queue</a></p>`,
      text: `New coaching request needs matching.\nMember: ${memberName} (${member.email ?? 'no email'})\nTopic: ${topic}\nQueue: ${SITE_URL}/admin/academy/coaching/requests`,
    })
  } catch (err) {
    console.error('[coaching-requests] team alert email failed:', err)
  }

  return { ok: true, requestId: data.id }
}

/** Admin: match a coach + resolve eligibility. For award eligibility we grant a
 *  free coaching_session lot so the member's booking draws it at no charge. */
export async function matchRequest(
  requestId: string,
  coachId: string,
  eligibility: CoachingEligibility,
): Promise<{ ok: boolean; error?: string }> {
  const db = supabaseServer()
  const req = await getRequestById(requestId)
  if (!req) return { ok: false, error: 'Request not found' }
  if (req.status !== 'pending') return { ok: false, error: 'This request has already been handled' }

  if (eligibility === 'award') {
    await grantAdhocEntitlement(req.memberId, 'coaching_session', 1, `coaching_request:${requestId}`)
  }

  const { error } = await db
    .from('coaching_requests')
    .update({ coach_id: coachId, eligibility, status: 'matched', matched_at: new Date().toISOString() })
    .eq('id', requestId)
    .eq('status', 'pending')
  if (error) {
    console.error('[coaching-requests] match error:', error)
    return { ok: false, error: 'Could not match this request' }
  }

  const { data: coach } = await db.from('members').select('first_name, last_name').eq('id', coachId).maybeSingle()
  const coachName = fullName(coach) ?? 'a Stellr coach'

  await notifyMember(req.memberId, {
    type: 'announcement',
    body: `You've been matched with ${coachName} for coaching. Book your session now.`,
    referenceType: 'coaching_request',
    referenceId: requestId,
    email: {
      subject: 'Your coach is ready — book your session',
      html: `<p>Good news — you've been matched with <strong>${coachName}</strong>.</p><p><a href="${SITE_URL}/community/coaching/request/${requestId}/book">Book your session</a></p>`,
      text: `You've been matched with ${coachName}. Book your session: ${SITE_URL}/community/coaching/request/${requestId}/book`,
    },
  })
  await notifyMember(coachId, {
    type: 'announcement',
    body: `You've been matched with a new coachee${req.memberName ? ` (${req.memberName})` : ''} on "${req.topic}".`,
    referenceType: 'coaching_request',
    referenceId: requestId,
  })

  return { ok: true }
}

export async function declineRequest(
  requestId: string,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  const db = supabaseServer()
  const req = await getRequestById(requestId)
  if (!req) return { ok: false, error: 'Request not found' }
  if (req.status === 'scheduled') return { ok: false, error: 'A scheduled request cannot be declined' }

  const { error } = await db
    .from('coaching_requests')
    .update({ status: 'declined', decline_reason: reason || null, declined_at: new Date().toISOString() })
    .eq('id', requestId)
  if (error) return { ok: false, error: 'Could not decline this request' }

  await notifyMember(req.memberId, {
    type: 'announcement',
    body: `Your coaching request couldn't be matched right now${reason ? `: ${reason}` : '.'}`,
    referenceType: 'coaching_request',
    referenceId: requestId,
    email: {
      subject: 'Update on your coaching request',
      html: `<p>Thanks for your patience. We weren't able to match your coaching request right now.${reason ? `</p><p>${reason}` : ''}</p><p>You can explore membership tiers or earn coaching by competing at <a href="${SITE_URL}/academy">the Academy</a>.</p>`,
      text: `We weren't able to match your coaching request right now.${reason ? ` ${reason}` : ''}\n\nExplore options: ${SITE_URL}/academy`,
    },
  })
  return { ok: true }
}

/** Book the matched coaching session at `startIso`, drawing the member's
 *  entitlement (included/award allocation, or a purchased lot after payment) and
 *  moving the request to scheduled. Used by the member book route (free paths) and
 *  by the Stripe webhook (paid path, after the purchased lot is granted).
 *  Idempotent: a request already scheduled is returned as success. */
export async function scheduleFromRequest(
  requestId: string,
  startIso: string,
): Promise<BookResult> {
  const db = supabaseServer()
  const req = await getRequestById(requestId)
  if (!req) return { ok: false, error: 'Request not found' }
  if (req.status === 'scheduled' && req.sessionId) return { ok: true, sessionId: req.sessionId }
  if (req.status !== 'matched') return { ok: false, error: 'This request is not ready to book' }
  if (!req.coachId) return { ok: false, error: 'No coach assigned yet' }

  // bookCoaching only reads member.id; build the minimal member it needs.
  const member = {
    id: req.memberId,
    first_name: null,
    last_name: null,
    email: req.memberEmail,
    isAdmin: false,
    hasPaidTier: false,
    activeTierName: null,
    activeTierIds: [],
    event_role: null,
  } satisfies CommunityMember

  const result = await bookCoaching(member, req.coachId, startIso, { title: `Coaching — ${req.topic}` })
  if (!result.ok || !result.sessionId) return result

  await db
    .from('coaching_requests')
    .update({ status: 'scheduled', session_id: result.sessionId, scheduled_at: new Date().toISOString() })
    .eq('id', requestId)

  return result
}
