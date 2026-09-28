import type { SupabaseClient } from '@supabase/supabase-js'
import { classifyAgreement, resendEnvelope, voidEnvelope } from './docusign'
import { dispatchAgreement, type DispatchOutcome } from './docusign-agreements'
import { maskEmail } from './utils'

// "Reissue DocuSign" for one event participant — the roster action, the bulk
// DocuSign reminder and the retrospective script all come through here, so the
// rules below are decided once.
//
//   live envelope (created/sent/delivered)  → resend it to whoever hasn't signed.
//                                             Free: no envelope quota, and any
//                                             signature already given is kept.
//   live envelope with a bounced address    → needs confirmation, then void it and
//                                             issue a new one to the addresses on
//                                             the participant NOW (fix them first).
//   voided / declined / no envelope         → needs confirmation, then issue a new one.
//   completed / on file / not required      → nothing to do.
//
// A new envelope costs one of the plan's 40 per month (HANDOVER-docusign-2026-09-09
// §2), which is why those branches return `needs_confirm` unless the caller has
// already asked the human.

export type ReissueResult =
  | { kind: 'resent'; envelopeRowId: string; recipients: number }
  | { kind: 'needs_confirm'; reason: 'voided' | 'declined' | 'missing' | 'bounced'; message: string }
  | { kind: 'reissued'; outcome: DispatchOutcome }
  | { kind: 'nothing_to_do'; reason: 'completed' | 'on_file' | 'not_required'; message: string }
  | { kind: 'not_found' }

const LIVE = new Set(['created', 'sent', 'delivered'])

export async function reissueParticipantAgreement(
  db: SupabaseClient,
  participantId: string,
  opts: { allowNewEnvelope?: boolean; eventSlug?: string } = {},
): Promise<ReissueResult> {
  const { data: p } = await db
    .from('participants')
    .select(`id, member_id, first_name, last_name, email, phone, date_of_birth, event_role, school_name,
      emergency_contact_first_name, emergency_contact_last_name, emergency_contact_email,
      emergency_contact_phone, emergency_contact_relationship,
      registrations!inner(event_slug, event_title, school_name, school_address_state)`)
    .eq('id', participantId)
    .maybeSingle()
  if (!p) return { kind: 'not_found' }
  const reg = (Array.isArray(p.registrations) ? p.registrations[0] : p.registrations) as {
    event_slug: string; event_title: string; school_name: string | null; school_address_state: string | null
  }
  if (opts.eventSlug && reg.event_slug !== opts.eventSlug) return { kind: 'not_found' }

  const { data: env } = await db
    .from('docusign_envelopes')
    .select('id, envelope_id, status, reused_from')
    .eq('participant_id', participantId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (env?.reused_from) {
    return { kind: 'nothing_to_do', reason: 'on_file', message: 'Covered by an agreement already on file' }
  }
  if (env?.status === 'completed') {
    return { kind: 'nothing_to_do', reason: 'completed', message: 'Already signed' }
  }

  if (env && LIVE.has(env.status)) {
    const { data: bounced } = await db
      .from('docusign_envelope_recipients')
      .select('email')
      .eq('envelope_row', env.id)
      .eq('status', 'autoresponded')
    if (!bounced?.length) {
      const recipients = await resendEnvelope(env.envelope_id)
      // Deliberately NOT reminder_sent_at — that column drives the cron's
      // chase cadence (see app/api/admin/docusigns/[id]/resend).
      const now = new Date().toISOString()
      await db.from('docusign_envelopes').update({ last_manual_resend_at: now, updated_at: now }).eq('id', env.id)
      return { kind: 'resent', envelopeRowId: env.id, recipients }
    }
    if (!opts.allowNewEnvelope) {
      return {
        kind: 'needs_confirm',
        reason: 'bounced',
        message:
          `The email to ${bounced.map((b) => maskEmail(b.email as string)).join(', ')} bounced. ` +
          'Correct the address on the participant first; the old envelope is then voided and a new one issued.',
      }
    }
    try {
      await voidEnvelope(env.envelope_id, 'Re-issued by administrator after a bounced email')
    } catch (err) {
      // Already finished on DocuSign's side — the row will catch up via Connect.
      console.error(`[docusign-reissue] void failed for ${env.id}:`, err)
    }
    await db.from('docusign_envelopes').update({ status: 'voided', updated_at: new Date().toISOString() }).eq('id', env.id)
  } else {
    if (!classifyAgreement(p.event_role as string | null, p.date_of_birth as string | null)) {
      return { kind: 'nothing_to_do', reason: 'not_required', message: 'No agreement is required for this participant' }
    }
    if (!opts.allowNewEnvelope) {
      const reason = env ? (env.status as 'voided' | 'declined') : 'missing'
      return {
        kind: 'needs_confirm',
        reason,
        message: env ? `The last envelope was ${env.status}. A new one must be issued.` : 'No envelope has been issued.',
      }
    }
  }

  const outcome = await dispatchAgreement(db, {
    participantId,
    memberId:          (p.member_id as string | null) ?? null,
    eventSlug:         reg.event_slug,
    eventTitle:        reg.event_title,
    firstName:         p.first_name as string,
    lastName:          p.last_name as string,
    email:             (p.email as string | null) ?? '',
    phone:             p.phone as string | null,
    dateOfBirth:       p.date_of_birth as string | null,
    eventRole:         p.event_role as string | null,
    schoolName:        (p.school_name as string | null) ?? reg.school_name,
    schoolState:       reg.school_address_state,
    guardianFirstName: p.emergency_contact_first_name as string | null,
    guardianLastName:  p.emergency_contact_last_name as string | null,
    guardianEmail:     p.emergency_contact_email as string | null,
    guardianPhone:     p.emergency_contact_phone as string | null,
    relationship:      p.emergency_contact_relationship as string | null,
  })
  return { kind: 'reissued', outcome }
}
