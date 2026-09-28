// Sends one event email: manual ("Send now"), scheduled (the daily cron), or a
// test to the person pressing the button.
//
// The row is CLAIMED before anything goes out — draft/scheduled → sending in a
// single conditional UPDATE — so a cron run and a click (or two clicks) can
// never both send it. Every send, including a test, lands in event_email_sends.

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'
import { RESOURCES_BUCKET } from '@/lib/community'
import { getEventBySlug } from '@/lib/sanity'
import { reissueParticipantAgreement } from '@/lib/docusign-reissue'
import { resolveAudience, type ResolvedRecipient } from './audiences'
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

export type SendTrigger = 'manual' | 'schedule' | 'test'

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

async function loadAttachments(db: SupabaseClient, email: EventEmailRow) {
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
  opts: { trigger: SendTrigger; triggeredBy?: string | null; testTo?: string; spacingMs?: number },
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
    const { data: claimed } = await db
      .from('event_emails')
      .update({ status: 'sending' })
      .eq('id', email.id)
      .in('status', ['draft', 'scheduled'])
      .select('id')
    if (!claimed?.length) return { ok: false, status: 409, error: 'This email has already been sent (or is sending now)' }
  }
  const release = async (status: EventEmailStatus, extra: Record<string, unknown> = {}) => {
    if (!isTest) await db.from('event_emails').update({ status, ...extra }).eq('id', email.id)
  }

  try {
    const audience = await resolveAudience(db, event, email.audiences, { mintPayLinks: !isTest })
    let recipients: ResolvedRecipient[] = audience.recipients

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
    let docusignResent = 0
    if (!isTest && email.resend_docusign && audience.docusignParticipantIds.length) {
      for (const pid of audience.docusignParticipantIds) {
        try {
          const r = await reissueParticipantAgreement(db, pid, { eventSlug: event.slug, allowNewEnvelope: false })
          if (r.kind === 'resent') docusignResent++
        } catch (err) {
          console.error(`[event-emails] DocuSign resend failed for participant ${pid}:`, err)
        }
      }
    }

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
        audiences: email.audiences,
        trigger: opts.trigger,
        triggered_by: opts.triggeredBy ?? null,
        recipient_count: recipients.length,
        docusign_resent: docusignResent,
      })
      .select('id')
      .single()

    const results: { email: string; name: string; roles: string[]; status: 'sent' | 'failed'; error?: string }[] = []
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
          attachments,
        })
        results.push({ email: r.email, name: r.name, roles: r.roles, status: 'sent' })
      } catch (err) {
        results.push({ email: r.email, name: r.name, roles: r.roles, status: 'failed', error: err instanceof Error ? err.message.slice(0, 300) : String(err) })
      }
    }

    const sent = results.filter((r) => r.status === 'sent').length
    const failed = results.length - sent
    if (sendRow?.id) {
      await db
        .from('event_email_sends')
        .update({ sent_count: sent, failed_count: failed, recipients: results, finished_at: new Date().toISOString() })
        .eq('id', sendRow.id)
    }
    await release('sent', { sent_at: new Date().toISOString() })

    return { ok: true, sendId: (sendRow?.id as string) ?? '', recipients: recipients.length, sent, failed, docusignResent }
  } catch (err) {
    // Nothing (or not everything) went out: put the email back where it was so
    // it can be fixed and retried, rather than stranded in 'sending'.
    console.error(`[event-emails] send ${email.id} failed:`, err)
    await release(priorStatus)
    return { ok: false, status: 500, error: err instanceof Error ? err.message : 'Send failed' }
  }
}
