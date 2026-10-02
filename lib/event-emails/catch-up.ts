// Late-registrant catch-ups. When someone registers after an "All participants"
// email has gone out, they (and their parent/guardian, if that email went to
// guardians too) get the same email, unchanged. Each catch-up is recorded as its
// own History row (trigger 'catch_up').
//
// Who is owed it is worked out fresh each time: everyone the email would reach
// today, less every address any earlier send of it already tried, including
// earlier catch-ups. So one copy per address, ever. A sibling's parent who already
// has it is not emailed again. Addresses that failed earlier are not retried
// here; those failures show in History.
//
// Catch-ups run until the end of event day (Mountain time). Two things trigger
// them: the event-emails cron (three daily slots) and the "Send to late
// registrants" button on a sent email.

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveAudience, type ResolvedRecipient } from './audiences'
import { daysUntil } from './schedule'
import { todayInMountain } from './render'
import { deliver, loadAttachments, loadEventForEmail, type SendOutcome } from './send'
import { MAX_RECIPIENTS_PER_SEND, type AudienceKey, type EventEmailRow, type RecipientRole } from './types'

/** A claim older than this belongs to a run that died; the next run may take it. */
const LEASE_MS = 5 * 60_000

/**
 * The groups a catch-up goes to. Only emails sent to All participants qualify,
 * and only the participant and guardian parts are caught up. Mentors and
 * "outstanding" chasers are about state at the time, not a missed announcement.
 */
export function catchUpAudiences(audiences: readonly AudienceKey[]): AudienceKey[] {
  if (!audiences.includes('participants')) return []
  return audiences.filter((a): a is AudienceKey => a === 'participants' || a === 'guardians')
}

/** Open through the event day itself; closed once it has passed, or with no date. */
export function catchUpOpen(eventDate: string | null | undefined, today: string): boolean {
  return !!eventDate && daysUntil(eventDate, today) >= 0
}

export function missedRecipients(recipients: ResolvedRecipient[], alreadyTried: Set<string>): ResolvedRecipient[] {
  return recipients.filter((r) => !alreadyTried.has(r.email.toLowerCase()))
}

/** Every address a real (non-test) send of this email has already tried. */
export async function alreadyTriedAddresses(db: SupabaseClient, emailId: string): Promise<Set<string>> {
  const { data, error } = await db
    .from('event_email_sends')
    .select('recipients')
    .eq('event_email_id', emailId)
    .neq('trigger', 'test')
  // Never guess on a failed read: an empty set would email everyone again.
  if (error) throw new Error(`Could not read send history: ${error.message}`)
  const out = new Set<string>()
  for (const row of data ?? []) {
    for (const r of (row.recipients as { email?: string }[] | null) ?? []) {
      if (r?.email) out.add(r.email.toLowerCase())
    }
  }
  return out
}

export interface CatchUpStatus {
  eligible: boolean
  open: boolean
  audiences: AudienceKey[]
  pending: { email: string; name: string; roles: RecipientRole[] }[]
}

/** Who a catch-up would reach right now, for the tab. Read-only. */
export async function catchUpStatus(db: SupabaseClient, email: EventEmailRow): Promise<CatchUpStatus> {
  const audiences = catchUpAudiences(email.audiences)
  const base = { eligible: email.status === 'sent' && audiences.length > 0, audiences }
  if (!base.eligible) return { ...base, open: false, pending: [] }

  const event = await loadEventForEmail(email.event_slug)
  const open = catchUpOpen(event?.date, todayInMountain())
  if (!event || !open) return { ...base, open: false, pending: [] }

  const [{ recipients }, tried] = await Promise.all([
    resolveAudience(db, event, audiences),
    alreadyTriedAddresses(db, email.id),
  ])
  const pending = missedRecipients(recipients, tried).map((r) => ({ email: r.email, name: r.name, roles: r.roles }))
  return { ...base, open, pending }
}

export type CatchUpOutcome = SendOutcome | { ok: true; sendId: null; recipients: 0; sent: 0; failed: 0; docusignResent: 0 }

/**
 * Sends a sent email to everyone who has registered since and not had it.
 * Nobody owed → no History row. More than one send can carry → the first
 * MAX_RECIPIENTS_PER_SEND now, the rest on the next run.
 */
