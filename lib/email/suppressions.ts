import type { SupabaseClient } from '@supabase/supabase-js'
import type { EmailKind } from '@/lib/email-budget'

// The email suppression list (table email_suppressions, migration
// 20261103234624). sendEmail() checks it before every send; the Resend webhook
// (app/api/webhooks/resend) fills it from hard bounces and spam complaints.
//
// ── Which mail still goes to a suppressed address ────────────────────────────
//
// sendEmail callers say nothing about suppression today, so the DEFAULT has to
// be the safe one, and the plan's rule is "when unsure, suppress":
//
//   • critical: true   — always sent. Reserved for mail a child's safety or an
//                        account's security depends on: guardian consent
//                        requests, safeguarding notices, sign-in and account
//                        security mail. A suppressed critical send is logged.
//   • marketing        — skipped for ANY suppression reason.
//   • transactional    — skipped for bounce, complaint and manual entries.
//                        NOT skipped for 'unsubscribe': opting out of news must
//                        never stop a registration receipt or a pay link.
//
// Note for critical mail: Resend keeps its own suppression list for hard
// bounces and complaints and will not deliver to those addresses whatever this
// code decides. Unblocking an address means removing it from Resend's list as
// well as from this table.

export type SuppressionReason = 'bounce' | 'complaint' | 'unsubscribe' | 'manual'

export const SUPPRESSION_REASONS: readonly SuppressionReason[] = ['bounce', 'complaint', 'unsubscribe', 'manual']

/** The form every address is stored and compared in. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Does a suppression with this reason stop a send of this kind? */
export function suppressionBlocks(
  reason: SuppressionReason,
  { kind, critical }: { kind: EmailKind; critical: boolean },
): boolean {
  if (critical) return false
  if (kind === 'marketing') return true
  return reason !== 'unsubscribe'
}

/**
 * The suppression reasons on file for these addresses, keyed by the
 * lower-cased address. Throws on a failed read so the caller decides what an
 * unreadable list means.
 */
export async function lookupSuppressions(
  db: SupabaseClient,
  emails: string[],
): Promise<Map<string, SuppressionReason>> {
  const wanted = [...new Set(emails.filter(Boolean).map(normaliseEmail))]
  const out = new Map<string, SuppressionReason>()
  if (wanted.length === 0) return out
  const { data, error } = await db.from('email_suppressions').select('email, reason').in('email', wanted)
  if (error) throw new Error(error.message)
  for (const row of data ?? []) out.set(row.email as string, row.reason as SuppressionReason)
  return out
}

/**
 * Add an address. Idempotent: an address already on the list keeps its first
 * reason and date (a replayed or repeated event changes nothing).
 */
export async function recordSuppression(
  db: SupabaseClient,
  { email, reason, source }: { email: string; reason: SuppressionReason; source: string },
): Promise<boolean> {
  const normalised = normaliseEmail(email)
  if (!/^[^\s@]+@[^\s@]+$/.test(normalised) || normalised.length > 320) return false
  const { error } = await db
    .from('email_suppressions')
    .upsert({ email: normalised, reason, source: source.slice(0, 200) }, { onConflict: 'email', ignoreDuplicates: true })
  if (error) throw new Error(`Recording the suppression failed: ${error.message}`)
  return true
}

/** The parts of a Resend webhook event this module reads. */
export interface ResendDeliveryEvent {
  type: string
  data?: {
    email_id?: string
    to?: string[]
    bounce?: { message?: string; type?: string; subType?: string }
  }
}

/**
 * Turn a Resend delivery event into suppressions: every recipient of a hard
 * bounce, every recipient of a spam complaint. A transient bounce (mailbox
 * full, greylisting) is not recorded — the address is fine, and suppressing it
 * would silently stop a parent's consent mail. A bounce Resend could not
 * classify is recorded: when unsure, suppress.
 */
export async function handleSuppressionEvent(
  db: SupabaseClient,
  event: ResendDeliveryEvent,
): Promise<{ suppressed: number }> {
  let reason: SuppressionReason
  if (event.type === 'email.bounced') {
    if ((event.data?.bounce?.type ?? '').toLowerCase() === 'transient') return { suppressed: 0 }
    reason = 'bounce'
  } else if (event.type === 'email.complained') {
    reason = 'complaint'
  } else {
    return { suppressed: 0 }
  }

  const recipients = (event.data?.to ?? []).filter((e): e is string => typeof e === 'string')
  let suppressed = 0
  for (const email of recipients) {
    if (await recordSuppression(db, { email, reason, source: `resend:${event.type}` })) suppressed++
  }
  return { suppressed }
}
