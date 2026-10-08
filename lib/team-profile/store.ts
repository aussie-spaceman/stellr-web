// Team profiles: who gets one, sending it, reading and saving answers.
//
// A student gets a team profile once their permission form is complete
// (Stellr signing or DocuSign; an adult student with no agreement to sign
// counts as complete, exactly as the roster's agreement pill reads). The
// first email goes out from three places, all idempotent through the UNIQUE
// participant_id on team_profiles:
//   - the agreement completing (lib/esign/completion.ts), for both engines
//   - paperwork already on file at registration (lib/docusign-agreements.ts)
//   - the daily sweep (app/api/cron/team-profiles), for anything missed
//
// Returning students (a submitted profile from an earlier event) get their
// last answers pre-filled and an email asking them to check and update them.

import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'
import { isMinorOn, onDate } from '@/lib/age'
import { STUDENT_ROLES } from '@/lib/membership-rules'
import { markdownToTiptap } from '@/lib/event-emails/defaults'
import {
  EVENT_EMAIL_FROM,
  EVENT_EMAIL_REPLY_TO,
  eventMergeVars,
  recipientMergeVars,
  renderEventEmail,
  type EventForEmail,
} from '@/lib/event-emails/render'
import { loadEventForEmail } from '@/lib/event-emails/send'
import { loadSurveyEvent, loadAllSurveyEvents, type SurveyEvent } from '@/lib/survey/events'
import { localDate } from '@/lib/survey/timezone'
import { DEFINITION_VERSION, missingAnswers, normaliseAnswers, type TeamProfileAnswers } from './questions'
import { hashToken, looksLikeToken, teamProfileLink, teamProfileToken } from './tokens'

const SEND_SPACING_MS = 550 // Resend allows ~2 requests/second
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface TeamProfileRow {
  id: string
  participant_id: string
  member_id: string | null
  event_slug: string
  token_version: number
  prefilled_from: string | null
  definition_version: number
  answers: unknown
  submitted_at: string | null
  first_sent_at: string | null
  last_sent_at: string | null
  send_count: number
  last_send_error: string | null
  created_at: string
  updated_at: string
}

const ROW_COLUMNS =
  'id, participant_id, member_id, event_slug, token_version, prefilled_from, definition_version, answers, ' +
  'submitted_at, first_sent_at, last_sent_at, send_count, last_send_error, created_at, updated_at'

// ── Events ────────────────────────────────────────────────────────────────────

export interface EventContext {
  meta: SurveyEvent
  email: EventForEmail
}

async function loadEventContext(slug: string, cache?: Map<string, EventContext | null>): Promise<EventContext | null> {
  if (cache?.has(slug)) return cache.get(slug)!
  const [meta, email] = await Promise.all([loadSurveyEvent(slug), loadEventForEmail(slug)])
  const ctx = meta && email ? { meta, email } : null
  cache?.set(slug, ctx)
  return ctx
}

/** Answers can be given and changed until the event's first day begins, in its own time zone. */
export function profileOpen(meta: Pick<SurveyEvent, 'date' | 'timeZone' | 'cancelled'>, now = new Date()): boolean {
  if (meta.cancelled) return false
  if (!meta.date) return true
  return localDate(now, meta.timeZone) < meta.date.slice(0, 10)
}

/** Competitions only: campaigns and cancelled or finished events get no profile. */
function eventTakesProfiles(ctx: EventContext | null, now: Date): ctx is EventContext {
  return !!ctx && !ctx.meta.isCampaign && profileOpen(ctx.meta, now)
}

/** `.in()` over a long id list, 150 at a time so the request URL stays short. */
async function selectIn(
  db: SupabaseClient,
  table: string,
  columns: string,
  column: string,
  values: string[],
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  for (let i = 0; i < values.length; i += 150) {
    const { data, error } = await db.from(table).select(columns).in(column, values.slice(i, i + 150))
    if (error) throw new Error(`Loading ${table} failed: ${error.message}`)
    out.push(...((data ?? []) as unknown as Record<string, unknown>[]))
  }
  return out
}

