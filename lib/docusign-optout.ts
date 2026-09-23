import type { SupabaseClient } from '@supabase/supabase-js'
import { getEnvelopeFormData } from '@/lib/docusign'
import { readCredentialOptOut } from '@/lib/docusign-form-data'
import { applyGuardianOptOut } from '@/lib/credentials-notify'
import { logActivity } from '@/lib/activity-log'

// Reads the guardian's credential-sharing opt-out off a completed minor consent
// envelope and records it. Called from the Connect webhook on completion, and
// from the docusign-form-data cron for any envelope whose read failed.
//
// Rules:
//  • Only original minor envelopes carry the tab; coverage rows (reused_from)
//    inherit through consentForMinor.
//  • A ticked box sets the opt-out and takes any public pages down. An unticked
//    box never clears an opt-out an admin recorded from an email.
//  • form_data_read_at is stamped on every successful read (tab present or
//    not), so the cron stops retrying.

export interface OptOutEnvelope {
  id: string
  envelope_id: string
  envelope_type: string | null
  reused_from: string | null
  member_id: string | null
  participant_id: string | null
  credential_sharing_opt_out: boolean | null
}

export const OPT_OUT_ENVELOPE_COLUMNS =
  'id, envelope_id, envelope_type, reused_from, member_id, participant_id, credential_sharing_opt_out'

export async function recordCredentialOptOutFromForm(
  db: SupabaseClient,
  env: OptOutEnvelope,
): Promise<'opted_out' | 'no_opt_out' | 'tab_absent' | 'skipped' | 'failed'> {
  if ((env.envelope_type ?? 'minor') !== 'minor' || env.reused_from) return 'skipped'

  let ticked: boolean | null
  try {
    ticked = readCredentialOptOut(await getEnvelopeFormData(env.envelope_id))
  } catch (err) {
    // Left unstamped: the cron retries. The stored default (no opt-out) stands
    // meanwhile, which is the decided model.
    console.error('[docusign-optout] form_data read failed:', err)
    return 'failed'
  }

  const now = new Date().toISOString()
  const update: Record<string, unknown> = { form_data_read_at: now, updated_at: now }
  if (ticked) update.credential_sharing_opt_out = true
  const { error } = await db.from('docusign_envelopes').update(update).eq('id', env.id)
  if (error) {
    console.error('[docusign-optout] write failed:', error.message)
    return 'failed'
  }

  if (ticked === null) return 'tab_absent'
  if (!ticked) return 'no_opt_out'

  if (!env.credential_sharing_opt_out) {
    await applyGuardianOptOut(db, { memberId: env.member_id, participantId: env.participant_id })
    if (env.member_id) {
      await logActivity({
        memberId: env.member_id,
        category: 'docusign',
        actorType: 'docusign',
        action: 'credential_sharing_opt_out',
        summary: 'Guardian opted out of public credential pages on the consent form',
        metadata: { envelopeId: env.envelope_id },
      }, db)
    }
  }
  return 'opted_out'
}
