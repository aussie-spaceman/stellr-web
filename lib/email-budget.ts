// Shared daily Resend send budget (deep review INT-2 / PUB-4).
//
// Resend's Free plan allows 100 emails per DAY, shared by every sender Stellr
// has. lib/rate-limit.ts is per-warm-serverless-instance, so it cannot enforce
// a cap shared across instances, and the per-feature budgets (esign 60/day in
// lib/esign/outbox.ts, survey 30/day in lib/survey/send.ts) each guard only
// their own channel. This module is the ONE global, durable, cross-instance
// counter — a single `email_send_quota` row per UTC day in Supabase — that
// lib/email.ts increments on every successful Resend send, whatever the sender.
//
// On top of the counter it enforces a TRANSACTIONAL RESERVE: the last
// `transactionalReserve()` sends of the day are usable only by transactional
// mail (consent / credential / registration / safeguarding). Marketing/bulk
// mail (campaigns, event-email blasts) is refused once the non-reserved budget
// is spent, so a burst of bulk mail can never drain the day's last sends that a
// minor's consent email needs.

import type { SupabaseClient } from '@supabase/supabase-js'

/** How a send is weighed against the shared budget. */
export type EmailKind = 'transactional' | 'marketing'

// Resend Free is 100/day; keep a fifth of it for transactional mail. Both are
// overridable so the cap can follow a plan change without a deploy, and so
// tests can shrink it.
const DEFAULT_DAILY_CAP = 100
const DEFAULT_TRANSACTIONAL_RESERVE = 20

export function dailyCap(): number {
  const n = Number(process.env.EMAIL_DAILY_CAP)
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_DAILY_CAP
}

/**
 * Sends at the top of the day's budget that only transactional mail may use.
 * Clamped to [0, cap - 1] so marketing always keeps at least one slot and the
 * reserve can never swallow the whole cap.
 */
export function transactionalReserve(): number {
  const raw = Number(process.env.EMAIL_TRANSACTIONAL_RESERVE)
  const reserve = Number.isInteger(raw) && raw >= 0 ? raw : DEFAULT_TRANSACTIONAL_RESERVE
  return Math.min(reserve, dailyCap() - 1)
}

/** The non-reserved portion of the day's budget — all that marketing may use. */
export function marketingCap(): number {
  return dailyCap() - transactionalReserve()
}

export const utcDay = (now = new Date()): string => now.toISOString().slice(0, 10)

/**
 * May a send of this `kind` go out right now against today's shared budget?
 *
 * Transactional mail is NEVER blocked here: the counter is advisory for it and
 * Resend's own 100/day is the hard ceiling, so a counter that is unreadable or
 * wrong can never cause a false quota block on a consent / credential /
 * registration / safeguarding email. This is the deliberate fail-SAFE choice —
 * we would rather send one consent email over the nominal cap (Resend may still
 * reject it) than silently drop it on a bad count.
 *
 * Marketing/bulk mail is refused once the day's non-reserved budget is spent,
 * protecting the reserve. The read failing is therefore only consequential for
 * marketing, where we fail CLOSED (refuse): without a trustworthy count we must
 * not risk the reserve, and a refused marketing send is deferred — the sender's
 * ledger retries it on the next run — not lost.
 */
export async function canSend(kind: EmailKind, db: SupabaseClient, now = new Date()): Promise<boolean> {
  if (kind === 'transactional') return true

  const { data, error } = await db
    .from('email_send_quota')
    .select('sent')
    .eq('day', utcDay(now))
    .maybeSingle()
  if (error) {
    console.error('[email-budget] quota read failed — refusing marketing send (fail-closed):', error.message)
    return false
  }
  const sent = (data?.sent as number | undefined) ?? 0
  return sent < marketingCap()
}

/**
 * Count one actually-sent email against today's shared budget. Best-effort and
 * atomic (bump_email_quota is a single INSERT … ON CONFLICT DO UPDATE): a
 * failure is logged, never thrown, because the mail has already gone out and
 * under-counting only ever errs toward letting more mail through.
 */
export async function recordSend(db: SupabaseClient, now = new Date()): Promise<void> {
  const { error } = await db.rpc('bump_email_quota', { p_day: utcDay(now) })
  if (error) console.error('[email-budget] quota increment failed:', error.message)
}