// ── Eligibility ───────────────────────────────────────────────────────────────

interface Candidate {
  id: string
  member_id: string | null
  first_name: string
  last_name: string
  email: string | null
  date_of_birth: string | null
  event_role: string | null
  emergency_contact_email: string | null
  emergency_contact_first_name: string | null
  event_slug: string
}

const CANDIDATE_SELECT =
  'id, member_id, first_name, last_name, email, date_of_birth, event_role, emergency_contact_email, ' +
  'emergency_contact_first_name, registrations!inner(event_slug, status)'

function toCandidates(rows: Record<string, unknown>[] | null): Candidate[] {
  const out: Candidate[] = []
  for (const r of rows ?? []) {
    const reg = (Array.isArray(r.registrations) ? r.registrations[0] : r.registrations) as
      | { event_slug: string; status: string }
      | null
    if (!reg || reg.status === 'withdrawn') continue
    if (!STUDENT_ROLES.includes((r.event_role as string) ?? '')) continue
    out.push({ ...(r as unknown as Candidate), event_slug: reg.event_slug })
  }
  return out
}

/**
 * Which of these participants' permission forms are complete. Mirrors the
 * roster (lib/event-admin.ts): a completed agreement, or — for an adult with
 * no agreement at all — nothing to sign.
 */
export async function formsComplete(
  db: SupabaseClient,
  people: Pick<Candidate, 'id' | 'date_of_birth' | 'event_slug'>[],
  eventDates: Map<string, string | null>,
) {
  const done = new Set<string>()
  if (!people.length) return done
  const data = await selectIn(db, 'agreements', 'participant_id, status', 'participant_id', people.map((p) => p.id))
  const hasEnvelope = new Set<string>()
  for (const a of data) {
    hasEnvelope.add(a.participant_id as string)
    if (a.status === 'completed') done.add(a.participant_id as string)
  }
  for (const p of people) {
    if (hasEnvelope.has(p.id)) continue
    const date = eventDates.get(p.event_slug)
    if (!isMinorOn(p.date_of_birth, date ? onDate(date) : undefined)) done.add(p.id)
  }
  return done
}

// ── Email ─────────────────────────────────────────────────────────────────────

interface Recipient {
  email: string
  firstName: string
  /** The student has no address of their own; the parent or guardian passes it on. */
  viaGuardian: boolean
}

function recipientFor(p: Candidate): Recipient | null {
  const own = p.email?.trim().toLowerCase() || null
  const guardian = p.emergency_contact_email?.trim().toLowerCase() || null
  if (own && own !== guardian) return { email: own, firstName: p.first_name, viaGuardian: false }
  if (guardian) return { email: guardian, firstName: p.emergency_contact_first_name || '', viaGuardian: true }
  if (own) return { email: own, firstName: p.first_name, viaGuardian: false }
  return null
}

