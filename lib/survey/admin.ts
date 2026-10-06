/**
 * What the admin "Survey" tab shows for one event (handover A1/A2): the
 * schedule, who will be (or was) invited, who can't be, and per-person
 * progress. Admins and the event's assigned managers see it.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { distributionForEvent, ensureDistribution, planFor, statusNow, type DistributionRow } from './distributions'
import { loadSurveyEvent } from './events'
import { autoOpensAt, closesAtFor } from './schedule'
import type { RecipientPlan } from './recipients'

export interface CompletionRow {
  invitationId: string
  name: string
  role: 'student' | 'mentor' | 'adult'
  relationship: string | null
  email: string
  sendVia: 'self' | 'guardian'
  status: string
  sentAt: string | null
  openedAt: string | null
  openedFrom: string | null
  startedAt: string | null
  submittedAt: string | null
  lastActivityAt: string | null
  reminders: number
  remindersOff: boolean
  lastError: string | null
}

export interface AdminSurveyView {
  distribution: DistributionRow | null
  status: DistributionRow['status'] | null
  autoOpensAt: string | null
  /** Why there is no distribution, when there isn't one. */
  reason: string | null
  definition: { key: string; version: number; status: string } | null
  preview: {
    byRole: Record<'student' | 'mentor' | 'adult', number>
    invitable: number
    unreachable: RecipientPlan['unreachable']
    awaitingConsent: RecipientPlan['awaitingConsent']
    headcountOnlyAdults: number
  } | null
  totals: { invited: number; sent: number; opened: number; started: number; submitted: number; queued: number; optedOut: number }
  rows: CompletionRow[]
}

export async function adminSurveyView(db: SupabaseClient, slug: string, now = new Date()): Promise<AdminSurveyView> {
  let d = await distributionForEvent(db, slug)
  let reason: string | null = null
  // Keep it in step with Sanity (date moved, cancelled) — or create it, for an
  // event that predates the survey feature.
  const event = await loadSurveyEvent(slug).catch(() => null)
  if (event) {
    const r = await ensureDistribution(db, event, now)
    if (r.action === 'skipped') reason = r.reason
    else d = r.distribution
  }

  const empty = { invited: 0, sent: 0, opened: 0, started: 0, submitted: 0, queued: 0, optedOut: 0 }
  if (!d) return { distribution: null, status: null, autoOpensAt: null, reason: reason ?? 'not scheduled', definition: null, preview: null, totals: empty, rows: [] }

  const { data: defRow } = await db.from('survey_definitions').select('key, version, status').eq('id', d.definition_id).maybeSingle()
  const status = statusNow(d, now)

  const plan = await planFor(db, d)
  const byRole = { student: 0, mentor: 0, adult: 0 }
  for (const p of plan.invitable) byRole[p.role]++
  const preview = {
    byRole,
    invitable: plan.invitable.length,
    unreachable: plan.unreachable,
    awaitingConsent: plan.awaitingConsent,
    headcountOnlyAdults: plan.headcountOnlyAdults,
  }

  const { data: invs, error } = await db
    .from('survey_invitations')
    .select(
      'id, first_name, respondent_role, adult_relationship, email, send_via, status, sent_at, first_opened_at, opened_from, last_activity_at, reminder_count, resume_reminder_count, reminders_opted_out_at, last_send_error, participants(first_name, last_name), members(first_name, last_name), survey_responses(started_at, submitted_at)',
    )
    .eq('distribution_id', d.id)
  if (error) throw new Error(`Reading invitations failed: ${error.message}`)

  type Inv = {
    id: string
    first_name: string | null
    respondent_role: CompletionRow['role']
    adult_relationship: string | null
    email: string
    send_via: 'self' | 'guardian'
    status: string
    sent_at: string | null
    first_opened_at: string | null
    opened_from: string | null
    last_activity_at: string | null
    reminder_count: number
    resume_reminder_count: number
    reminders_opted_out_at: string | null
    last_send_error: string | null
    participants: { first_name: string | null; last_name: string | null } | null
    members: { first_name: string | null; last_name: string | null } | null
    survey_responses: { started_at: string | null; submitted_at: string | null } | { started_at: string | null; submitted_at: string | null }[] | null
  }
  const rows: CompletionRow[] = ((invs ?? []) as unknown as Inv[]).map((i) => {
    const resp = Array.isArray(i.survey_responses) ? i.survey_responses[0] : i.survey_responses
    const person = i.participants ?? i.members
    const name = [person?.first_name ?? i.first_name, person?.last_name].filter(Boolean).join(' ') || i.email
    return {
      invitationId: i.id,
      name,
      role: i.respondent_role,
      relationship: i.adult_relationship,
      email: i.email,
      sendVia: i.send_via,
      status: i.status,
      sentAt: i.sent_at,
      openedAt: i.first_opened_at,
      openedFrom: i.opened_from,
      startedAt: resp?.started_at ?? null,
      submittedAt: resp?.submitted_at ?? null,
      lastActivityAt: i.last_activity_at,
      reminders: i.reminder_count + i.resume_reminder_count,
      remindersOff: !!i.reminders_opted_out_at,
      lastError: i.last_send_error,
    }
  })
  rows.sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name))

  const totals = { ...empty, invited: rows.length }
  for (const r of rows) {
    if (r.sentAt) totals.sent++
    if (r.openedAt) totals.opened++
    if (r.startedAt) totals.started++
    if (r.submittedAt) totals.submitted++
    if (r.status === 'queued') totals.queued++
    if (r.remindersOff) totals.optedOut++
  }

  return {
    distribution: d,
    status,
    autoOpensAt: autoOpensAt(d.event_date, d.event_time_zone).toISOString(),
    reason: null,
    definition: defRow ? { key: defRow.key as string, version: defRow.version as number, status: defRow.status as string } : null,
    preview,
    totals,
    rows,
  }
}

/** The close date a proposed go-live would give, for the confirm step. */
export function closePreview(opensAt: Date): string {
  return closesAtFor(opensAt).toISOString()
}
