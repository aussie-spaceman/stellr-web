// Sends one event email: manual ("Send now"), scheduled (the daily cron), or a
// test to the person pressing the button.
//
// The row is CLAIMED before anything goes out — draft/scheduled → sending in a
// single conditional UPDATE — so a cron run and a click (or two clicks) can
// never both send it. Every send, including a test, lands in event_email_sends.

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'
import { extractTokens } from '@/lib/email-render'
import { RESOURCES_BUCKET } from '@/lib/community'
import { getEventBySlug } from '@/lib/sanity'
import { reissueParticipantAgreement } from '@/lib/docusign-reissue'
import { resolveAudience, type ResolvedRecipient } from './audiences'
import { alreadyTriedAddresses, missedRecipients } from './history'
import {
  EVENT_EMAIL_FROM,
  EVENT_EMAIL_REPLY_TO,
  eventMergeVars,
  recipientMergeVars,
  renderEventEmail,
  unknownTokens,
  type EventForEmail,
} from './render'
import { MAX_RECIPIENTS_PER_SEND, type EventEmailRow, type EventEmailStatus } from './types'

/** Resend's default limit is 2 requests/second per team. */
const SEND_SPACING_MS = 550

// deep review INT-1: a send runs inside a ≤60s function. If it is killed
// mid-flight the row is left in 'sending' and nothing ever completes it — the
// admin PATCH refuses with 409 and the cron only picks up 'scheduled'. A row
// still 'sending' this long after the claim is treated as abandoned and
// re-driven by the cron (reclaimStuckSending). 10 minutes is far longer than
// the 60s budget, so a healthy in-progress send is never reclaimed. The
// event_emails.updated_at trigger makes the reclaiming UPDATE a safe
// compare-and-swap: taking the row bumps updated_at, so a second run no longer
// matches `updated_at < stale`.
const SENDING_STALE_MS = 10 * 60_000

export type SendTrigger = 'manual' | 'schedule' | 'test' | 'catch_up'