/** The invitation email. Copy per VOICE.md: transactional, warm but functional. */
export function teamProfileEmailBody(opts: { returning: boolean; viaGuardian: boolean; studentName: string }): { subject: string; body: string } {
  const { returning, viaGuardian, studentName } = opts
  const subject = returning
    ? '{{event_name}}: check your team profile'
    : '{{event_name}}: your team profile (about 5 minutes)'
  const passItOn = viaGuardian ? ` Please pass the link to ${studentName}: the questions are for them.` : ''
  const lines = viaGuardian
    ? [
        'Hi {{first_name}},',
        `${studentName} is registered for {{event_name}} on {{event_date}}, and their forms are all signed. Thank you!`,
        `At the event, ${studentName} will work in a company with students from other schools. To make the companies as balanced as we can, we’d like to know a little about their skills and how they like to work.`,
        returning
          ? `We’ve filled in the team profile with ${studentName}’s answers from last time. Skills grow, so they should check them, change anything that’s different, and submit.${passItOn}`
          : `It takes about 5 minutes.${passItOn}`,
      ]
    : [
        'Hi {{first_name}},',
        returning
          ? 'Welcome back! You’re registered for {{event_name}} on {{event_date}}, and your forms are all signed.'
          : 'You’re registered for {{event_name}} on {{event_date}}, and your forms are all signed. Thank you!',
        'At the event, you’ll work in a company with students from other schools. To make the companies as balanced as we can, we’d like to know a little about your skills and how you like to work.',
        returning
          ? 'We’ve filled in your team profile with your answers from last time. Skills grow, so please check them, change anything that’s different, and submit.'
          : 'It takes about 5 minutes.',
      ]
  lines.push(
    '{{team_profile_link}}',
    'Answers can be changed until the event starts. Students can also find their team profile in the Stellr portal: {{portal_link}}',
    'See you at {{event_name}}!',
  )
  return { subject, body: lines.join('\n\n') }
}

async function sendInvite(
  db: SupabaseClient,
  row: Pick<TeamProfileRow, 'id' | 'token_version' | 'prefilled_from' | 'submitted_at'>,
  p: Candidate,
  event: EventForEmail,
): Promise<{ ok: boolean; error?: string }> {
  const to = recipientFor(p)
  const now = new Date().toISOString()
  if (!to) {
    await db.from('team_profiles').update({ last_send_error: 'No email address', updated_at: now }).eq('id', row.id)
    return { ok: false, error: 'No email address' }
  }
  const url = teamProfileLink(row.id, row.token_version)
  const { subject, body } = teamProfileEmailBody({
    returning: !!row.prefilled_from && !row.submitted_at,
    viaGuardian: to.viaGuardian,
    studentName: p.first_name,
  })
  const vars = {
    ...eventMergeVars(event),
    ...recipientMergeVars({
      email: to.email,
      firstName: to.firstName,
      roles: [to.viaGuardian ? 'guardian' : 'participant'],
      participantNames: [p.first_name],
      isParticipant: !to.viaGuardian,
      payments: [],
      teamProfiles: [{ participantName: to.viaGuardian ? p.first_name : 'your', url }],
    }),
  }
  const rendered = renderEventEmail({ subject, body_json: markdownToTiptap(body) }, vars)
  try {
    await sendEmail({ to: to.email, from: EVENT_EMAIL_FROM, replyTo: EVENT_EMAIL_REPLY_TO, ...rendered })
    const { data: cur } = await db.from('team_profiles').select('send_count, first_sent_at').eq('id', row.id).maybeSingle()
    await db
      .from('team_profiles')
      .update({
        first_sent_at: (cur?.first_sent_at as string | null) ?? now,
        last_sent_at: now,
        send_count: ((cur?.send_count as number | null) ?? 0) + 1,
        last_send_error: null,
        updated_at: now,
      })
      .eq('id', row.id)
    return { ok: true }
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500)
    await db.from('team_profiles').update({ last_send_error: message, updated_at: now }).eq('id', row.id)
    return { ok: false, error: message }
  }
}

// ── Creating rows ─────────────────────────────────────────────────────────────

/** The member's most recent submitted profile, for pre-filling. */
async function previousProfile(db: SupabaseClient, memberId: string | null, excludeParticipant: string) {
  if (!memberId) return null
  const { data } = await db
    .from('team_profiles')
    .select('id, answers')
    .eq('member_id', memberId)
    .neq('participant_id', excludeParticipant)
    .not('submitted_at', 'is', null)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data as { id: string; answers: unknown } | null
}

