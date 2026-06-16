import { supabaseServer } from '@/lib/supabase'
import { type CommunityMember, getCurrentMember, memberCanAccess } from '@/lib/community'
import { containerAccessPersists } from '@/lib/containers'
import { getVideoProvider } from '@/lib/video-provider'
import { notifyMember, notifyMembers } from '@/lib/notify'
import { sendEmail } from '@/lib/email'
import { buildIcsAttachment } from '@/lib/ics'

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

  const { data: cm } = await db.from('cohort_members').select('member_id').eq('cohort_id', cohortId)
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

export async function addActions(
  sessionId: string,
  hostId: string,
  memberId: string,
  titles: string[]
): Promise<boolean> {
  const db = supabaseServer()
  const { data: s } = await db.from('sessions').select('host_member_id').eq('id', sessionId).maybeSingle()
  if (!s || s.host_member_id !== hostId) return false
  if (titles.length === 0) return true
  const { error } = await db.from('session_actions').insert(
    titles.map((title, i) => ({
      session_id: sessionId,
      member_id: memberId,
      title,
      created_by: hostId,
      display_order: i,
    }))
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
}

export async function getMemberActions(memberId: string): Promise<MemberAction[]> {
  const db = supabaseServer()
  const { data } = await db
    .from('session_actions')
    .select('id, title, is_done, session_id')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false })
  return (data ?? []) as MemberAction[]
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
  created_at: string
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
    .select('id, body, author_member_id, created_at')
    .eq('channel_id', channelId)
    .order('created_at', { ascending: true })
    .limit(500)
  return (data ?? []) as ChatMessage[]
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
