import type { SupabaseClient } from '@supabase/supabase-js'
import type { EmailKind } from '@/lib/email-budget'
import { maskEmail } from '@/lib/utils'

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
//                        account's security depends on. A suppressed critical
//                        send is logged. The critical senders today (pinned by
//                        test/critical-email-senders.test.ts):
//                          - Stellr signing invitations and reminders, guardian,
//                            student and member (lib/esign/outbox.ts);
//                          - the DocuSign heads-up and reminder to a guardian
//                            (lib/docusign-agreements.ts,
//                            app/api/cron/docusign-reminders);
//                          - account sign-in invites (lib/member-invite.ts);
//                          - the privacy-request confirmation link
//                            (lib/privacy-requests.ts).
//                        Critical mail still goes through Resend, so an address
//                        on Resend's own list bounces there and the bounce
//                        webhook reports it (the roster's Email Bounced pill).
//   • marketing        — skipped for ANY suppression reason.
//   • transactional    — skipped for bounce, complaint and manual entries.
//                        NOT skipped for 'unsubscribe': opting out of news must
//                        never stop a registration receipt or a pay link.
//
// A skipped send returns { id: null, suppressed: true }. A caller that records
// delivery must treat that as NOT sent (the e-sign outbox, account invites and
// campaigns do).
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
 * Turn a Resend delivery event into suppressions: every recipient of a
 * permanent bounce, every recipient of a spam complaint.
 *
 * Only a bounce Resend marks 'Permanent' is recorded. A transient bounce
 * (mailbox full, greylisting) is not: the address is fine. Nor is an
 * 'Undetermined' or unclassified one: a row here is never removed by itself
 * (no expiry, no admin screen yet), so one ambiguous event would block a
 * parent's working address for good, and Resend's own list does not block
 * those either. They are logged, masked, so a pattern can still be seen.
 * ("When unsure, suppress" applies to which mail a suppression stops, not to
 * whether a vague bounce becomes a permanent block.)
 */
export async function handleSuppressionEvent(
  db: SupabaseClient,
  event: ResendDeliveryEvent,
): Promise<{ suppressed: number }> {
  let reason: SuppressionReason
  if (event.type === 'email.bounced') {
    const bounceType = (event.data?.bounce?.type ?? '').toLowerCase()
    if (bounceType !== 'permanent') {
      if (bounceType !== 'transient') {
        const who = (event.data?.to ?? []).filter((e): e is string => typeof e === 'string').map((e) => maskEmail(normaliseEmail(e)))
        console.warn(`[email] Bounce of type '${event.data?.bounce?.type ?? 'none'}' — not suppressing:`, who.join(', '))
      }
      return { suppressed: 0 }
    }
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