export type SendOutcome =
  | { ok: true; sendId: string; recipients: number; sent: number; failed: number; docusignResent: number }
  | { ok: false; status: number; error: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function loadEventForEmail(slug: string): Promise<EventForEmail | null> {
  const e = (await getEventBySlug(slug)) as
    | { title: string; date?: string; venue?: string; city?: string; state?: string; startTime?: string; endTime?: string }
    | null
  if (!e) return null
  return { slug, title: e.title, date: e.date, venue: e.venue, city: e.city, state: e.state, startTime: e.startTime, endTime: e.endTime }
}

export async function loadAttachments(db: SupabaseClient, email: EventEmailRow) {
  const out: { filename: string; content: string; contentType?: string }[] = []
  for (const a of email.attachments ?? []) {
    const { data, error } = await db.storage.from(RESOURCES_BUCKET).download(a.path)
    if (error || !data) throw new Error(`Attachment “${a.filename}” could not be read`)
    out.push({
      filename: a.filename,
      content: Buffer.from(await data.arrayBuffer()).toString('base64'),
      contentType: a.contentType,
    })
  }
  return out
}

export async function sendEventEmail(
  db: SupabaseClient,
  emailId: string,
  opts: {
    trigger: Exclude<SendTrigger, 'catch_up'>
    triggeredBy?: string | null
    testTo?: string
    spacingMs?: number
    // deep review INT-1: set by reclaimStuckSending to re-drive a row abandoned
    // in 'sending'. The claim then takes a stale 'sending' row (instead of a
    // draft/scheduled one) and the send resumes, skipping addresses already
    // emailed by the killed run.
    resume?: boolean
  },
): Promise<SendOutcome> {
  const { data: row } = await db.from('event_emails').select('*').eq('id', emailId).maybeSingle()
  const email = row as EventEmailRow | null
  if (!email) return { ok: false, status: 404, error: 'Email not found' }

  const bad = unknownTokens(email.subject, email.body_json)
  if (bad.length) return { ok: false, status: 400, error: `Unknown merge field${bad.length > 1 ? 's' : ''}: ${bad.map((t) => `{{${t}}}`).join(', ')}` }
  if (!email.subject.trim()) return { ok: false, status: 400, error: 'Add a subject first' }
  if (!email.audiences.length) return { ok: false, status: 400, error: 'Choose at least one group to send to' }

  const event = await loadEventForEmail(email.event_slug)
  if (!event) return { ok: false, status: 404, error: 'Event not found' }

  const isTest = opts.trigger === 'test'
  if (isTest && !opts.testTo) return { ok: false, status: 400, error: 'No address to send the test to' }

  // ── Claim ───────────────────────────────────────────────────────────────────
  const priorStatus: EventEmailStatus = email.status
  if (!isTest) {
    if (opts.resume) {
      // Re-take a row abandoned in 'sending'. Only a row that has been 'sending'
      // longer than SENDING_STALE_MS matches, and the updated_at trigger bumps
      // the timestamp as we take it, so two concurrent reclaims can't both win.
      const stale = new Date(Date.now() - SENDING_STALE_MS).toISOString()
      const { data: claimed } = await db
        .from('event_emails')
        .update({ status: 'sending' })
        .eq('id', email.id)
        .eq('status', 'sending')
        .lt('updated_at', stale)
        .select('id')
      if (!claimed?.length) return { ok: false, status: 409, error: 'This email is not a stale send to resume' }
    } else {
      const { data: claimed } = await db
        .from('event_emails')
        .update({ status: 'sending' })
        .eq('id', email.id)
        .in('status', ['draft', 'scheduled'])
        .select('id')
      if (!claimed?.length) return { ok: false, status: 409, error: 'This email has already been sent (or is sending now)' }
    }
  }
  const release = async (status: EventEmailStatus, extra: Record<string, unknown> = {}) => {
    if (!isTest) await db.from('event_emails').update({ status, ...extra }).eq('id', email.id)
  }

  try {
    const audience = await resolveAudience(db, event, email.audiences, { mintPayLinks: !isTest })
    let recipients: ResolvedRecipient[] = audience.recipients

    // deep review INT-1: skip anyone a prior (non-test) send of this email
    // already tried. For a fresh send this set is empty; for a resumed stuck
    // send it is the addresses the killed run already emailed, so nobody is
    // emailed twice. Covers every non-test trigger, not just catch-ups.
    if (!isTest) {
      const tried = await alreadyTriedAddresses(db, email.id)
      if (tried.size) recipients = missedRecipients(recipients, tried)
    }

    if (!isTest && recipients.length > MAX_RECIPIENTS_PER_SEND) {
      await release(priorStatus)
      return {
        ok: false,
        status: 400,
        error: `${recipients.length} recipients is more than one send can handle (${MAX_RECIPIENTS_PER_SEND}). Split the groups across two emails.`,
      }
    }
    if (!isTest && recipients.length === 0 && opts.trigger === 'manual') {
      await release(priorStatus)
      return { ok: false, status: 400, error: 'Nobody matches these groups right now — nothing was sent' }
    }

    const attachments = await loadAttachments(db, email)

    // A test goes to the sender, rendered as the first real recipient would see it.
    if (isTest) {
      const sample = recipients[0]
      recipients = [{
        ...(sample ?? { firstName: 'there', roles: [], participantNames: [], isParticipant: true, payments: [], reasons: [] }),
        email: opts.testTo!,
        name: opts.testTo!,
      } as ResolvedRecipient]
    }

    // DocuSign first, so "we've just re-sent it" is true when the email lands.
    // An email carrying {{agreement_link}} is itself the Stellr signing
    // reminder, so those families are not sent a second signing email.
    let docusignResent = 0
    const carriesLink = [...extractTokens(email.subject), ...extractTokens(JSON.stringify(email.body_json ?? ''))]
      .includes('agreement_link')
    const skip = new Set(carriesLink ? audience.nativeParticipantIds ?? [] : [])
    if (!isTest && email.resend_docusign && audience.docusignParticipantIds.length) {
      for (const pid of audience.docusignParticipantIds.filter((id) => !skip.has(id))) {
        try {
          const r = await reissueParticipantAgreement(db, pid, { eventSlug: event.slug, allowNewEnvelope: false })
          if (r.kind === 'resent') docusignResent++
        } catch (err) {
          console.error(`[event-emails] DocuSign resend failed for participant ${pid}:`, err)
        }
      }
    }

    const { sendId, sent, failed } = await deliver(db, email, event, recipients, {
      trigger: opts.trigger,
      triggeredBy: opts.triggeredBy,
      audiences: email.audiences,
      attachments,
      docusignResent,
      spacingMs: opts.spacingMs,
    })
    await release('sent', { sent_at: new Date().toISOString() })

    return { ok: true, sendId, recipients: recipients.length, sent, failed, docusignResent }
  } catch (err) {
    // Nothing (or not everything) went out: put the email back where it was so
    // it can be fixed and retried, rather than stranded in 'sending'.
    console.error(`[event-emails] send ${email.id} failed:`, err)
    await release(priorStatus)
    return { ok: false, status: 500, error: err instanceof Error ? err.message : 'Send failed' }
  }
}

/**
 * Emails each recipient one at a time (Resend's rate limit) and records the
 * run in event_email_sends. Shared by a normal send and a late-registrant
 * catch-up, so both read the same in History.
 */
export async function deliver(
  db: SupabaseClient,
  email: EventEmailRow,
  event: EventForEmail,
  recipients: ResolvedRecipient[],
  opts: {
    trigger: SendTrigger
    triggeredBy?: string | null
    audiences: EventEmailRow['audiences']
    attachments: Awaited<ReturnType<typeof loadAttachments>>
    docusignResent?: number
    spacingMs?: number
  },
): Promise<{ sendId: string; sent: number; failed: number }> {
  const isTest = opts.trigger === 'test'
  const eventVars = eventMergeVars(event)
  // History shows the subject as it went out (first recipient's rendering),
  // not the template with its {{fields}}.
  let sentSubject = email.subject
  try {
    if (recipients[0]) sentSubject = renderEventEmail(email, { ...eventVars, ...recipientMergeVars(recipients[0]) }).subject
  } catch { /* keep the template subject */ }

  const { data: sendRow } = await db
    .from('event_email_sends')
    .insert({
      event_email_id: email.id,
      event_slug: email.event_slug,
      email_name: email.name,
      subject: sentSubject,
      audiences: opts.audiences,
      trigger: opts.trigger,
      triggered_by: opts.triggeredBy ?? null,
      recipient_count: recipients.length,
      docusign_resent: opts.docusignResent ?? 0,
    })
    .select('id')
    .single()

  const results: { email: string; name: string; roles: string[]; status: 'sent' | 'failed'; error?: string }[] = []
  // deep review INT-1: persist progress after EACH recipient, not only at the
  // end. A send runs in a ≤60s function; if it is killed mid-loop the earlier
  // write means every address already tried is on the row, so a re-run
  // (resumed stuck send, or the next catch-up) skips them instead of emailing
  // them again. Best-effort: a failed progress write never aborts the send, and
  // the authoritative counts land in the final update below.
  const persistProgress = async () => {
    if (!sendRow?.id) return
    try {
      await db.from('event_email_sends').update({ recipients: results }).eq('id', sendRow.id)
    } catch (err) {
      console.error(`[event-emails] progress write failed for send ${sendRow.id}:`, err)
    }
  }
  for (const [i, r] of recipients.entries()) {
    if (i > 0) await sleep(opts.spacingMs ?? SEND_SPACING_MS)
    try {
      const content = renderEventEmail(email, { ...eventVars, ...recipientMergeVars(r) })
      await sendEmail({
        to: r.email,
        from: EVENT_EMAIL_FROM,
        replyTo: EVENT_EMAIL_REPLY_TO,
        subject: isTest ? `[TEST] ${content.subject}` : content.subject,
        html: content.html,
        text: content.text,
        attachments: opts.attachments,
      })
      results.push({ email: r.email, name: r.name, roles: r.roles, status: 'sent' })
    } catch (err) {
      results.push({ email: r.email, name: r.name, roles: r.roles, status: 'failed', error: err instanceof Error ? err.message.slice(0, 300) : String(err) })
    }
    await persistProgress()
  }

  const sent = results.filter((r) => r.status === 'sent').length
  const failed = results.length - sent
  if (sendRow?.id) {
    await db
      .from('event_email_sends')
      .update({ sent_count: sent, failed_count: failed, recipients: results, finished_at: new Date().toISOString() })
      .eq('id', sendRow.id)
  }
  return { sendId: (sendRow?.id as string) ?? '', sent, failed }
}

/**
 * deep review INT-1: re-drive event emails abandoned in 'sending' by a killed
 * function. Without this a scheduled send cut off at the 60s budget would stay
 * 'sending' forever — the admin PATCH refuses with 409 and the cron only picks
 * up 'scheduled' rows, so the recipients after the cut-off would never get it
 * and no catch-up would ever reach them. The resumed send skips addresses the
 * killed run already emailed (see sendEventEmail's alreadyTried subtraction),
 * so nobody is emailed twice. Called from the cron after the scheduled sends.
 */
export async function reclaimStuckSending(
  db: SupabaseClient,
  budgetLeft: () => boolean,
): Promise<{ reclaimed: number; errors: { id: string; error: string }[] }> {
  const out = { reclaimed: 0, errors: [] as { id: string; error: string }[] }
  const stale = new Date(Date.now() - SENDING_STALE_MS).toISOString()
  const { data: rows, error } = await db
    .from('event_emails')
    .select('id')
    .eq('status', 'sending')
    .lt('updated_at', stale)
    .order('updated_at', { ascending: true })
  if (error) {
    out.errors.push({ id: 'query', error: error.message })
    return out
  }
  for (const row of rows ?? []) {
    if (!budgetLeft()) break
    const r = await sendEventEmail(db, row.id as string, { trigger: 'schedule', triggeredBy: 'resume', resume: true })
    // 409 just means another run took it first — not an error.
    if (r.ok) out.reclaimed++
    else if (r.status !== 409) out.errors.push({ id: row.id as string, error: r.error })
  }
  return out
}