/** Creates the row if there isn't one. Returns it, and whether this call created it. */
async function ensureRow(db: SupabaseClient, p: Candidate): Promise<{ row: TeamProfileRow; created: boolean }> {
  const { data: existing } = await db.from('team_profiles').select(ROW_COLUMNS).eq('participant_id', p.id).maybeSingle()
  if (existing) return { row: existing as unknown as TeamProfileRow, created: false }

  const id = randomUUID()
  const prev = await previousProfile(db, p.member_id, p.id)
  const { data, error } = await db
    .from('team_profiles')
    .insert({
      id,
      participant_id: p.id,
      member_id: p.member_id,
      event_slug: p.event_slug,
      token_hash: hashToken(teamProfileToken(id, 1)),
      token_version: 1,
      prefilled_from: prev?.id ?? null,
      definition_version: DEFINITION_VERSION,
      answers: prev ? normaliseAnswers(prev.answers) : {},
    })
    .select(ROW_COLUMNS)
    .single()
  if (error) {
    // Someone else created it between our read and insert: theirs stands.
    if (error.code === '23505') {
      const { data: theirs } = await db.from('team_profiles').select(ROW_COLUMNS).eq('participant_id', p.id).single()
      return { row: theirs as unknown as TeamProfileRow, created: false }
    }
    throw new Error(`Creating team profile failed: ${error.message}`)
  }
  return { row: data as unknown as TeamProfileRow, created: true }
}

// ── Public operations ─────────────────────────────────────────────────────────

export interface DispatchResult {
  sent: number
  failed: number
  /** Students still waiting on a permission form. */
  waiting: number
  /** Ready, but left for the next run because the time budget ran out. */
  deferred: number
}

/**
 * Sends the first team profile email to every eligible student who hasn't had
 * one. Scope it to some participants (an agreement just completed) or one
 * event; with neither, every upcoming competition (the daily sweep).
 */
export async function dispatchTeamProfiles(
  db: SupabaseClient,
  scope: { participantIds?: string[]; eventSlug?: string; budgetMs?: number } = {},
  now = new Date(),
): Promise<DispatchResult> {
  const result: DispatchResult = { sent: 0, failed: 0, waiting: 0, deferred: 0 }
  const events = new Map<string, EventContext | null>()

  let slugs: string[] | null = null
  if (!scope.participantIds && !scope.eventSlug) {
    const all = await loadAllSurveyEvents()
    slugs = all.filter((e) => !e.isCampaign && profileOpen(e, now)).map((e) => e.slug)
    if (!slugs.length) return result
  } else if (scope.eventSlug) {
    slugs = [scope.eventSlug]
  }

  let q = db.from('participants').select(CANDIDATE_SELECT)
  if (scope.participantIds) q = q.in('id', scope.participantIds)
  if (slugs) q = q.in('registrations.event_slug', slugs)
  const { data, error } = await q
  if (error) throw new Error(`Loading participants failed: ${error.message}`)
  let people = toCandidates(data as unknown as Record<string, unknown>[])
  if (!people.length) return result

  const existing = await selectIn(db, 'team_profiles', 'participant_id', 'participant_id', people.map((p) => p.id))
  const have = new Set(existing.map((r) => r.participant_id as string))
  people = people.filter((p) => !have.has(p.id))

  for (const slug of new Set(people.map((p) => p.event_slug))) await loadEventContext(slug, events)
  people = people.filter((p) => eventTakesProfiles(events.get(p.event_slug) ?? null, now))
  const dates = new Map([...events].map(([slug, ctx]) => [slug, ctx?.meta.date ?? null]))
  const ready = await formsComplete(db, people, dates)

  let first = true
  const started = Date.now()
  for (const p of people) {
    if (!ready.has(p.id)) {
      result.waiting++
      continue
    }
    if (scope.budgetMs && Date.now() - started > scope.budgetMs) {
      result.deferred++
      continue
    }
    const { row, created } = await ensureRow(db, p)
    if (!created) continue
    if (!first) await sleep(SEND_SPACING_MS)
    first = false
    const sent = await sendInvite(db, row, p, events.get(p.event_slug)!.email)
    if (sent.ok) result.sent++
    else result.failed++
  }
  return result
}