export async function sendCatchUp(
  db: SupabaseClient,
  emailId: string,
  opts: { triggeredBy?: string | null; spacingMs?: number; today?: string } = {},
): Promise<CatchUpOutcome> {
  const { data: row } = await db.from('event_emails').select('*').eq('id', emailId).maybeSingle()
  const email = row as EventEmailRow | null
  if (!email) return { ok: false, status: 404, error: 'Email not found' }
  if (email.status !== 'sent') return { ok: false, status: 400, error: 'Only a sent email can be caught up' }
  const audiences = catchUpAudiences(email.audiences)
  if (!audiences.length) return { ok: false, status: 400, error: 'Only emails sent to All participants are caught up' }

  const event = await loadEventForEmail(email.event_slug)
  if (!event) return { ok: false, status: 404, error: 'Event not found' }
  if (!catchUpOpen(event.date, opts.today ?? todayInMountain())) {
    return { ok: false, status: 400, error: 'The event has passed — catch-ups have stopped' }
  }

  // ── Claim a short lease so the cron and a click can't both send it ─────────
  const stale = new Date(Date.now() - LEASE_MS).toISOString()
  const { data: claimed } = await db
    .from('event_emails')
    .update({ catch_up_claimed_at: new Date().toISOString() })
    .eq('id', email.id)
    .or(`catch_up_claimed_at.is.null,catch_up_claimed_at.lt.${stale}`)
    .select('id')
  if (!claimed?.length) return { ok: false, status: 409, error: 'A catch-up for this email is already sending' }

  try {
    const [{ recipients }, tried] = await Promise.all([
      resolveAudience(db, event, audiences),
      alreadyTriedAddresses(db, email.id),
    ])
    const owed = missedRecipients(recipients, tried).slice(0, MAX_RECIPIENTS_PER_SEND)
    if (!owed.length) return { ok: true, sendId: null, recipients: 0, sent: 0, failed: 0, docusignResent: 0 }

    const attachments = await loadAttachments(db, email)
    const { sendId, sent, failed } = await deliver(db, email, event, owed, {
      trigger: 'catch_up',
      triggeredBy: opts.triggeredBy ?? null,
      audiences,
      attachments,
      spacingMs: opts.spacingMs,
    })
    return { ok: true, sendId, recipients: owed.length, sent, failed, docusignResent: 0 }
  } catch (err) {
    console.error(`[event-emails] catch-up ${email.id} failed:`, err)
    return { ok: false, status: 500, error: err instanceof Error ? err.message : 'Catch-up failed' }
  } finally {
    await db.from('event_emails').update({ catch_up_claimed_at: null }).eq('id', email.id)
  }
}

/**
 * The cron's half: every sent All-participants email whose event hasn't passed.
 * `eventDate` is the cron's per-slug cache. Stops starting new catch-ups once
 * `budgetLeft()` says the function is nearly out of time.
 */
export async function runCatchUps(
  db: SupabaseClient,
  eventDate: (slug: string) => Promise<string | null>,
  budgetLeft: () => boolean,
  today = todayInMountain(),
): Promise<{ checked: number; emailed: number; deferred: number; errors: { id: string; error: string }[] }> {
  const out = { checked: 0, emailed: 0, deferred: 0, errors: [] as { id: string; error: string }[] }
  const { data: rows, error } = await db
    .from('event_emails')
    .select('id, event_slug')
    .eq('status', 'sent')
    .contains('audiences', ['participants'])
    .order('sent_at', { ascending: true })
  if (error) {
    out.errors.push({ id: 'query', error: error.message })
    return out
  }

  for (const row of rows ?? []) {
    if (!catchUpOpen(await eventDate(row.event_slug as string), today)) continue
    if (!budgetLeft()) {
      out.deferred++
      continue
    }
    out.checked++
    const r = await sendCatchUp(db, row.id as string, { triggeredBy: 'schedule', today })
    if (!r.ok) {
      if (r.status !== 409) out.errors.push({ id: row.id as string, error: r.error })
    } else {
      out.emailed += r.sent
    }
  }
  return out
}
