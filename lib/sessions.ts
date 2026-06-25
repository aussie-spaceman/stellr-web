import { supabaseServer } from '@/lib/supabase'
import { type CommunityMember, getCurrentMember, memberCanAccess } from '@/lib/community'
import { containerAccessPersists } from '@/lib/containers'
import { ensureCoachingContainer } from '@/lib/container-sync'
import { getVideoProvider } from '@/lib/video-provider'
import { notifyMember, notifyMembers } from '@/lib/notify'
import { sendEmail } from '@/lib/email'
import { buildIcsAttachment } from '@/lib/ics'
import { listModules } from '@/lib/training'
import { logActivity } from '@/lib/activity-log'

// Core logic for Coaching (1:1, FR-COM-12) and Mentoring (group, FR-COM-11).
// Coaching: sessions.member_id is the coachee. Mentoring: sessions.cohort_id is
// the group; cohort members are fanned out into session_participants at booking.

export type SessionType = 'coaching' | 'mentoring'

// ─── Host capabilities ──────────────────────────────────────────────────────

export interface HostCaps {
  canCoach: boolean
  canMentor: boolean
}

export async function getHostCaps(memberId: string): Promise<HostCaps> {
  const db = supabaseServer()
  const { data } = await db
    .from('session_hosts')
    .select('can_coach, can_mentor')
    .eq('member_id', memberId)
    .maybeSingle()
  return { canCoach: data?.can_coach ?? false, canMentor: data?.can_mentor ?? false }
}

// ─── Entitlements (how many sessions a member's tier includes) ───────────────

export interface Entitlement {
  included: number
  used: number
  remaining: number
  expiresAt: string | null
  /** Purchased extra sessions available to book on top of the included ones. */
  extraCredits: number
}

export async function getEntitlement(
  member: CommunityMember,
  type: SessionType
): Promise<Entitlement> {
  const db = supabaseServer()

  // Purchased extra credits are available regardless of tier.
  const { count: creditCount } = await db
    .from('session_credits')
    .select('id', { count: 'exact', head: true })
    .eq('member_id', member.id)
    .eq('session_type', type)
    .eq('status', 'available')
  const extraCredits = creditCount ?? 0

  if (member.activeTierIds.length === 0) {
    return { included: 0, used: 0, remaining: 0, expiresAt: null, extraCredits }
  }

  const { data: ents } = await db
    .from('session_entitlements')
    .select('tier_id, included_sessions, validity_days')
    .eq('session_type', type)
    .in('tier_id', member.activeTierIds)

  // Take the most generous tier the member holds.
  const best = (ents ?? []).reduce<{ included: number; validity: number | null }>(
    (acc, r) =>
      (r.included_sessions ?? 0) > acc.included
        ? { included: r.included_sessions ?? 0, validity: r.validity_days ?? null }
        : acc,
    { included: 0, validity: null }
  )

  // Sessions consumed = non-paid-extra sessions the member attends, still booked.
  const { data: attended } = await db
    .from('session_participants')
    .select('sessions!inner(id, session_type, status, is_paid_extra)')
    .eq('member_id', member.id)

  type Row = { sessions: { session_type: string; status: string; is_paid_extra: boolean } | { session_type: string; status: string; is_paid_extra: boolean }[] }
  const used = ((attended ?? []) as unknown as Row[])
    .map((r) => (Array.isArray(r.sessions) ? r.sessions[0] : r.sessions))
    .filter(
      (s) =>
        s &&
        s.session_type === type &&
        !s.is_paid_extra &&
        (s.status === 'scheduled' || s.status === 'completed')
    ).length

  // Expiry: earliest active membership start + validity window.
  let expiresAt: string | null = null
  if (best.validity != null) {
    const { data: ms } = await db
      .from('member_memberships')
      .select('started_at')
      .eq('member_id', member.id)
      .eq('renewal_status', 'active')
      .order('started_at', { ascending: true })
      .limit(1)
    const start = ms?.[0]?.started_at
    if (start) {
      const d = new Date(start)
      d.setDate(d.getDate() + best.validity)
      expiresAt = d.toISOString()
    }
  }

  return {
    included: best.included,
    used,
    remaining: Math.max(best.included - used, 0),
    expiresAt,
    extraCredits,
  }
}

// ─── Availability ────────────────────────────────────────────────────────────

export interface AvailabilityWindow {
  id: string
  weekday: number
  start_minute: number
  end_minute: number
  session_type: 'coaching' | 'mentoring' | 'both'
}

export async function getAvailability(hostId: string): Promise<AvailabilityWindow[]> {
  const db = supabaseServer()
  const { data } = await db
    .from('host_availability')
    .select('id, weekday, start_minute, end_minute, session_type')
    .eq('host_member_id', hostId)
    .order('weekday')
    .order('start_minute')
  return (data ?? []) as AvailabilityWindow[]
}

// ─── Booking ─────────────────────────────────────────────────────────────────

export interface BookResult {
  ok: boolean
  sessionId?: string
  error?: string
  /** True when booking failed only because the member is out of sessions. */
  needsPurchase?: boolean
}

/**
 * Book a coaching session for `member` with coach `hostId` at `start`.
 * Validates host capability + remaining entitlement (unless paid extra), then
 * provisions the video room, records participants, and notifies both parties.
 */
