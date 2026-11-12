import { AGREEMENT_TITLE } from '@/lib/esign/native/plan'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail, EmailSendError } from '@/lib/email'
import { SITE_URL } from '@/lib/env'
import { appendAuditQuietly } from '@/lib/esign/native/audit'
import { mintToken, signingUrl } from '@/lib/esign/native/tokens'
import { signatureBundleEmail, signatureRequestEmail } from '@/lib/esign/emails'
import type { NativeRecipient } from '@/lib/esign/native/flow'
import { escapeHtml } from '@/lib/email-layout'
import { announceBounces } from '@/lib/esign/bounce-notices'
import { maskEmail } from '@/lib/utils'
import { isTenantRow, loadTenantSender, loadTenantSenders, tenantEventMailEnabled, type EventSender } from '@/lib/event-emails/tenant-mail'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { STELLR_OR_NULL } from '@/lib/tenancy/stellr-scope'

// Another tenant's signing mail (S5 B14 follow-up). An envelope whose
// agreements.tenant_id names a tenant other than Stellr is sent only with that
// tenant's sender, "<Tenant> via Stellr" with the tenant's Reply-To
// (lib/event-emails/tenant-mail.ts), and only while TENANT_EVENT_MAIL_ENABLED is
// exactly true. Without a usable sender its signers are held: nothing is sent,
// no budget is claimed, nothing is written, and they stay in the outbox. So a
// tenant's signing mail never goes out as Stellr. Stellr's envelopes (NULL or
// Stellr tenant_id) never meet this: same sender, same budget, same mail.
//
// The budget below is one pool for every tenant, by the owner's decision of
// 9 Nov 2026 (lib/email-budget.ts): a tenant's signing email claims the same
// daily signing allowance as Stellr's, after Stellr's waiting signers have had
// theirs (drainOutbox).

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
  tenant_guardian_consent: AGREEMENT_TITLE.tenantGuardianConsent,
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
  /** S5: the envelope's tenant. NULL, or absent, is Stellr's. */
  tenant_id?: string | null
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
  /** S5: another tenant's signers not sent for want of a sender. Present only when non-zero. */
  held?: number
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
  opts: {
    reminder?: boolean
    now?: Date
    /** S5: tenant senders the caller has already resolved, so this call does not read them again. */
    senders?: ReadonlyMap<string, EventSender | null>
  } = {},
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
        .select('id, envelope_type, event_title, minor_name, status, prefill, tenant_id')
        .eq('id', id)
        .maybeSingle()
      envelopes.set(id, (data as EnvelopeForEmail | null) ?? null)
    }
    return envelopes.get(id) ?? null
  }
  // S5: each other tenant's sender, read once per call; null when it has none
  // usable or the flag is off. Stellr's envelopes never ask. A sender the caller
  // passed in is used as given (still only while the flag is on).
  const senders = new Map<string, EventSender | null>(tenantEventMailEnabled() ? opts.senders ?? [] : [])
  const senderFor = async (tenantId: string) => {
    if (!senders.has(tenantId)) senders.set(tenantId, await loadTenantSender(db, tenantId))
    return senders.get(tenantId) ?? null
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

  units: for (let i = 0; i < units.length; i++) {
    const unitLive: { r: NativeRecipient; env: EnvelopeForEmail }[] = []
    for (const r of units[i]) {
      const env = await envelopeFor(r.envelope_row)
      if (env && ['sent', 'delivered'].includes(env.status)) unitLive.push({ r, env })
    }
    if (!unitLive.length) continue

    // S5: one email has one sender, so a unit splits by its envelopes' tenant.
    // Stellr's envelopes (NULL or Stellr tenant_id) are one part, which for
    // Stellr alone is the whole unit, exactly as before.
    const byTenant = new Map<string, typeof unitLive>()
    for (const item of unitLive) {
      const key = isTenantRow(item.env.tenant_id) ? item.env.tenant_id : STELLR_TENANT_ID
      const part = byTenant.get(key)
      if (part) part.push(item)
      else byTenant.set(key, [item])
    }
    const parts = [...byTenant]
    // Recipients of this unit already sent, failed or held, so a stop part-way
    // through a split unit neither counts nor re-queues them twice.
    const done = new Set<string>()
    const later = (p: number) => parts.slice(p + 1).reduce((n, [, part]) => n + part.length, 0)

    for (let p = 0; p < parts.length; p++) {
      const [tenantId, live] = parts[p]
      let sender: EventSender | undefined
      if (tenantId !== STELLR_TENANT_ID) {
        const found = await senderFor(tenantId)
        if (!found) {
          // No usable sender: never sent as Stellr. Held where they are, with no
          // budget claimed and nothing written, for a later send.
          result.held = (result.held ?? 0) + live.length
          for (const { r } of live) done.add(r.id)
          continue
        }
        sender = found
      }

      if (!(await claimSend(db, now))) {
        result.deferred += remaining(i) - done.size
        if (opts.reminder) {
          // Put the rest back in the outbox, so they still hear from us.
          await db.from('agreement_recipients').update({ invite_sent_at: null }).in('id', units.slice(i).flat().map((q) => q.id).filter((id) => !done.has(id)))
        }
        break units
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
        // Critical mail (lib/email/suppressions.ts): a signing invitation is how a
        // guardian consents, so the suppression list never holds it back. An
        // address Resend itself blocks still bounces, and the bounce webhook puts
        // it on the roster as Email Bounced (lib/esign/bounces.ts).
        //
        // deferOnFailure: false — this outbox is already durable (a signer whose
        // email did not go keeps invite_sent_at null and is retried by
        // drainOutbox), and invite_email_id must be Resend's real id because the
        // bounce webhook finds the signer by it (lib/esign/bounces.ts).
        //
        // S5: another tenant's envelope goes from its own sender with its Reply-To;
        // Stellr's carries neither key and keeps the default sender.
        const sent = await sendEmail({
          to: first.r.email,
          ...content,
          ...(sender ? { from: sender.from, replyTo: sender.replyTo } : {}),
          critical: true,
          deferOnFailure: false,
        })
        for (const id of ids) done.add(id)
        if (sent.suppressed) {
          // Not reachable while the send is critical; kept so a future change
          // cannot turn a skipped invitation back into a silent "Sent".
          await markSuppressed(db, live.map(({ r }) => r))
          result.failed += live.length
          continue
        }
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
        for (const id of ids) done.add(id)
        const message = err instanceof Error ? err.message : String(err)
        for (const { r } of live) {
          await db
            .from('agreement_recipients')
            .update({ invite_sent_at: null, invite_attempts: ((r as { invite_attempts?: number }).invite_attempts ?? 0) + 1, invite_error: message.slice(0, 500) })
            .eq('id', r.id)
        }
        result.failed += live.length
        // Resend's rate limit or daily quota: everything after this would fail too.
        // Signers in later parts or units are counted as deferred, including any
        // whose tenant turns out to have no sender: those senders are not read
        // after a quota stop, so they cannot be told apart here.
        if (err instanceof EmailSendError && err.isQuota) {
          result.deferred += remaining(i + 1) + later(p)
          break units
        }
      }
    }
  }
  return result
}

