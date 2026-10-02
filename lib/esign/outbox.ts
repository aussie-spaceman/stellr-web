import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail, EmailSendError } from '@/lib/email'
import { SITE_URL } from '@/lib/env'
import { appendAuditQuietly } from '@/lib/esign/native/audit'
import { mintToken, signingUrl } from '@/lib/esign/native/tokens'
import { signatureRequestEmail } from '@/lib/esign/emails'
import type { NativeRecipient } from '@/lib/esign/native/flow'

// Signing emails go through a daily budget. Resend's free plan allows 100
// emails a day for everything Stellr sends; signing takes at most
// ESIGN_DAILY_EMAIL_BUDGET of them (default 60), leaving the rest for payment
// links, confirmations and alerts. What does not fit waits here, guardians
// first, and goes out with the next send: the daily crons, any signing
// activity, an admin opening the consent-forms page, or "Send now".

const DEFAULT_DAILY_BUDGET = 60

export function dailyBudget(): number {
  const n = Number(process.env.ESIGN_DAILY_EMAIL_BUDGET)
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_DAILY_BUDGET
}

const today = (now = new Date()) => now.toISOString().slice(0, 10)

/** Claims one send from today's budget. False when the day's allowance is used. */
async function claimSend(db: SupabaseClient, now = new Date()): Promise<boolean> {
  const { data, error } = await db.rpc('esign_claim_email', { p_day: today(now), p_limit: dailyBudget() })
  if (error) {
    console.error('[esign-outbox] budget claim failed:', error.message)
    return false
  }
  return data === true
}

const DOCUMENT_LABEL: Record<string, string> = {
  minor: 'Parental Consent Form',
  adult: 'Participation Agreement',
  mentor: 'Mentor Participation Agreement',
  volunteer: 'Mentor Participation Agreement',
  membership: 'Membership Agreement',
}

const ROLE: Record<string, 'guardian' | 'student' | 'adult' | 'mentor' | 'member'> = {
  Guardian: 'guardian', Minor: 'student', Adult: 'adult', Mentor: 'mentor', Member: 'member',
}

interface EnvelopeForEmail {
  id: string
  envelope_type: string
  event_title: string | null
  minor_name: string | null
  status: string
  prefill: Record<string, string> | null
}

/** A link the signer can use right now, e.g. to sign straight after joining. */
export function signNowUrlFor(r: Pick<NativeRecipient, 'id' | 'token_version' | 'token_expires_at'>, now = Date.now()): string {
  const ttl = r.token_expires_at
    ? Math.max(60, Math.floor((new Date(r.token_expires_at).getTime() - now) / 1000))
    : 30 * 24 * 60 * 60
  return signingUrl(SITE_URL, mintToken(r.id, 'sign', r.token_version, ttl, now).token)
}

export interface SendResult {
  sent: number
  deferred: number
  failed: number
}

/**
 * Emails each signer their link, while today's budget lasts. Never throws: a
 * signer whose email could not go is left in the outbox (invite_sent_at null)
 * for the next send.
 */
