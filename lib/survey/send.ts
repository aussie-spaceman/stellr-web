/**
 * Sending survey email under the daily budget (survey_email_budget, default
 * 30/day beside e-sign's 60 on Resend Free's 100). Whatever the budget leaves
 * stays queued for the next run — invitations first, then reminders.
 *
 * Each send is claimed before it goes: a queued invitation by bumping
 * send_attempts from the value read, a reminder by bumping its counter from
 * the value read. A second runner reading the same row loses the claim and
 * skips it, so nobody gets the same email twice.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { EmailSendError, sendEmail } from '@/lib/email'
import { AUTH_APP_URL } from '@/lib/env'
import type { DistributionRow } from './distributions'
import type { SurveyDefinition } from './definition'
import { renderSurveyEmail, type SurveyEmailKind } from './emails'
import { dueReminder, type ReminderKind } from './schedule'
import { stopRemindersLink, surveyLink, surveyToken } from './tokens'

export const MAX_SEND_ATTEMPTS = 3

export function dailyBudget(): number {
  const n = Number(process.env.SURVEY_DAILY_EMAIL_BUDGET)
  return Number.isFinite(n) && n >= 0 ? n : 30
}

export async function claimBudget(db: SupabaseClient, now = new Date()): Promise<boolean> {
  const { data, error } = await db.rpc('survey_claim_email', { p_day: now.toISOString().slice(0, 10), p_limit: dailyBudget() })
  if (error) {
    console.error('[survey] budget claim failed:', error.message)
    return false
  }
  return data === true
}

export interface InvitationRow {
  id: string
  distribution_id: string
  recipient_key: string
  participant_id: string | null
  member_id: string | null
  respondent_role: 'student' | 'mentor' | 'adult'
  adult_relationship: 'parent' | 'teacher' | null
  first_name: string | null
  is_minor: boolean
  email: string
  send_via: 'self' | 'guardian'
  token_version: number
  status: string
  sent_at: string | null
  send_attempts: number
  last_send_error: string | null
  first_opened_at: string | null
  last_activity_at: string | null
  opened_from: string | null
  reminder_count: number
  resume_reminder_count: number
  last_reminder_at: string | null
  reminders_opted_out_at: string | null
  created_at: string
}

export function linksFor(inv: Pick<InvitationRow, 'id' | 'token_version'>) {
  const token = surveyToken(inv.id, inv.token_version)
  return {
    token,
    surveyUrl: surveyLink(token),
    stopUrl: stopRemindersLink(token),
    oneClickUrl: `${AUTH_APP_URL}/api/survey/${token}/stop-reminders`,
  }
}

async function deliver(inv: InvitationRow, d: DistributionRow, def: SurveyDefinition, kind: SurveyEmailKind): Promise<void> {
  const links = linksFor(inv)
  const email = renderSurveyEmail({
    kind,
    role: inv.respondent_role,
    sendVia: inv.send_via,
    firstName: inv.first_name,
    eventTitle: d.event_title ?? d.event_slug,
    closesAt: d.closes_at,
    timeZone: d.event_time_zone,
    surveyUrl: links.surveyUrl,
    stopUrl: links.stopUrl,
    minutes: Math.ceil(def.targetMinutes[inv.respondent_role]),
  })
  await sendEmail({
    to: inv.email,
    subject: email.subject,
    html: email.html,
    text: email.text,
    headers: {
      'List-Unsubscribe': `<${links.oneClickUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  })
}

export interface SendTally {
  invited: number
  reminded: number
  deferred: number
  failed: number
  quotaHit: boolean
}

export const emptyTally = (): SendTally => ({ invited: 0, reminded: 0, deferred: 0, failed: 0, quotaHit: false })

/**
 * Send queued invitations for an open distribution. Only recipients still in
 * the current plan (`stillInvitable`) are sent: a minor whose consent was
 * withdrawn after the invitation row was made is marked expired instead.
 */