export type ResendOutcome =
  | { ok: true; email: string }
  | { ok: false; status: number; error: string }

/** The roster's per-student "Resend team profile". Creates the profile if needed. */
export async function resendTeamProfile(db: SupabaseClient, slug: string, participantId: string): Promise<ResendOutcome> {
  const { data } = await db.from('participants').select(CANDIDATE_SELECT).eq('id', participantId).eq('registrations.event_slug', slug)
  const p = toCandidates(data as unknown as Record<string, unknown>[])[0]
  if (!p) return { ok: false, status: 404, error: 'This student isn’t on the roster for this event.' }
  const ctx = await loadEventContext(slug)
  if (!ctx) return { ok: false, status: 404, error: 'Event not found.' }
  if (ctx.meta.isCampaign) return { ok: false, status: 400, error: 'Campaigns don’t use team profiles.' }
  if (!profileOpen(ctx.meta)) return { ok: false, status: 400, error: 'The event has started, so team profiles are closed.' }
  const ready = await formsComplete(db, [p], new Map([[slug, ctx.meta.date]]))
  if (!ready.has(p.id)) return { ok: false, status: 409, error: 'Their permission form isn’t complete yet. The team profile goes out as soon as it is.' }
  const { row } = await ensureRow(db, p)
  const sent = await sendInvite(db, row, p, ctx.email)
  if (!sent.ok) return { ok: false, status: 502, error: sent.error ?? 'Sending failed.' }
  return { ok: true, email: recipientFor(p)!.email }
}

/**
 * "Send to everyone who hasn't answered": every eligible student without a
 * submitted profile, up to `limit` per call (a route has 60 seconds).
 */
export async function resendOutstanding(
  db: SupabaseClient,
  slug: string,
  limit = 75,
): Promise<{ sent: number; failed: number; waiting: number; remaining: number }> {
  const ctx = await loadEventContext(slug)
  if (!ctx || ctx.meta.isCampaign || !profileOpen(ctx.meta)) return { sent: 0, failed: 0, waiting: 0, remaining: 0 }
  const { data, error } = await db.from('participants').select(CANDIDATE_SELECT).eq('registrations.event_slug', slug)
  if (error) throw new Error(`Loading participants failed: ${error.message}`)
  const people = toCandidates(data as unknown as Record<string, unknown>[])
  const { data: rows } = await db.from('team_profiles').select('participant_id, submitted_at').eq('event_slug', slug)
  const submitted = new Set((rows ?? []).filter((r) => r.submitted_at).map((r) => r.participant_id as string))
  const outstanding = people.filter((p) => !submitted.has(p.id))
  const ready = await formsComplete(db, outstanding, new Map([[slug, ctx.meta.date]]))
  const todo = outstanding.filter((p) => ready.has(p.id))

  let sent = 0
  let failed = 0
  for (const [i, p] of todo.slice(0, limit).entries()) {
    if (i > 0) await sleep(SEND_SPACING_MS)
    const { row } = await ensureRow(db, p)
    const r = await sendInvite(db, row, p, ctx.email)
    if (r.ok) sent++
    else failed++
  }
  return { sent, failed, waiting: outstanding.length - todo.length, remaining: Math.max(0, todo.length - limit) }
}

/**
 * For the Email Reminders audience: each outstanding student's link, creating
 * rows as needed when `mint` (a real send). A preview gets placeholders and
 * writes nothing.
 */
export async function outstandingProfileLinks(
  db: SupabaseClient,
  slug: string,
  participantIds: string[],
  mint: boolean,
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!participantIds.length) return out
  if (!mint) {
    for (const id of participantIds) out.set(id, '[team profile link]')
    return out
  }
  const { data } = await db.from('participants').select(CANDIDATE_SELECT).in('id', participantIds).eq('registrations.event_slug', slug)
  for (const p of toCandidates(data as unknown as Record<string, unknown>[])) {
    const { row } = await ensureRow(db, p)
    out.set(p.id, teamProfileLink(row.id, row.token_version))
  }
  return out
}

