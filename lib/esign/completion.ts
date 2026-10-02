import type { SupabaseClient } from '@supabase/supabase-js'
import type { AgreementType } from '@/lib/docusign'
import { AGREEMENT_LABEL } from '@/lib/docusign-agreements'
import { recordCredentialOptOutFromForm, type OptOutEnvelope } from '@/lib/docusign-optout'
import { sendEmail, docusignCompletedToMinorEmail, docusignCompletedToSignerEmail } from '@/lib/email'
import { logActivity } from '@/lib/activity-log'
import { archiveEnvelope } from '@/lib/esign/archive'
import { SITE_URL } from '@/lib/env'

// What happens when an agreement is fully signed, whichever engine signed it.
// The DocuSign Connect webhook and the in-app signing route both end here.

/** Envelope statuses after which nothing further can happen to an agreement. */
const TERMINAL = new Set(['completed', 'declined', 'voided'])

/**
 * Whether a status event may overwrite the stored status. Webhooks arrive at
 * least once and in no guaranteed order, so a late "sent" or "delivered" must
 * not drag a completed agreement backwards. Terminal states never change; a
 * repeat of the same status is harmless.
 */
export function mayTransition(current: string | null | undefined, next: string): boolean {
  if (!current) return true
  if (TERMINAL.has(current)) return current === next
  return true
}

export interface CompletedEnvelope extends OptOutEnvelope {
  status: string
  completed_at: string | null
  archived_at: string | null
  archive_attempts: number | null
  minor_name: string | null
  signer_name: string | null
  event_title: string | null
}

export const COMPLETED_ENVELOPE_COLUMNS =
  'id, envelope_id, provider, status, envelope_type, reused_from, member_id, participant_id, ' +
  'credential_sharing_opt_out, completed_at, archived_at, archive_attempts, minor_name, signer_name, event_title'

/**
 * Runs the completion side-effects once.
 *
 * The opt-out read and the archive are idempotent in themselves and run on
 * every call, so a replay can finish what an earlier attempt could not. The
 * activity entry and the member's email are claimed through
 * completion_notified_at, so a replayed webhook cannot send a second email.
 */
export async function onEnvelopeCompleted(
  db: SupabaseClient,
  envelope: CompletedEnvelope,
): Promise<{ notified: boolean }> {
  // Guardian's credential-sharing opt-out (minor forms only). Non-fatal: a
  // failed read leaves form_data_read_at null and the docusign-form-data cron
  // retries it.
  await recordCredentialOptOutFromForm(db, envelope)

  // Keep our own copy of the signed record. Non-fatal: a failure is counted on
  // the row and the daily job retries it.
  await archiveEnvelope(db, envelope)

  const { data: claimed } = await db
    .from('docusign_envelopes')
    .update({ completion_notified_at: new Date().toISOString() })
    .eq('id', envelope.id)
    .is('completion_notified_at', null)
    .select('id')
  if (!claimed?.length) return { notified: false }

  if (!envelope.member_id) return { notified: true }

  const type = (envelope.envelope_type ?? 'minor') as AgreementType
  await logActivity({
    memberId: envelope.member_id,
    category: 'docusign',
    action: 'docusign_completed',
    summary: `${AGREEMENT_LABEL[type] ?? 'Consent form'} completed${envelope.event_title ? ` for ${envelope.event_title}` : ''}`,
    metadata: { envelopeId: envelope.envelope_id, agreementType: type, eventTitle: envelope.event_title ?? null },
    actorType: 'docusign',
  }, db)

  const { data: member } = await db
    .from('members')
    .select('email, first_name')
    .eq('id', envelope.member_id)
    .maybeSingle()
  if (!member) return { notified: true }

  // A link to the signed copy in the member's account, never the document
  // itself: an attachment would put a minor's details in every inbox the email
  // is forwarded to.
  const downloadUrl = `${SITE_URL}/account?tab=profile`
  const content = type === 'minor'
    ? docusignCompletedToMinorEmail({
        firstName:    member.first_name,
        guardianName: envelope.signer_name ?? '',
        eventTitle:   envelope.event_title ?? '',
        downloadUrl,
      })
    : docusignCompletedToSignerEmail({
        firstName:      member.first_name,
        eventTitle:     envelope.event_title ?? '',
        downloadUrl,
        agreementLabel: AGREEMENT_LABEL[type],
      })
  try {
    await sendEmail({ to: member.email, ...content })
  } catch (err) {
    console.error('[esign-completion] completion email failed:', err)
  }
  return { notified: true }
}