export async function sendQueued(
  db: SupabaseClient,
  d: DistributionRow,
  def: SurveyDefinition,
  stillInvitable: Set<string>,
  tally: SendTally,
  deadline: number,
  now = new Date(),
): Promise<void> {
  const { data, error } = await db
    .from('survey_invitations')
    .select('*')
    .eq('distribution_id', d.id)
    .eq('status', 'queued')
    .lt('send_attempts', MAX_SEND_ATTEMPTS)
    .order('created_at')
    .limit(200)
  if (error) throw new Error(`Reading queued invitations failed: ${error.message}`)

  for (const inv of (data ?? []) as InvitationRow[]) {
    if (tally.quotaHit) break
    if (Date.now() > deadline) {
      tally.deferred++
      continue
    }
    if (!stillInvitable.has(inv.recipient_key)) {
      await db.from('survey_invitations').update({ status: 'expired' }).eq('id', inv.id).eq('status', 'queued')
      continue
    }
    if (!(await claimBudget(db, now))) {
      tally.deferred++
      continue
    }
    const { data: claimed } = await db
      .from('survey_invitations')
      .update({ send_attempts: inv.send_attempts + 1 })
      .eq('id', inv.id)
      .eq('status', 'queued')
      .eq('send_attempts', inv.send_attempts)
      .select('id')
    if (!claimed?.length) continue
    try {
      await deliver(inv, d, def, 'invite')
      await db
        .from('survey_invitations')
        .update({ status: 'sent', sent_at: new Date().toISOString(), last_send_error: null })
        .eq('id', inv.id)
        .eq('status', 'queued')
      tally.invited++
    } catch (err) {
      tally.failed++
      const message = err instanceof Error ? err.message.slice(0, 500) : String(err)
      await db.from('survey_invitations').update({ last_send_error: message }).eq('id', inv.id)
      if (err instanceof EmailSendError && err.isQuota) tally.quotaHit = true
    }
  }
}

/** Send whatever reminders are due for an open distribution (P1 cadence). */
export async function sendReminders(
  db: SupabaseClient,
  d: DistributionRow,
  def: SurveyDefinition,
  stillInvitable: Set<string>,
  tally: SendTally,
  deadline: number,
  now = new Date(),
): Promise<void> {
  const { data, error } = await db
    .from('survey_invitations')
    .select('*, survey_responses(last_saved_at)')
    .eq('distribution_id', d.id)
    .in('status', ['sent', 'opened', 'started'])
    .is('reminders_opted_out_at', null)
    .limit(1000)
  if (error) throw new Error(`Reading invitations for reminders failed: ${error.message}`)

  for (const row of (data ?? []) as (InvitationRow & { survey_responses: { last_saved_at: string | null }[] | { last_saved_at: string | null } | null })[]) {
    if (tally.quotaHit) break
    if (!stillInvitable.has(row.recipient_key)) continue
    const resp = Array.isArray(row.survey_responses) ? row.survey_responses[0] : row.survey_responses
    const kind = dueReminder(row, d, now, resp?.last_saved_at ?? null)
    if (!kind) continue
    if (Date.now() > deadline) {
      tally.deferred++
      continue
    }
    if (!(await claimBudget(db, now))) {
      tally.deferred++
      continue
    }
    if (!(await claimReminder(db, row, kind, now))) continue
    try {
      await deliver(row, d, def, kind)
      tally.reminded++
    } catch (err) {
      tally.failed++
      if (err instanceof EmailSendError && err.isQuota) tally.quotaHit = true
    }
  }
}

async function claimReminder(db: SupabaseClient, inv: InvitationRow, kind: ReminderKind, now: Date): Promise<boolean> {
  const patch =
    kind === 'resume'
      ? { resume_reminder_count: inv.resume_reminder_count + 1, last_reminder_at: now.toISOString() }
      : { reminder_count: kind === 'closing' ? 3 : inv.reminder_count + 1, last_reminder_at: now.toISOString() }
  let q = db.from('survey_invitations').update(patch).eq('id', inv.id)
  q = kind === 'resume' ? q.eq('resume_reminder_count', inv.resume_reminder_count) : q.eq('reminder_count', inv.reminder_count)
  q = inv.last_reminder_at ? q.eq('last_reminder_at', inv.last_reminder_at) : q.is('last_reminder_at', null)
  const { data } = await q.select('id')
  return !!data?.length
}

/** Admin "resend" to one person: the invitation again, outside the cadence. */
export async function resendInvitation(db: SupabaseClient, inv: InvitationRow, d: DistributionRow, def: SurveyDefinition): Promise<{ ok: boolean; error?: string }> {
  if (inv.status === 'submitted') return { ok: false, error: 'Already submitted.' }
  if (!(await claimBudget(db))) return { ok: false, error: 'Today’s survey email budget is spent. Try again tomorrow.' }
  try {
    await deliver(inv, d, def, inv.status === 'started' ? 'resume' : 'invite')
    await db
      .from('survey_invitations')
      .update({
        status: inv.status === 'queued' || inv.status === 'bounced' || inv.status === 'expired' ? 'sent' : inv.status,
        sent_at: inv.sent_at ?? new Date().toISOString(),
        last_send_error: null,
      })
      .eq('id', inv.id)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** The QR page's "email me my link": the same link, to the address on file. */
export async function sendLinkEmail(db: SupabaseClient, inv: InvitationRow, d: DistributionRow, def: SurveyDefinition): Promise<boolean> {
  if (!(await claimBudget(db))) return false
  try {
    await deliver(inv, d, def, 'link')
    return true
  } catch {
    return false
  }
}