/**
 * A signing email the suppression list stopped: nothing reached Resend, so no
 * bounce will ever arrive. Show it the way a bounce shows (status
 * 'autoresponded', the roster's Email Bounced pill, with the reason) and
 * announce it like a bounce (lib/esign/bounce-notices.ts), so the address can
 * be fixed.
 */
async function markSuppressed(db: SupabaseClient, rows: NativeRecipient[]): Promise<void> {
  await db
    .from('agreement_recipients')
    .update({
      status: 'autoresponded',
      invite_sent_at: null,
      invite_email_id: null,
      invite_error: 'Not sent: the address is on the email suppression list',
      last_synced_at: new Date().toISOString(),
    })
    .in('id', rows.map((r) => r.id))
  for (const envelopeRow of new Set(rows.map((r) => r.envelope_row))) {
    await announceBounces(db, envelopeRow, { kind: 'suppressed' })
  }
}

/**
 * Signers waiting in the outbox, oldest and guardians first: Stellr's envelopes,
 * or (S5) those of the other tenants named in `tenantIds`.
 */
async function waitingSigners(
  db: SupabaseClient,
  whose: 'stellr' | 'tenants',
  limit: number,
  tenantIds: readonly string[] = [],
): Promise<NativeRecipient[]> {
  const query = db
    .from('agreement_recipients')
    .select('id, envelope_row, recipient_id, role_name, name, email, status, routing_order, member_id, token_version, token_expires_at, invite_sent_at, invite_attempts, envelope:agreements!inner(provider, status, tenant_id)')
    .eq('status', 'sent')
    .is('invite_sent_at', null)
    .eq('envelope.provider', 'native')
    .in('envelope.status', ['sent', 'delivered'])
  // The inner join drops a signer whose envelope fails the filter.
  const scoped = whose === 'stellr'
    ? query.or(STELLR_OR_NULL, { referencedTable: 'envelope' })
    : query.not('envelope.tenant_id', 'is', null).neq('envelope.tenant_id', STELLR_TENANT_ID).in('envelope.tenant_id', [...tenantIds])
  const { data, error } = await scoped
    .order('routing_order', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(`Outbox query failed${whose === 'tenants' ? ' (other tenants)' : ''}: ${error.message}`)
  return (data ?? []) as unknown as NativeRecipient[]
}

/**
 * Sends what is waiting in the outbox, oldest and guardians first.
 *
 * S5: Stellr's waiting signers are read and sent first, on their own read, so
 * another tenant's held signers can never fill the batch and keep Stellr's in
 * the outbox, and Stellr's keep first call on the day's budget. Other tenants'
 * are read only while TENANT_EVENT_MAIL_ENABLED is true, and sent with what is
 * left. Only the signers of tenants with a usable sender are read, so a tenant
 * without one cannot fill the batch and keep another tenant's in the outbox;
 * its signers wait, unread and uncounted, until it has a sender.
 */
export async function drainOutbox(db: SupabaseClient, opts: { limit?: number; now?: Date } = {}): Promise<SendResult & { waiting: number }> {
  const limit = opts.limit ?? 50
  const stellr = await waitingSigners(db, 'stellr', limit)
  const result: SendResult & { waiting: number } = stellr.length
    ? { ...(await sendInvites(db, stellr, { now: opts.now })), waiting: stellr.length }
    : { sent: 0, deferred: 0, failed: 0, waiting: 0 }
  if (!tenantEventMailEnabled()) return result

  const senders = await loadTenantSenders(db)
  if (!senders.size) return result
  const tenants = await waitingSigners(db, 'tenants', limit, [...senders.keys()])
  if (!tenants.length) return result
  const more = await sendInvites(db, tenants, { now: opts.now, senders })
  const held = (result.held ?? 0) + (more.held ?? 0)
  return {
    sent: result.sent + more.sent,
    deferred: result.deferred + more.deferred,
    failed: result.failed + more.failed,
    ...(held ? { held } : {}),
    waiting: result.waiting + tenants.length,
  }
}

/** Stellr's signing emails waiting to go out (S5: another tenant's are not counted on Stellr's pages). */
export async function outboxDepth(db: SupabaseClient): Promise<number> {
  const { count } = await db
    .from('agreement_recipients')
    .select('id, envelope:agreements!inner(provider, status, tenant_id)', { count: 'exact', head: true })
    .eq('status', 'sent')
    .is('invite_sent_at', null)
    .eq('envelope.provider', 'native')
    .in('envelope.status', ['sent', 'delivered'])
    .or(STELLR_OR_NULL, { referencedTable: 'envelope' })
  return count ?? 0
}
