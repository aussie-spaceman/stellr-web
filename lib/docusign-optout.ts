import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchEnvelopeFieldValues } from '@/lib/esign/operations'
import { OPT_OUT_COLUMNS, formOptOuts, readCheckbox, readCredentialOptOut } from '@/lib/docusign-form-data'
import { applyGuardianOptOut } from '@/lib/credentials-notify'
import { logActivity } from '@/lib/activity-log'

// Reads the guardian's credential-sharing opt-out off a completed minor consent
// envelope and records it, with the media, quote and digital-communications
// opt-outs on any agreement that carries them (V2.3). Called from the Connect webhook on completion, and
// from the docusign-form-data cron for any envelope whose read failed.
//
// Rules:
//  • Only original minor envelopes carry the tab; coverage rows (reused_from)
//    inherit through consentForMinor.
//  • A ticked box sets the opt-out and takes any public pages down. An unticked
//    box never clears an opt-out an admin recorded from an email.
//  • Every successful read records what was found in form_opt_outs: one key
//    per box, true = ticked, false = left unticked ({} = no box found). That
//    is what lets the media list say "did not opt out" rather than "check the
//    form". form_data_read_at is stamped with it.
//  • The cron retries any original whose form_opt_outs is still NULL.

export interface OptOutEnvelope {
  id: string
  envelope_id: string
  /** The signing engine that issued the envelope; absent on rows read without it. */
  provider?: string | null
  envelope_type: string | null
  reused_from: string | null
  member_id: string | null
  participant_id: string | null
  credential_sharing_opt_out: boolean | null
}

export const OPT_OUT_ENVELOPE_COLUMNS =
  'id, envelope_id, provider, envelope_type, reused_from, member_id, participant_id, credential_sharing_opt_out'

export async function recordCredentialOptOutFromForm(
  db: SupabaseClient,
  env: OptOutEnvelope,
  opts: { onError?: (err: unknown) => void } = {},
): Promise<'opted_out' | 'no_opt_out' | 'tab_absent' | 'skipped' | 'failed'> {
  if (env.reused_from) return 'skipped'
  const minor = (env.envelope_type ?? 'minor') === 'minor'
  // Only the agreements that carry an opt-out are read: the Student / Minor
  // agreement (all four) and, from V2.3, the others' media release.
  if (!minor && !['adult', 'mentor', 'volunteer'].includes(env.envelope_type ?? '')) return 'skipped'

  let fields: { name: string; value: string }[]
  try {
    fields = await fetchEnvelopeFieldValues(db, env)
  } catch (err) {
    // Left unstamped: the cron retries. The stored default (no opt-out) stands
    // meanwhile, which is the decided model.
    console.error('[docusign-optout] opt-out read failed:', err)
    opts.onError?.(err)
    return 'failed'
  }
  const ticked = minor ? readCredentialOptOut(fields) : null

  const now = new Date().toISOString()
  const update: Record<string, unknown> = { form_data_read_at: now, form_opt_outs: formOptOuts(fields), updated_at: now }
  if (ticked) update.credential_sharing_opt_out = true
  // A ticked box is recorded; an unticked or absent one leaves the column as
  // it is, so an opt-out recorded another way is never cleared here.
  for (const [tab, column] of Object.entries(OPT_OUT_COLUMNS)) {
    if (readCheckbox(fields, tab)) update[column] = true
  }
  const { error } = await db.from('agreements').update(update).eq('id', env.id)
  if (error) {
    console.error('[docusign-optout] write failed:', error.message)
    opts.onError?.(new Error(`Recording the opt-outs failed: ${error.message}`))
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