// ── Reading and answering ─────────────────────────────────────────────────────

export interface ProfileSession {
  row: TeamProfileRow
  answers: TeamProfileAnswers
  studentFirstName: string
  eventTitle: string
  eventDate: string | null
  open: boolean
  /** Pre-filled from an earlier event and not yet confirmed. */
  prefilled: boolean
}

async function sessionFor(db: SupabaseClient, row: TeamProfileRow): Promise<ProfileSession | null> {
  const { data: p } = await db.from('participants').select('first_name').eq('id', row.participant_id).maybeSingle()
  const ctx = await loadEventContext(row.event_slug)
  if (!p || !ctx) return null
  return {
    row,
    answers: normaliseAnswers(row.answers),
    studentFirstName: (p.first_name as string) ?? '',
    eventTitle: ctx.meta.title,
    eventDate: ctx.meta.date,
    open: profileOpen(ctx.meta),
    prefilled: !!row.prefilled_from && !row.submitted_at,
  }
}

export async function sessionByToken(db: SupabaseClient, token: string): Promise<ProfileSession | null> {
  if (!looksLikeToken(token)) return null
  const { data } = await db.from('team_profiles').select(ROW_COLUMNS).eq('token_hash', hashToken(token)).maybeSingle()
  return data ? sessionFor(db, data as unknown as TeamProfileRow) : null
}

export type SaveOutcome = { ok: true } | { ok: false; status: number; error: string; missing?: string[] }

export async function saveAnswers(db: SupabaseClient, session: ProfileSession, raw: unknown): Promise<SaveOutcome> {
  if (!session.open) return { ok: false, status: 409, error: 'The event has started, so answers can’t be changed now.' }
  const answers = normaliseAnswers(raw)
  const missing = missingAnswers(answers)
  if (missing.length) return { ok: false, status: 422, error: 'Please answer every required question.', missing }
  const now = new Date().toISOString()
  const { error } = await db
    .from('team_profiles')
    .update({ answers, definition_version: DEFINITION_VERSION, submitted_at: now, updated_at: now })
    .eq('id', session.row.id)
  if (error) return { ok: false, status: 500, error: 'Saving failed. Please try again.' }
  return { ok: true }
}

// ── Member history ────────────────────────────────────────────────────────────

export interface HistoryEntry {
  id: string
  eventSlug: string
  eventTitle: string
  eventDate: string | null
  submittedAt: string | null
  answers: TeamProfileAnswers
  /** The member's own link while answers can still change. */
  editUrl: string | null
}

/** A member's team profiles, newest event first, for the account page. */
export async function memberHistory(db: SupabaseClient, memberId: string): Promise<HistoryEntry[]> {
  const { data } = await db
    .from('team_profiles')
    .select(ROW_COLUMNS)
    .eq('member_id', memberId)
    .order('created_at', { ascending: false })
  const rows = (data ?? []) as unknown as TeamProfileRow[]
  const events = new Map<string, EventContext | null>()
  const out: HistoryEntry[] = []
  for (const row of rows) {
    const ctx = await loadEventContext(row.event_slug, events)
    const open = ctx ? profileOpen(ctx.meta) : false
    out.push({
      id: row.id,
      eventSlug: row.event_slug,
      eventTitle: ctx?.meta.title ?? row.event_slug,
      eventDate: ctx?.meta.date ?? null,
      submittedAt: row.submitted_at,
      answers: normaliseAnswers(row.answers),
      editUrl: open ? teamProfileLink(row.id, row.token_version) : null,
    })
  }
  return out.sort((a, b) => (b.eventDate ?? '').localeCompare(a.eventDate ?? ''))
}
