import type { SupabaseClient } from '@supabase/supabase-js'
import { providerForRow } from '@/lib/esign'
import type { EnvelopeFormField, EnvelopeRecipient } from '@/lib/docusign'
import type { SignedDocument } from '@/lib/esign/types'

// Operations on an agreement that already exists, dispatched to the engine
// that issued it. Callers pass the stored row; they never need to know which
// engine that was.

/** The columns of agreements these helpers read. */
export interface EnvelopeRef {
  envelope_id: string
  provider?: string | null
}

/** Re-notifies the signers who have not signed. Returns how many were notified. */
export function remindEnvelopeRow(db: SupabaseClient, row: EnvelopeRef): Promise<number> {
  return providerForRow(row).remind({ db }, row.envelope_id)
}

export function voidEnvelopeRow(db: SupabaseClient, row: EnvelopeRef, reason?: string): Promise<void> {
  return providerForRow(row).void({ db }, row.envelope_id, reason)
}

export function fetchEnvelopeRecipients(db: SupabaseClient, row: EnvelopeRef): Promise<EnvelopeRecipient[]> {
  return providerForRow(row).getRecipients({ db }, row.envelope_id)
}

export function fetchEnvelopeFieldValues(db: SupabaseClient, row: EnvelopeRef): Promise<EnvelopeFormField[]> {
  return providerForRow(row).getFieldValues({ db }, row.envelope_id)
}

export function fetchSignedDocument(
  db: SupabaseClient,
  row: EnvelopeRef,
  opts?: { certificate?: boolean },
): Promise<SignedDocument> {
  return providerForRow(row).getSignedDocument({ db }, row.envelope_id, opts)
}