export async function bookCoaching(
  member: CommunityMember,
  hostId: string,
  startIso: string,
  opts: { durationMin?: number; isPaidExtra?: boolean; title?: string } = {}
): Promise<BookResult> {
  const db = supabaseServer()

  const caps = await getHostCaps(hostId)
  if (!caps.canCoach) return { ok: false, error: 'Selected coach is not available.' }

  // Decide whether this booking draws on an included session or a paid credit.
  const ent = await getEntitlement(member, 'coaching')
  let usePaidExtra = false
  if (ent.remaining <= 0) {
    if (ent.extraCredits <= 0) {
      return {
        ok: false,
        needsPurchase: true,
        error: 'No coaching sessions remaining. Purchase an extra session to continue.',
      }
    }
    usePaidExtra = true
  }

  const start = new Date(startIso)
  const end = new Date(start.getTime() + (opts.durationMin ?? 30) * 60_000)

  const { data: session, error } = await db
    .from('sessions')
    .insert({
      session_type: 'coaching',
      host_member_id: hostId,
      member_id: member.id,
      title: opts.title ?? 'Coaching session',
      scheduled_start: start.toISOString(),
      scheduled_end: end.toISOString(),
      status: 'scheduled',
      is_paid_extra: usePaidExtra,
      created_by: member.id,
    })
    .select('id')
    .single()

  if (error || !session) {
    console.error('[sessions] book coaching error:', error)
    return { ok: false, error: 'Could not book session.' }
  }

  // Converge onto the container model: ensure a coaching workshop container +
  // roster for this coachee/coach pair so it surfaces in the member access panel
  // and admin tooling. Non-fatal; the live access path is unchanged.
  await ensureCoachingContainer(db, member.id, hostId)

  // Claim a paid credit atomically when not covered by the included allowance.
  if (usePaidExtra) {
    await db.rpc('consume_session_credit', {
      p_member_id: member.id,
      p_session_type: 'coaching',
      p_session_id: session.id,
    })
  }

  await provisionRoom(session.id, opts.title ?? 'Coaching session')
  await db.from('session_participants').insert({ session_id: session.id, member_id: member.id })
  await sendSessionInvites(session.id)

  await notifyMember(hostId, {
    type: 'session',
    body: `New coaching session booked for ${start.toLocaleString()}.`,
    referenceType: 'session',
    referenceId: session.id,
    actorMemberId: member.id,
  })
  await notifyMember(member.id, {
    type: 'session',
    body: `Your coaching session is booked for ${start.toLocaleString()}.`,
    referenceType: 'session',
    referenceId: session.id,
  })

  return { ok: true, sessionId: session.id }
}

/**
 * Schedule a mentoring session for a cohort. Fans the cohort members out into
 * session_participants and notifies the whole group + mentor.
 */
export async function scheduleMentoring(
  hostId: string,
  cohortId: string,
  startIso: string,
  opts: { durationMin?: number; title?: string } = {}
): Promise<BookResult> {
  const db = supabaseServer()
  const caps = await getHostCaps(hostId)
  if (!caps.canMentor) return { ok: false, error: 'Not authorised to mentor.' }

  const start = new Date(startIso)
  const end = new Date(start.getTime() + (opts.durationMin ?? 60) * 60_000)

  const { data: session, error } = await db
    .from('sessions')
    .insert({
      session_type: 'mentoring',
      host_member_id: hostId,
      cohort_id: cohortId,
      title: opts.title ?? 'Mentoring session',
      scheduled_start: start.toISOString(),
      scheduled_end: end.toISOString(),
      status: 'scheduled',
      created_by: hostId,
    })
    .select('id')
    .single()

  if (error || !session) {
    console.error('[sessions] schedule mentoring error:', error)
    return { ok: false, error: 'Could not schedule session.' }
  }

  await provisionRoom(session.id, opts.title ?? 'Mentoring session')

  const { data: cm } = await db
    .from('cohort_members')
    .select('member_id')
    .eq('cohort_id', cohortId)
    .eq('status', 'active')
  const memberIds = (cm ?? []).map((r) => r.member_id as string)
  if (memberIds.length > 0) {
    await db
      .from('session_participants')
      .insert(memberIds.map((member_id) => ({ session_id: session.id, member_id })))
    await notifyMembers(memberIds, {
      type: 'session',
      body: `New mentoring session scheduled for ${start.toLocaleString()}.`,
      referenceType: 'session',
      referenceId: session.id,
      actorMemberId: hostId,
    })
  }
  await sendSessionInvites(session.id)

  return { ok: true, sessionId: session.id }
}

async function provisionRoom(sessionId: string, title: string): Promise<void> {
  const db = supabaseServer()
  const provider = getVideoProvider()
  const room = await provider.createRoom({ sessionId, title })
  await db
    .from('sessions')
    .update({ provider: room.provider, provider_room: room.room, join_url: room.joinUrl })
    .eq('id', sessionId)
}

/**
 * Email every participant + the host an .ics calendar invite for a session
 * (FR-COM-11/12). Best-effort: failures are logged, never thrown. Works across
 * Google/Outlook/Apple without per-user calendar OAuth.
 */
