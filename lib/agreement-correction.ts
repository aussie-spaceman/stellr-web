import type { SupabaseClient } from '@supabase/supabase-js'
import type { EnvelopeRecipient } from './docusign'
import { syncEnvelopeRecipients } from './docusign-recipients'
import { correctRecipientRow, fetchEnvelopeRecipients } from './esign/operations'
import { CorrectionRefusedError } from './esign/types'

// "Correct email" for one signer on a live agreement: the roster, the admin
// agreements table and the member panel all come through here, as does the
// ops script (scripts/agreement-correct-recipient.ts).
//
// It changes the address on the SAME agreement, through the engine's API, so
// signatures already given are kept and no envelope is used from DocuSign's
// monthly allowance. That is the difference from re-issue (lib/docusign-reissue),
// which voids and starts again. On DocuSign's API plan the web UI allows a
// correction only once a month (support case 18095860, 3 Oct 2026), so this is
// the way corrections are made.
//
// The participant record is corrected too, so reminders and any later re-issue
// use the right address. A member's own email is never changed here: it is the
// account's sign-in address (the Blake precedent, 29 Sept 2026).

export interface CorrectionInput {
  agreementId: string
  recipientId: string
  email: string
  name?: string
}

export type CorrectionResult =
  | {
      kind: 'corrected'
      recipient: EnvelopeRecipient
      previousEmail: string
      /** The participant column that was updated, if any. */
      participantField: 'email' | 'emergency_contact_email' | null
      /** Set when the participant record held a different address and was left alone. */
      participantSkipped: string | null
      eventSlug: string | null
      memberId: string | null
      participantId: string | null
      provider: string
      envelopeId: string
    }
  | { kind: 'refused'; code: string; message: string }
  | { kind: 'not_found' }

// Deliberately loose: the engine is the real judge of an address. This only
// stops obvious slips (a missing @, a space) before they reach it.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Which participant column holds each role's address. Roles not listed have none. */
const PARTICIPANT_FIELD: Record<string, 'email' | 'emergency_contact_email'> = {
  Guardian: 'emergency_contact_email',
  Minor: 'email',
  Adult: 'email',
  Mentor: 'email',
  Volunteer: 'email',
}

export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

export async function correctAgreementRecipient(
  db: SupabaseClient,
  input: CorrectionInput,
): Promise<CorrectionResult> {
  const email = normaliseEmail(input.email)
  if (!EMAIL.test(email)) return { kind: 'refused', code: 'INVALID_EMAIL', message: 'Enter a valid email address' }

  const { data: row } = await db
    .from('agreements')
    .select('id, envelope_id, provider, status, event_slug, participant_id, member_id, signer_email')
    .eq('id', input.agreementId)
    .maybeSingle()
  if (!row) return { kind: 'not_found' }

  // The signer as last mirrored; an envelope never synced has no rows, so ask
  // the engine instead.
  const { data: stored } = await db
    .from('agreement_recipients')
    .select('role_name, email')
    .eq('envelope_row', row.id)
    .eq('recipient_id', input.recipientId)
    .maybeSingle()
  const current = stored
    ? { role_name: stored.role_name as string | null, email: stored.email as string | null }
    : await fetchEnvelopeRecipients(db, row).then(
        (all) => {
          const r = all.find((x) => x.recipientId === input.recipientId)
          return r ? { role_name: r.roleName, email: r.email } : null
        },
        () => null,
      )
  const role = current?.role_name ?? null
  if (role === 'StellrRepresentative') {
    return {
      kind: 'refused',
      code: 'STELLR_SIGNER',
      message: "The Stellr counter-signer's address comes from configuration and cannot be changed here",
    }
  }
  const previousEmail = current?.email ?? ''
  if (previousEmail && normaliseEmail(previousEmail) === email && !input.name) {
    return { kind: 'refused', code: 'UNCHANGED', message: 'That is already the address on this agreement' }
  }

  let recipient: EnvelopeRecipient
  try {
    recipient = await correctRecipientRow(db, row, {
      recipientId: input.recipientId,
      email,
      ...(input.name?.trim() ? { name: input.name.trim() } : {}),
    })
  } catch (err) {
    if (err instanceof CorrectionRefusedError) return { kind: 'refused', code: err.code, message: err.message }
    throw err
  }

  // Mirror the engine's signer list, which clears a bounced pill at once
  // rather than at the next Connect event.
  await syncEnvelopeRecipients(db, row.id, row.envelope_id, row.provider).catch((err) =>
    console.error(`[agreement-correction] recipient sync failed for ${row.id}:`, err),
  )

  const was = normaliseEmail(previousEmail)
  if (was && row.signer_email && normaliseEmail(row.signer_email as string) === was) {
    await db
      .from('agreements')
      .update({ signer_email: email, updated_at: new Date().toISOString() })
      .eq('id', row.id)
  }

  // The participant record: only the column for this role, and only when it
  // still holds the address being replaced. Anything else means someone has
  // already changed it, and it is left for a human to look at.
  let participantField: 'email' | 'emergency_contact_email' | null = null
  let participantSkipped: string | null = null
  const field = role ? PARTICIPANT_FIELD[role] : undefined
  if (row.participant_id && field) {
    const { data: p } = await db
      .from('participants')
      .select(field)
      .eq('id', row.participant_id)
      .maybeSingle()
    const held = ((p as Record<string, string | null> | null)?.[field] ?? '') as string
    if (!held || normaliseEmail(held) === was) {
      const { error } = await db.from('participants').update({ [field]: email }).eq('id', row.participant_id)
      if (error) participantSkipped = `the participant record could not be updated (${error.message})`
      else participantField = field
    } else if (normaliseEmail(held) !== email) {
      participantSkipped = `the participant record holds a different address and was left as it is`
    }
  }

  return {
    kind: 'corrected',
    recipient,
    previousEmail,
    participantField,
    participantSkipped,
    eventSlug: (row.event_slug as string | null) ?? null,
    memberId: (row.member_id as string | null) ?? null,
    participantId: (row.participant_id as string | null) ?? null,
    provider: (row.provider as string | null) ?? 'docusign',
    envelopeId: row.envelope_id as string,
  }
}
