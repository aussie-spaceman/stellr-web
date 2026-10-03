import { AGREEMENT_TITLE } from '@/lib/esign/native/plan'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail, EmailSendError } from '@/lib/email'
import { SITE_URL } from '@/lib/env'
import { appendAuditQuietly } from '@/lib/esign/native/audit'
import { mintToken, signingUrl } from '@/lib/esign/native/tokens'
import { signatureBundleEmail, signatureRequestEmail } from '@/lib/esign/emails'
import type { NativeRecipient } from '@/lib/esign/native/flow'

// Signing emails go through a daily budget. Resend's free plan allows 100
// emails a day for everything Stellr sends; signing takes at most
// ESIGN_DAILY_EMAIL_BUDGET of them (default 60), leaving the rest for payment
// links, confirmations and alerts. What does not fit waits here, guardians
// first, and goes out with the next send: the daily crons, any signing
// activity, an admin opening the consent-forms page, or "Send now".
//
// A parent with several forms waiting (siblings in one registration) gets one
// email with a link for each, which also spends one send rather than several.

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

// The documents' own titles (V2.3).
const DOCUMENT_LABEL: Record<string, string> = {
  minor: AGREEMENT_TITLE.minor,
  adult: AGREEMENT_TITLE.adult,
  mentor: AGREEMENT_TITLE.mentor,
  volunteer: AGREEMENT_TITLE.mentor,
  membership: AGREEMENT_TITLE.membership,
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

// ── Batching ─────────────────────────────────────────────────────────────────
//
// A group registration issues one agreement per participant, one after
// another. Sent as they are issued, a parent of two would get two emails.
// Inside batchInvites the invitations wait (they are already in the outbox)
// and go out together at the end, grouped by address.

const batch = new AsyncLocalStorage<NativeRecipient[]>()

export async function batchInvites<T>(db: SupabaseClient, fn: () => Promise<T>): Promise<T> {
  if (batch.getStore()) return fn() // already batching: the outer call sends
  const held: NativeRecipient[] = []
  try {
    return await batch.run(held, fn)
  } finally {
    if (held.length) {
      await sendInvites(db, held).catch((err) => {
        // They stay in the outbox for the next drain.
        console.error('[esign-outbox] batched send failed:', err instanceof Error ? err.message : err)
      })
    }
  }
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
  const held = batch.getStore()
  if (held && !opts.reminder) {
    held.push(...recipients)
    return { sent: 0, deferred: recipients.length, failed: 0 }
  }

  const now = opts.now ?? new Date()
  const result: SendResult = { sent: 0, deferred: 0, failed: 0 }
  const envelopes = new Map<string, EnvelopeForEmail | null>()
  const envelopeFor = async (id: string) => {
    if (!envelopes.has(id)) {
      const { data } = await db
        .from('agreements')
        .select('id, envelope_type, event_title, minor_name, status, prefill')
        .eq('id', id)
        .maybeSingle()
      envelopes.set(id, (data as EnvelopeForEmail | null) ?? null)
    }
    return envelopes.get(id) ?? null
  }

  // One email per unit: a parent's forms together, everyone else on their own.
  // Guardians (routing order 1) first.
  const units: NativeRecipient[][] = []
  const byParent = new Map<string, NativeRecipient[]>()
  for (const r of [...recipients].sort((a, b) => a.routing_order - b.routing_order)) {
    if (ROLE[r.role_name] !== 'guardian') { units.push([r]); continue }
    const key = r.email.trim().toLowerCase()
    const unit = byParent.get(key)
    if (unit) unit.push(r)
    else { const u = [r]; byParent.set(key, u); units.push(u) }
  }
  const remaining = (from: number) => units.slice(from).reduce((n, u) => n + u.length, 0)

  for (let i = 0; i < units.length; i++) {
    const live: { r: NativeRecipient; env: EnvelopeForEmail }[] = []
    for (const r of units[i]) {
      const env = await envelopeFor(r.envelope_row)
      if (env && ['sent', 'delivered'].includes(env.status)) live.push({ r, env })
    }
    if (!live.length) continue

    if (!(await claimSend(db, now))) {
      result.deferred += remaining(i)
      if (opts.reminder) {
        // Put the rest back in the outbox, so they still hear from us.
        await db.from('agreement_recipients').update({ invite_sent_at: null }).in('id', units.slice(i).flat().map((q) => q.id))
      }
      break
    }

    const expiryOf = (r: NativeRecipient) => r.token_expires_at ?? new Date(now.getTime() + 30 * 86_400_000).toISOString()
    const urlOf = (r: NativeRecipient) => signNowUrlFor({ ...r, token_expires_at: expiryOf(r) }, now.getTime())
    const subjectOf = (env: EnvelopeForEmail) => env.prefill?.MinorName || env.prefill?.MemberName || env.minor_name || 'your child'
    const first = live[0]
    const content = live.length > 1
      ? signatureBundleEmail({
          recipientName: first.r.name,
          reminder: !!opts.reminder,
          items: live.map(({ r, env }) => ({
            documentLabel: DOCUMENT_LABEL[env.envelope_type] ?? 'Agreement',
            eventTitle: env.event_title,
            subjectName: subjectOf(env),
            url: urlOf(r),
            expiresAt: expiryOf(r),
          })),
        })
      : (() => {
          const role = ROLE[first.r.role_name] ?? 'adult'
          return signatureRequestEmail({
            role,
            recipientName: first.r.name,
            documentLabel: DOCUMENT_LABEL[first.env.envelope_type] ?? 'Agreement',
            eventTitle: first.env.event_title,
            subjectName: role === 'guardian' ? subjectOf(first.env) : null,
            url: urlOf(first.r),
            expiresAt: expiryOf(first.r),
            reminder: !!opts.reminder,
            afterGuardian: role === 'student' || (role === 'member' && first.r.routing_order > 1),
          })
        })()
    const ids = live.map(({ r }) => r.id)

    try {
      const sent = await sendEmail({ to: first.r.email, ...content })
      await db
        .from('agreement_recipients')
        .update({ invite_sent_at: now.toISOString(), invite_email_id: sent.id, invite_error: null, invite_attempts: 0 })
        .in('id', ids)
      for (const { r } of live) {
        await appendAuditQuietly(db, {
          envelopeRow: r.envelope_row,
          recipientRow: r.id,
          event: 'invite_sent',
          detail: { reminder: !!opts.reminder, emailId: sent.id, ...(live.length > 1 ? { formsInEmail: live.length } : {}) },
        })
      }
      result.sent += live.length
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      for (const { r } of live) {
        await db
          .from('agreement_recipients')
          .update({ invite_sent_at: null, invite_attempts: ((r as { invite_attempts?: number }).invite_attempts ?? 0) + 1, invite_error: message.slice(0, 500) })
          .eq('id', r.id)
      }
      result.failed += live.length
      // Resend's rate limit or daily quota: everything after this would fail too.
      if (err instanceof EmailSendError && err.isQuota) {
        result.deferred += remaining(i + 1)
        break
      }
    }
  }
  return result
}

/** Sends what is waiting in the outbox, oldest and guardians first. */
export async function drainOutbox(db: SupabaseClient, opts: { limit?: number; now?: Date } = {}): Promise<SendResult & { waiting: number }> {
  const { data, error } = await db
    .from('agreement_recipients')
    .select('id, envelope_row, recipient_id, role_name, name, email, status, routing_order, member_id, token_version, token_expires_at, invite_sent_at, invite_attempts, envelope:agreements!inner(provider, status)')
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
    .from('agreement_recipients')
    .select('id, envelope:agreements!inner(provider, status)', { count: 'exact', head: true })
    .eq('status', 'sent')
    .is('invite_sent_at', null)
    .eq('envelope.provider', 'native')
    .in('envelope.status', ['sent', 'delivered'])
  return count ?? 0
}