async function sendSessionInvites(sessionId: string): Promise<void> {
  const db = supabaseServer()
  const { data: s } = await db
    .from('sessions')
    .select('id, title, scheduled_start, scheduled_end, join_url, host_member_id')
    .eq('id', sessionId)
    .maybeSingle()
  if (!s) return

  const { data: parts } = await db
    .from('session_participants')
    .select('member_id')
    .eq('session_id', sessionId)
  const recipientIds = new Set<string>((parts ?? []).map((p) => p.member_id as string))
  if (s.host_member_id) recipientIds.add(s.host_member_id as string)
  if (recipientIds.size === 0) return

  const { data: members } = await db
    .from('members')
    .select('id, email, first_name')
    .in('id', [...recipientIds])

  const start = new Date(s.scheduled_start)
  const end = s.scheduled_end ? new Date(s.scheduled_end) : new Date(start.getTime() + 30 * 60_000)
  const title = s.title ?? 'Stellr session'
  const attendeeEmails = (members ?? []).map((m) => m.email).filter((e): e is string => !!e)

  for (const m of members ?? []) {
    if (!m.email) continue
    const ics = buildIcsAttachment({
      uid: `${sessionId}@stellreducation.org`,
      title,
      start,
      end,
      url: s.join_url ?? undefined,
      organizerEmail: 'david.shaw@insimeducation.com',
      attendeeEmails,
    })
    try {
      await sendEmail({
        to: m.email,
        subject: `Calendar invite: ${title}`,
        html: `<p>Hi ${m.first_name ?? 'there'},</p><p>Your ${title} is scheduled for <strong>${start.toLocaleString()}</strong>.</p>${
          s.join_url ? `<p><a href="${s.join_url}">Join link</a></p>` : ''
        }<p>The attached invite will add it to your calendar.</p>`,
        text: `Your ${title} is scheduled for ${start.toLocaleString()}.${s.join_url ? ` Join: ${s.join_url}` : ''}`,
        attachments: [ics],
      })
    } catch (e) {
      console.error('[sessions] invite email failed:', e)
    }
  }
}

// ─── Host responses (accept / decline / reschedule / complete) ───────────────

export async function hostRespond(
  sessionId: string,
  hostId: string,
  action: 'declined' | 'cancelled' | 'completed'
): Promise<boolean> {
  const db = supabaseServer()
  const { data: session } = await db
    .from('sessions')
    .select('id, host_member_id, member_id, cohort_id, scheduled_start')
    .eq('id', sessionId)
    .maybeSingle()
  if (!session || session.host_member_id !== hostId) return false

  const { error } = await db
    .from('sessions')
    .update({ status: action, updated_at: new Date().toISOString() })
    .eq('id', sessionId)
  if (error) return false

  // Notify affected participants.
  const { data: parts } = await db
    .from('session_participants')
    .select('member_id')
    .eq('session_id', sessionId)
  await notifyMembers((parts ?? []).map((p) => p.member_id as string), {
    type: 'session',
    body: `A session has been ${action}.`,
    referenceType: 'session',
    referenceId: sessionId,
    actorMemberId: hostId,
  })
  return true
}

export async function setHostNotes(sessionId: string, hostId: string, notes: string): Promise<boolean> {
  const db = supabaseServer()
  const { data: s } = await db.from('sessions').select('host_member_id').eq('id', sessionId).maybeSingle()
  if (!s || s.host_member_id !== hostId) return false
  const { error } = await db
    .from('sessions')
    .update({ host_notes: notes, updated_at: new Date().toISOString() })
    .eq('id', sessionId)
  return !error
}

// ─── Actions (host sets, member checks off) ──────────────────────────────────

export interface ActionInput {
  title: string
  dueDate?: string | null
  trainingModuleId?: string | null
}

export async function addActions(
  sessionId: string,
  hostId: string,
  memberId: string,
  actions: (string | ActionInput)[]
): Promise<boolean> {
  const db = supabaseServer()
  const { data: s } = await db.from('sessions').select('host_member_id').eq('id', sessionId).maybeSingle()
  if (!s || s.host_member_id !== hostId) return false
  if (actions.length === 0) return true
  const { error } = await db.from('session_actions').insert(
    actions.map((a, i) => {
      const obj = typeof a === 'string' ? { title: a } : a
      return {
        session_id: sessionId,
        member_id: memberId,
        title: obj.title,
        created_by: hostId,
        display_order: i,
        due_date: obj.dueDate ?? null,
        training_module_id: obj.trainingModuleId ?? null,
      }
    })
  )
  if (!error) {
    await notifyMember(memberId, {
      type: 'action',
      body: 'New actions were set for you after your session.',
      referenceType: 'session',
      referenceId: sessionId,
      actorMemberId: hostId,
    })
  }
  return !error
}

export async function toggleAction(actionId: string, memberId: string, done: boolean): Promise<boolean> {
  const db = supabaseServer()
  const { data: a } = await db.from('session_actions').select('member_id').eq('id', actionId).maybeSingle()
  if (!a || a.member_id !== memberId) return false
  const { error } = await db
    .from('session_actions')
    .update({ is_done: done, completed_at: done ? new Date().toISOString() : null })
    .eq('id', actionId)
  return !error
}

export interface MemberAction {
  id: string
  title: string
  is_done: boolean
  session_id: string
  due_date: string | null
  training_module_id: string | null
  module_title: string | null
}