export async function sendInvites(
  db: SupabaseClient,
  recipients: NativeRecipient[],
  opts: { reminder?: boolean; now?: Date } = {},
): Promise<SendResult> {
  const now = opts.now ?? new Date()
  const result: SendResult = { sent: 0, deferred: 0, failed: 0 }
  // Guardians (routing order 1) before anyone else.
  const queue = [...recipients].sort((a, b) => a.routing_order - b.routing_order)
  const envelopes = new Map<string, EnvelopeForEmail | null>()

  for (let i = 0; i < queue.length; i++) {
    const r = queue[i]
    if (!(await claimSend(db, now))) {
      result.deferred += queue.length - i
      if (opts.reminder) {
        // Put the rest back in the outbox, so they still hear from us.
        await db.from('docusign_envelope_recipients').update({ invite_sent_at: null }).in('id', queue.slice(i).map((q) => q.id))
      }
      break
    }

    if (!envelopes.has(r.envelope_row)) {
      const { data } = await db
        .from('docusign_envelopes')
        .select('id, envelope_type, event_title, minor_name, status, prefill')
        .eq('id', r.envelope_row)
        .maybeSingle()
      envelopes.set(r.envelope_row, (data as EnvelopeForEmail | null) ?? null)
    }
    const env = envelopes.get(r.envelope_row)
    if (!env || !['sent', 'delivered'].includes(env.status)) continue

    const role = ROLE[r.role_name] ?? 'adult'
    const expiresAt = r.token_expires_at ?? new Date(now.getTime() + 30 * 86_400_000).toISOString()
    const content = signatureRequestEmail({
      role,
      recipientName: r.name,
      documentLabel: DOCUMENT_LABEL[env.envelope_type] ?? 'Agreement',
      eventTitle: env.event_title,
      subjectName: role === 'guardian' ? (env.prefill?.MinorName || env.prefill?.MemberName || env.minor_name) : null,
      url: signNowUrlFor({ ...r, token_expires_at: expiresAt }, now.getTime()),
      expiresAt,
      reminder: !!opts.reminder,
      afterGuardian: role === 'student' || (role === 'member' && r.routing_order > 1),
    })

    try {
      const sent = await sendEmail({ to: r.email, ...content })
      await db
        .from('docusign_envelope_recipients')
        .update({ invite_sent_at: now.toISOString(), invite_email_id: sent.id, invite_error: null, invite_attempts: 0 })
        .eq('id', r.id)
      await appendAuditQuietly(db, {
        envelopeRow: r.envelope_row,
        recipientRow: r.id,
        event: 'invite_sent',
        detail: { reminder: !!opts.reminder, emailId: sent.id },
      })
      result.sent++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await db
        .from('docusign_envelope_recipients')
        .update({ invite_sent_at: null, invite_attempts: ((r as { invite_attempts?: number }).invite_attempts ?? 0) + 1, invite_error: message.slice(0, 500) })
        .eq('id', r.id)
      result.failed++
      // Resend's rate limit or daily quota: everything after this would fail too.
      if (err instanceof EmailSendError && err.isQuota) {
        result.deferred += queue.length - i - 1
        break
      }
    }
  }
  return result
}

/** Sends what is waiting in the outbox, oldest and guardians first. */
export async function drainOutbox(db: SupabaseClient, opts: { limit?: number; now?: Date } = {}): Promise<SendResult & { waiting: number }> {
  const { data, error } = await db
    .from('docusign_envelope_recipients')
    .select('id, envelope_row, recipient_id, role_name, name, email, status, routing_order, member_id, token_version, token_expires_at, invite_sent_at, invite_attempts, envelope:docusign_envelopes!inner(provider, status)')
    .eq('status', 'sent')
    .is('invite_sent_at', null)
    .eq('envelope.provider', 'native')
    .in('envelope.status', ['sent', 'delivered'])
    .order('routing_order', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(opts.limit ?? 50)
  if (error) throw new Error(`Outbox query failed: ${error.message}`)
  const waiting = (data ?? []) as unknown as NativeRecipient[]
  if (!waiting.length) return { sent: 0, deferred: 0, failed: 0, waiting: 0 }
  const result = await sendInvites(db, waiting, { now: opts.now })
  return { ...result, waiting: waiting.length }
}

/** Signing emails waiting to go out. */
export async function outboxDepth(db: SupabaseClient): Promise<number> {
  const { count } = await db
    .from('docusign_envelope_recipients')
    .select('id, envelope:docusign_envelopes!inner(provider, status)', { count: 'exact', head: true })
    .eq('status', 'sent')
    .is('invite_sent_at', null)
    .eq('envelope.provider', 'native')
    .in('envelope.status', ['sent', 'delivered'])
  return count ?? 0
}
