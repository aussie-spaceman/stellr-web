// Shared send-history helpers, used by both a normal send (send.ts) and the
// late-registrant catch-up (catch-up.ts). Kept in their own module so send.ts
// can read the history without importing catch-up.ts (which imports send.ts),
// i.e. to avoid an import cycle.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ResolvedRecipient } from './audiences'

export function missedRecipients(recipients: ResolvedRecipient[], alreadyTried: Set<string>): ResolvedRecipient[] {
  return recipients.filter((r) => !alreadyTried.has(r.email.toLowerCase()))
}

/**
 * Every address a real (non-test) send of this email has already tried — sent
 * OR failed. deep review INT-1: `deliver` records each recipient as it goes, so
 * this reflects progress even when an earlier run was killed mid-send, and a
 * re-run (a resumed stuck send, or the next catch-up) skips those addresses
 * instead of emailing them a second time.
 */
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