export async function getMemberActions(memberId: string): Promise<MemberAction[]> {
  const db = supabaseServer()
  const { data } = await db
    .from('session_actions')
    .select('id, title, is_done, session_id, due_date, training_module_id')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false })
  if (!data || data.length === 0) return []
  interface RawAction { id: string; title: string; is_done: boolean; session_id: string; due_date: string | null; training_module_id: string | null }
  const rows = data as RawAction[]
  const moduleIds = [...new Set(rows.map((r) => r.training_module_id).filter(Boolean))] as string[]
  let moduleMap: Record<string, string> = {}
  if (moduleIds.length > 0) {
    const { data: mods } = await db.from('training_modules').select('id, title').in('id', moduleIds)
    moduleMap = Object.fromEntries((mods ?? []).map((m) => [m.id, m.title as string]))
  }
  return rows.map((r) => ({
    ...r,
    module_title: r.training_module_id ? moduleMap[r.training_module_id] ?? null : null,
  }))
}

export async function autoCompleteTrainingAction(memberId: string, moduleId: string): Promise<void> {
  const db = supabaseServer()
  await db
    .from('session_actions')
    .update({ is_done: true, completed_at: new Date().toISOString() })
    .eq('member_id', memberId)
    .eq('training_module_id', moduleId)
    .eq('is_done', false)
}

// ─── Sessions listing ────────────────────────────────────────────────────────

export interface SessionView {
  id: string
  session_type: SessionType
  title: string | null
  scheduled_start: string
  scheduled_end: string | null
  status: string
  join_url: string | null
  recording_status: string
  recording_path: string | null
  host_member_id: string | null
  member_id: string | null
  host_notes: string | null
}

const SESSION_COLS =
  'id, session_type, title, scheduled_start, scheduled_end, status, join_url, recording_status, recording_path, host_member_id, member_id, host_notes'

/** Sessions the member attends (coaching coachee or cohort member). */
export async function listMemberSessions(memberId: string): Promise<SessionView[]> {
  const db = supabaseServer()
  const { data } = await db
    .from('session_participants')
    .select(`sessions!inner(${SESSION_COLS})`)
    .eq('member_id', memberId)
  type Row = { sessions: SessionView | SessionView[] }
  return ((data ?? []) as unknown as Row[])
    .map((r) => (Array.isArray(r.sessions) ? r.sessions[0] : r.sessions))
    .filter((s): s is SessionView => !!s)
    .sort((a, b) => new Date(b.scheduled_start).getTime() - new Date(a.scheduled_start).getTime())
}

/** Sessions the member hosts (coach/mentor). */
export async function listHostSessions(hostId: string): Promise<SessionView[]> {
  const db = supabaseServer()
  const { data } = await db
    .from('sessions')
    .select(SESSION_COLS)
    .eq('host_member_id', hostId)
    .order('scheduled_start', { ascending: false })
  return (data ?? []) as SessionView[]
}

// ─── Chat (persistent, outlives sessions) ────────────────────────────────────

export interface ChatMessage {
  id: string
  body: string
  author_member_id: string | null
  author_name: string
  created_at: string
  flagged: boolean
}

export async function getCohortChannel(cohortId: string): Promise<string> {
  const db = supabaseServer()
  const { data: existing } = await db
    .from('chat_channels')
    .select('id')
    .eq('kind', 'cohort')
    .eq('cohort_id', cohortId)
    .maybeSingle()
  if (existing) return existing.id
  const { data } = await db
    .from('chat_channels')
    .insert({ kind: 'cohort', cohort_id: cohortId })
    .select('id')
    .single()
  return data!.id
}

export async function getCoachingChannel(coacheeId: string, coachId: string): Promise<string> {
  const db = supabaseServer()
  const { data: existing } = await db
    .from('chat_channels')
    .select('id')
    .eq('kind', 'coaching')
    .eq('member_id', coacheeId)
    .eq('host_member_id', coachId)
    .maybeSingle()
  if (existing) return existing.id
  const { data } = await db
    .from('chat_channels')
    .insert({ kind: 'coaching', member_id: coacheeId, host_member_id: coachId })
    .select('id')
    .single()
  return data!.id
}

export async function listMessages(channelId: string): Promise<ChatMessage[]> {
  const db = supabaseServer()
  const { data } = await db
    .from('chat_messages')
    .select('id, body, author_member_id, created_at, flagged_at, members:author_member_id(first_name, last_name)')
    .eq('channel_id', channelId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(500)
  type Rel = { first_name: string | null; last_name: string | null }
  return (data ?? []).map((m) => {
    const rel = (m as { members: Rel | Rel[] | null }).members
    const author = Array.isArray(rel) ? rel[0] : rel
    return {
      id: m.id as string,
      body: m.body as string,
      author_member_id: (m.author_member_id as string | null) ?? null,
      author_name: [author?.first_name, author?.last_name].filter(Boolean).join(' ') || 'Member',
      created_at: m.created_at as string,
      flagged: !!m.flagged_at,
    }
  })
}

export async function postMessage(channelId: string, authorId: string, body: string): Promise<boolean> {
  if (!body.trim()) return false
  const db = supabaseServer()
  const { error } = await db
    .from('chat_messages')
    .insert({ channel_id: channelId, author_member_id: authorId, body: body.trim() })
  return !error
}

/** Get-or-create the single discussion channel for a community space (Phase 4). */
export async function getSpaceChannel(spaceId: string): Promise<string> {
  const db = supabaseServer()
  const { data: existing } = await db
    .from('chat_channels')
    .select('id')
    .eq('kind', 'space')
    .eq('space_id', spaceId)
    .maybeSingle()
  if (existing) return existing.id
  const { data } = await db
    .from('chat_channels')
    .insert({ kind: 'space', space_id: spaceId })
    .select('id')
    .single()
  return data!.id
}

/** Whether the member may read/write a channel (cohort member, coaching pair, or space viewer). */
export async function canAccessChannel(channelId: string, memberId: string): Promise<boolean> {
  const db = supabaseServer()
  const { data: ch } = await db
    .from('chat_channels')
    .select('kind, cohort_id, member_id, host_member_id, space_id')
    .eq('id', channelId)
    .maybeSingle()
  if (!ch) return false
  if (ch.kind === 'coaching') return ch.member_id === memberId || ch.host_member_id === memberId
  if (ch.kind === 'space') {
    // Space chat mirrors space-view access (tier + entitlement gated). Resolved
    // for the current member, who must be the one asking.
    if (!ch.space_id) return false
    const me = await getCurrentMember()
    if (!me || me.id !== memberId) return false
    const { data: space } = await db
      .from('community_spaces')
      .select('min_tier_rank')
      .eq('id', ch.space_id)
      .maybeSingle()
    return memberCanAccess(me, 'space', ch.space_id, (space?.min_tier_rank as number) ?? 0, 'view')
  }
  // cohort: member must belong to the cohort (or be its mentor) AND the container's
  // content must still persist (an archived cohort re-gates unless kept open — D1).
  if (!ch.cohort_id) return false
  const { data: cm } = await db
    .from('cohort_members')
    .select('member_id')
    .eq('cohort_id', ch.cohort_id)
    .eq('member_id', memberId)
    .eq('status', 'active')
    .maybeSingle()
  let onRoster = !!cm
  if (!onRoster) {
    const { data: cohort } = await db
      .from('mentoring_cohorts')
      .select('mentor_member_id')
      .eq('id', ch.cohort_id)
      .maybeSingle()
    onRoster = cohort?.mentor_member_id === memberId
  }
  if (!onRoster) return false
  return containerAccessPersists(ch.cohort_id)
}

// ─── Cohort-as-Space (PRD §11) ───────────────────────────────────────────────
// A Mentoring Cohort is a private Space: group chat + scheduled sessions (with
// calendar links) + referenced training material, accessible to roster + mentor.

export interface CohortSpace {
  id: string
  name: string
  lifecycle: 'active' | 'archived'
  isMentor: boolean
  /** False when an archived cohort has re-gated its content for this member (D1). */
  accessible: boolean
}

/**
 * Resolve a cohort for a member who is on its roster or is its mentor. Returns
 * null when the member has no relationship to the cohort (caller should 404).
 */
export async function getCohortSpace(memberId: string, cohortId: string): Promise<CohortSpace | null> {
  const db = supabaseServer()
  const { data: c } = await db
    .from('mentoring_cohorts')
    .select('id, name, lifecycle, mentor_member_id')
    .eq('id', cohortId)
    .eq('container_type', 'mentoring')
    .maybeSingle()
  if (!c) return null

  const isMentor = c.mentor_member_id === memberId
  let onRoster = isMentor
  if (!onRoster) {
    const { data: cm } = await db
      .from('cohort_members')
      .select('member_id')
      .eq('cohort_id', cohortId)
      .eq('member_id', memberId)
      .eq('status', 'active')
      .maybeSingle()
    onRoster = !!cm
  }
  if (!onRoster) return null

  return {
    id: c.id as string,
    name: c.name as string,
    lifecycle: ((c.lifecycle as string) ?? 'active') as 'active' | 'archived',
    isMentor,
    accessible: await containerAccessPersists(cohortId),
  }
}

/** All sessions belonging to a cohort (newest first), for the cohort space view. */
export async function listCohortSessions(cohortId: string): Promise<SessionView[]> {
  const db = supabaseServer()
  const { data } = await db
    .from('sessions')
    .select(SESSION_COLS)
    .eq('cohort_id', cohortId)
    .order('scheduled_start', { ascending: false })
  return (data ?? []) as SessionView[]
}

export interface CohortTraining {
  moduleId: string
  title: string
  isMandatory: boolean
  dueAt: string | null
  itemCount: number
  completedCount: number
  canAccess: boolean
  displayOrder: number
}

/**
 * Training modules referenced by a cohort (PRD §11), resolved with the member's
 * own completion + entitlement state so the space can show mandatory/optional,
 * deadlines, and "x of y complete".
 */
export async function listCohortTraining(member: CommunityMember, cohortId: string): Promise<CohortTraining[]> {
  const db = supabaseServer()
  const { data: links } = await db
    .from('cohort_training_links')
    .select('module_id, is_mandatory, due_at, display_order')
    .eq('cohort_id', cohortId)
  if (!links || links.length === 0) return []

  const byModule = new Map(links.map((l) => [l.module_id as string, l]))
  const modules = await listModules(member)
  return modules
    .filter((m) => byModule.has(m.id))
    .map((m) => {
      const l = byModule.get(m.id)!
      return {
        moduleId: m.id,
        title: m.title,
        isMandatory: !!l.is_mandatory,
        dueAt: (l.due_at as string | null) ?? null,
        itemCount: m.itemCount,
        completedCount: m.completedCount,
        canAccess: m.canAccess,
        displayOrder: (l.display_order as number) ?? 0,
      }
    })
    .sort((a, b) => a.displayOrder - b.displayOrder)
}

/** Cohorts a member belongs to (as participant) or mentors, for the index list. */
export interface CohortCard {
  id: string
  name: string
  lifecycle: 'active' | 'archived'
  isMentor: boolean
  memberCount: number
}

export async function listMemberCohorts(memberId: string): Promise<CohortCard[]> {
  const db = supabaseServer()
  const [{ data: asMember }, { data: asMentor }] = await Promise.all([
    db
      .from('cohort_members')
      .select('mentoring_cohorts!inner(id, name, lifecycle, mentor_member_id, container_type, cohort_members(member_id))')
      .eq('member_id', memberId)
      .eq('status', 'active')
      .eq('mentoring_cohorts.container_type', 'mentoring'),
    db
      .from('mentoring_cohorts')
      .select('id, name, lifecycle, mentor_member_id, cohort_members(member_id)')
      .eq('mentor_member_id', memberId)
      .eq('container_type', 'mentoring'),
  ])

  type CohortRow = {
    id: string
    name: string
    lifecycle: string | null
    mentor_member_id: string | null
    cohort_members: { member_id: string }[] | null
  }
  const rows: CohortRow[] = []
  for (const r of asMember ?? []) {
    const c = (Array.isArray(r.mentoring_cohorts) ? r.mentoring_cohorts[0] : r.mentoring_cohorts) as CohortRow | null
    if (c) rows.push(c)
  }
  for (const c of (asMentor ?? []) as unknown as CohortRow[]) rows.push(c)

  const byId = new Map<string, CohortCard>()
  for (const c of rows) {
    if (byId.has(c.id)) continue
    byId.set(c.id, {
      id: c.id,
      name: c.name,
      lifecycle: ((c.lifecycle as string) ?? 'active') as 'active' | 'archived',
      isMentor: c.mentor_member_id === memberId,
      memberCount: Array.isArray(c.cohort_members) ? c.cohort_members.length : 0,
    })
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// ─── Cohort invites (PRD §11 — "accept an invite into a Cohort") ──────────────

/**
 * Invite members to a cohort. New members are added as 'invited' (they gain
 * access only after accepting); existing rows are left untouched so an already
 * active member is never downgraded. Returns the number actually pending.
 */
export async function inviteMembersToCohort(cohortId: string, memberIds: string[]): Promise<number> {
  const ids = [...new Set(memberIds)].filter(Boolean)
  if (ids.length === 0) return 0
  const db = supabaseServer()
  const now = new Date().toISOString()

  // Insert only new rows; ignoreDuplicates protects existing active members.
  await db
    .from('cohort_members')
    .upsert(
      ids.map((member_id) => ({ cohort_id: cohortId, member_id, status: 'invited', invited_at: now })),
      { onConflict: 'cohort_id,member_id', ignoreDuplicates: true },
    )

  const { data: pending } = await db
    .from('cohort_members')
    .select('member_id')
    .eq('cohort_id', cohortId)
    .eq('status', 'invited')
    .in('member_id', ids)
  const pendingIds = (pending ?? []).map((r) => r.member_id as string)
  if (pendingIds.length) {
    const { data: cohort } = await db.from('mentoring_cohorts').select('name').eq('id', cohortId).maybeSingle()
    const name = (cohort?.name as string) ?? 'a mentoring cohort'
    const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'
    const inviteUrl = `${base}/community/mentoring/${cohortId}/invite`
    await notifyMembers(pendingIds, {
      type: 'announcement',
      body: `You've been invited to join the ${name} mentoring cohort.`,
      // reference_type 'cohort_invite' makes the notification bell render Accept/Decline.
      referenceType: 'cohort_invite',
      referenceId: cohortId,
      email: {
        subject: `You're invited to the ${name} mentoring cohort`,
        html: `<p>You've been invited to join the <strong>${name}</strong> mentoring cohort on Stellr.</p>
               <p><a href="${inviteUrl}">Review and accept your invitation →</a></p>`,
        text: `You've been invited to join the ${name} mentoring cohort. Review and accept: ${inviteUrl}`,
      },
    })
  }
  return pendingIds.length
}

export interface CohortInvite {
  cohortId: string
  name: string
  invitedAt: string | null
}

/** Pending cohort invites awaiting this member's response. */
export async function listCohortInvites(memberId: string): Promise<CohortInvite[]> {
  const db = supabaseServer()
  const { data } = await db
    .from('cohort_members')
    .select('cohort_id, invited_at, mentoring_cohorts(name)')
    .eq('member_id', memberId)
    .eq('status', 'invited')
  return (data ?? []).map((r) => {
    const c = Array.isArray(r.mentoring_cohorts) ? r.mentoring_cohorts[0] : r.mentoring_cohorts
    return {
      cohortId: r.cohort_id as string,
      name: ((c as { name?: string } | null)?.name) ?? 'Cohort',
      invitedAt: (r.invited_at as string | null) ?? null,
    }
  })
}

/** A member accepts (→ active) or declines (→ removed) a pending invite. */
export async function respondToInvite(cohortId: string, memberId: string, accept: boolean): Promise<boolean> {
  const db = supabaseServer()
  const { data: row } = await db
    .from('cohort_members')
    .select('status')
    .eq('cohort_id', cohortId)
    .eq('member_id', memberId)
    .maybeSingle()
  if (!row || row.status !== 'invited') return false

  if (accept) {
    const { error } = await db
      .from('cohort_members')
      .update({ status: 'active', accepted_at: new Date().toISOString() })
      .eq('cohort_id', cohortId)
      .eq('member_id', memberId)
    return !error
  }
  const { error } = await db
    .from('cohort_members')
    .delete()
    .eq('cohort_id', cohortId)
    .eq('member_id', memberId)
  return !error
}

/** Re-notify everyone with a pending invite to a cohort (admin "resend"). */
export async function resendCohortInvites(cohortId: string): Promise<number> {
  const db = supabaseServer()
  const { data: pending } = await db
    .from('cohort_members')
    .select('member_id')
    .eq('cohort_id', cohortId)
    .eq('status', 'invited')
  const ids = (pending ?? []).map((r) => r.member_id as string)
  if (!ids.length) return 0
  const { data: cohort } = await db.from('mentoring_cohorts').select('name').eq('id', cohortId).maybeSingle()
  const name = (cohort?.name as string) ?? 'a mentoring cohort'
  await notifyMembers(ids, {
    type: 'announcement',
    body: `Reminder: you've been invited to the ${name} mentoring cohort. Open Mentoring to accept.`,
    referenceType: 'cohort',
    referenceId: cohortId,
  })
  return ids.length
}

// ─── Mentor cohort management + chat moderation (PRD §11) ────────────────────

/** True when the member is the assigned mentor of the cohort. */
export async function isCohortMentor(cohortId: string, memberId: string): Promise<boolean> {
  const db = supabaseServer()
  const { data } = await db
    .from('mentoring_cohorts')
    .select('mentor_member_id')
    .eq('id', cohortId)
    .maybeSingle()
  return data?.mentor_member_id === memberId
}

/** True when the member moderates a channel (cohort mentor, or coaching host). */
export async function isChannelModerator(channelId: string, memberId: string): Promise<boolean> {
  const db = supabaseServer()
  const { data: ch } = await db
    .from('chat_channels')
    .select('kind, cohort_id, host_member_id')
    .eq('id', channelId)
    .maybeSingle()
  if (!ch) return false
  if (ch.kind === 'coaching') return ch.host_member_id === memberId
  if (ch.kind === 'cohort' && ch.cohort_id) return isCohortMentor(ch.cohort_id as string, memberId)
  return false
}

/** A member flags a message to the channel's moderator (PRD §11). */
export async function flagMessage(messageId: string, memberId: string): Promise<boolean> {
  const db = supabaseServer()
  const { data: msg } = await db
    .from('chat_messages')
    .select('id, channel_id')
    .eq('id', messageId)
    .maybeSingle()
  if (!msg) return false
  const channelId = msg.channel_id as string
  if (!(await canAccessChannel(channelId, memberId))) return false

  const { error } = await db
    .from('chat_messages')
    .update({ flagged_at: new Date().toISOString(), flagged_by: memberId })
    .eq('id', messageId)
  if (error) return false

  // Notify the channel's moderator (mentor / coach).
  const { data: ch } = await db
    .from('chat_channels')
    .select('kind, cohort_id, host_member_id')
    .eq('id', channelId)
    .maybeSingle()
  let moderatorId: string | null = null
  if (ch?.kind === 'coaching') moderatorId = (ch.host_member_id as string | null) ?? null
  else if (ch?.kind === 'cohort' && ch.cohort_id) {
    const { data: c } = await db
      .from('mentoring_cohorts')
      .select('mentor_member_id')
      .eq('id', ch.cohort_id)
      .maybeSingle()
    moderatorId = (c?.mentor_member_id as string | null) ?? null
  }
  // Notify moderator and point the notification link at the cohort page so they
  // land in the right place (NotificationBell routes reference_type='cohort').
  const cohortId = ch?.kind === 'cohort' ? (ch.cohort_id as string | null) : null
  if (moderatorId && moderatorId !== memberId) {
    await notifyMember(moderatorId, {
      type: 'announcement',
      body: 'A message in your cohort chat was flagged for review.',
      referenceType: cohortId ? 'cohort' : 'chat_channel',
      referenceId: cohortId ?? channelId,
      actorMemberId: memberId,
    })
  }

  // Record the flag in the activity log so admins can see it.
  await logActivity({
    memberId,
    actorType: 'member',
    actorMemberId: memberId,
    category: 'community',
    action: 'chat_message_flagged',
    summary: `Flagged a chat message for review${cohortId ? ' (cohort)' : ''}`,
    metadata: { messageId, channelId, cohortId: cohortId ?? undefined },
  })

  return true
}

/** The channel's moderator soft-deletes a message (PRD §11). */
export async function deleteMessage(messageId: string, memberId: string): Promise<boolean> {
  const db = supabaseServer()
  const { data: msg } = await db
    .from('chat_messages')
    .select('id, channel_id')
    .eq('id', messageId)
    .maybeSingle()
  if (!msg) return false
  if (!(await isChannelModerator(msg.channel_id as string, memberId))) return false
  const { error } = await db
    .from('chat_messages')
    .update({ deleted_at: new Date().toISOString(), deleted_by: memberId })
    .eq('id', messageId)
  return !error
}

/**
 * Schedule a series of mentoring sessions (PRD §11 — mentor defines "number of
 * live video sessions, duration, start date"). Spaces them `intervalDays` apart.
 */
export async function scheduleMentoringSeries(
  hostId: string,
  cohortId: string,
  startIso: string,
  count: number,
  intervalDays: number,
  durationMin: number,
  title?: string,
): Promise<{ ok: boolean; created: number; error?: string }> {
  const n = Math.max(1, Math.min(Math.floor(count) || 1, 52))
  const interval = Math.max(0, Math.floor(intervalDays) || 0)
  const base = new Date(startIso)
  if (Number.isNaN(base.getTime())) return { ok: false, created: 0, error: 'Invalid start date.' }

  let created = 0
  let error: string | undefined
  for (let i = 0; i < n; i++) {
    const start = new Date(base.getTime() + i * interval * 86_400_000)
    const r = await scheduleMentoring(hostId, cohortId, start.toISOString(), { durationMin, title })
    if (r.ok) created++
    else error = r.error
  }
  return { ok: created > 0, created, error }
}

// ─── Coaching workshop sessions (1-on-1, FR-COM-12) ──────────────────────────
// A coaching workshop is a mentoring_cohorts row (container_type='coaching') with
// exactly one coachee on the roster. Its sessions are session_type='coaching',
// tied to the container via cohort_id, hosted by the coach. They draw on the
// member's coaching allowance via getEntitlement('coaching') — see lib/coaching.ts.

/**
 * Schedule one coaching session for a workshop. Looks up the single coachee on
 * the roster, fans them out as the participant, provisions the video room, and
 * emails calendar invites to coach + coachee. Coach scheduling does NOT mark the
 * session paid-extra; the member's "free sessions left" reflects scheduled
 * coaching sessions, and cancelling one returns it to the allowance.
 */
export async function scheduleCoachingSession(
  coachId: string,
  workshopId: string,
  startIso: string,
  opts: { durationMin?: number; title?: string } = {},
): Promise<BookResult> {
  const db = supabaseServer()
  const caps = await getHostCaps(coachId)
  if (!caps.canCoach) return { ok: false, error: 'Not authorised to coach.' }

  // Confirm the coach owns this workshop and find the single coachee.
  const { data: ws } = await db
    .from('mentoring_cohorts')
    .select('id, mentor_member_id, container_type')
    .eq('id', workshopId)
    .eq('container_type', 'coaching')
    .maybeSingle()
  if (!ws || ws.mentor_member_id !== coachId) return { ok: false, error: 'Workshop not found.' }

  const { data: roster } = await db
    .from('cohort_members')
    .select('member_id')
    .eq('cohort_id', workshopId)
    .eq('status', 'active')
    .limit(1)
  const coacheeId = (roster ?? [])[0]?.member_id as string | undefined

  const start = new Date(startIso)
  const end = new Date(start.getTime() + (opts.durationMin ?? 60) * 60_000)

  const { data: session, error } = await db
    .from('sessions')
    .insert({
      session_type: 'coaching',
      host_member_id: coachId,
      cohort_id: workshopId,
      member_id: coacheeId ?? null,
      title: opts.title ?? 'Coaching session',
      scheduled_start: start.toISOString(),
      scheduled_end: end.toISOString(),
      status: 'scheduled',
      created_by: coachId,
    })
    .select('id')
    .single()

  if (error || !session) {
    console.error('[sessions] schedule coaching error:', error)
    return { ok: false, error: 'Could not schedule session.' }
  }

  await provisionRoom(session.id, opts.title ?? 'Coaching session')
  if (coacheeId) {
    await db.from('session_participants').insert({ session_id: session.id, member_id: coacheeId })
    await notifyMember(coacheeId, {
      type: 'session',
      body: `New coaching session scheduled for ${start.toLocaleString()}.`,
      referenceType: 'session',
      referenceId: session.id,
      actorMemberId: coachId,
    })
  }
  await sendSessionInvites(session.id)
  return { ok: true, sessionId: session.id }
}

/** Schedule a series of coaching sessions `intervalDays` apart (bulk "Schedule all"). */
export async function scheduleCoachingSeries(
  coachId: string,
  workshopId: string,
  startIso: string,
  count: number,
  intervalDays: number,
  durationMin: number,
  title?: string,
): Promise<{ ok: boolean; created: number; error?: string }> {
  const n = Math.max(1, Math.min(Math.floor(count) || 1, 52))
  const interval = Math.max(0, Math.floor(intervalDays) || 0)
  const base = new Date(startIso)
  if (Number.isNaN(base.getTime())) return { ok: false, created: 0, error: 'Invalid start date.' }

  let created = 0
  let error: string | undefined
  for (let i = 0; i < n; i++) {
    const start = new Date(base.getTime() + i * interval * 86_400_000)
    const r = await scheduleCoachingSession(coachId, workshopId, start.toISOString(), { durationMin, title })
    if (r.ok) created++
    else error = r.error
  }
  return { ok: created > 0, created, error }
}

/** Link a training module to a cohort (mentor or admin). */
export async function linkCohortTraining(
  cohortId: string,
  moduleId: string,
  isMandatory: boolean,
  dueAt: string | null,
): Promise<void> {
  const db = supabaseServer()
  await db.from('cohort_training_links').upsert(
    { cohort_id: cohortId, module_id: moduleId, is_mandatory: isMandatory, due_at: dueAt || null },
    { onConflict: 'cohort_id,module_id' },
  )
}

/** Remove a training module link from a cohort. */
export async function unlinkCohortTraining(cohortId: string, moduleId: string): Promise<void> {
  const db = supabaseServer()
  await db.from('cohort_training_links').delete().eq('cohort_id', cohortId).eq('module_id', moduleId)
}
