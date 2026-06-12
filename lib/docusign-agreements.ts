import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  classifyAgreement,
  createConsentEnvelope,
  createAdultAgreementEnvelope,
  createMentorAgreementEnvelope,
  type AgreementType,
} from './docusign'
import {
  sendEmail,
  docusignSentToMinorEmail,
  docusignSentToSignerEmail,
  docusignOnFileEmail,
} from './email'

// Human-readable label per agreement type, used in emails and the portal UI.
export const AGREEMENT_LABEL: Record<AgreementType, string> = {
  minor:  'Parental Consent Form',
  adult:  'Participation Agreement',
  mentor: 'Mentor Participation Agreement',
}

// Signed paperwork is valid for this long, across all Stellr events.
export const AGREEMENT_VALIDITY_YEARS = 3

export function agreementExpiry(completedAt: string): Date {
  const d = new Date(completedAt)
  d.setFullYear(d.getFullYear() + AGREEMENT_VALIDITY_YEARS)
  return d
}

export interface ParticipantContext {
  participantId: string
  memberId:      string | null
  eventSlug:     string
  eventTitle:    string
  firstName:     string
  lastName:      string
  email:         string
  phone?:        string | null
  dateOfBirth?:  string | null
  eventRole?:    string | null
  schoolName?:   string | null
  schoolState?:  string | null
  // Emergency contact / guardian — minor consent only
  guardianFirstName?: string | null
  guardianLastName?:  string | null
  guardianEmail?:     string | null
  guardianPhone?:     string | null
  relationship?:      string | null
}

// Sends the correct DocuSign agreement for a single participant, records the
// envelope, and emails a heads-up. Non-fatal: failures are logged, never thrown,
// so a DocuSign outage can't break registration.
export async function dispatchAgreement(
  db: SupabaseClient,
  ctx: ParticipantContext,
): Promise<void> {
  const type = classifyAgreement(ctx.eventRole, ctx.dateOfBirth)
  if (!type) return

  try {
    // Paperwork on the member's profile is valid for 3 years across events:
    // if an unexpired signed agreement of the required type is on record, link
    // this participant to it instead of issuing a fresh envelope.
    if (ctx.memberId) {
      const onFile = await findValidAgreement(db, ctx.memberId, type)
      if (onFile) {
        await recordCoverage(db, ctx, type, onFile)
        await safeEmail(ctx.email, docusignOnFileEmail({
          firstName:      ctx.firstName,
          eventTitle:     ctx.eventTitle,
          agreementLabel: AGREEMENT_LABEL[type],
          signedOn:       onFile.completedAt,
          expiresOn:      agreementExpiry(onFile.completedAt).toISOString(),
        }))
        return
      }
    }

    if (type === 'minor') {
      if (!ctx.guardianEmail || !ctx.guardianFirstName) return
      const guardianName = [ctx.guardianFirstName, ctx.guardianLastName].filter(Boolean).join(' ')
      const envelopeId = await createConsentEnvelope({
        minorFirstName:   ctx.firstName,
        minorLastName:    ctx.lastName,
        minorEmail:       ctx.email,
        minorDateOfBirth: ctx.dateOfBirth ?? undefined,
        guardianName,
        guardianEmail:    ctx.guardianEmail,
        guardianPhone:    ctx.guardianPhone ?? undefined,
        relationship:     ctx.relationship ?? undefined,
        eventTitle:       ctx.eventTitle,
        schoolName:       ctx.schoolName ?? undefined,
        schoolState:      ctx.schoolState ?? undefined,
      })
      await recordEnvelope(db, ctx, type, envelopeId, guardianName, ctx.guardianEmail)
      await safeEmail(ctx.email, docusignSentToMinorEmail({
        firstName: ctx.firstName, guardianName, guardianEmail: ctx.guardianEmail, eventTitle: ctx.eventTitle,
      }))
      return
    }

    // Adult or mentor — self-signed, sourced from the participant's own phone column
    const signerName = `${ctx.firstName} ${ctx.lastName}`
    const envelopeId = type === 'adult'
      ? await createAdultAgreementEnvelope({
          firstName: ctx.firstName, lastName: ctx.lastName, email: ctx.email,
          phone: ctx.phone ?? undefined, eventTitle: ctx.eventTitle,
          schoolName: ctx.schoolName ?? undefined, schoolState: ctx.schoolState ?? undefined,
        })
      : await createMentorAgreementEnvelope({
          firstName: ctx.firstName, lastName: ctx.lastName, email: ctx.email,
          phone: ctx.phone ?? undefined, eventTitle: ctx.eventTitle,
        })
    await recordEnvelope(db, ctx, type, envelopeId, signerName, ctx.email)
    await safeEmail(ctx.email, docusignSentToSignerEmail({
      firstName: ctx.firstName, eventTitle: ctx.eventTitle, agreementLabel: AGREEMENT_LABEL[type],
    }))
  } catch (err) {
    console.error(`[docusign] dispatchAgreement (${type}) failed (non-fatal):`, err)
  }
}

interface ValidAgreement {
  id:          string
  completedAt: string
  signerName:  string
  signerEmail: string
}

// Newest unexpired completed agreement of the given type on the member's
// record, resolved to the root signed envelope (a coverage row's reused_from
// always points at the originally signed row, so one hop suffices).
async function findValidAgreement(
  db: SupabaseClient,
  memberId: string,
  type: AgreementType,
): Promise<ValidAgreement | null> {
  const cutoff = new Date()
  cutoff.setFullYear(cutoff.getFullYear() - AGREEMENT_VALIDITY_YEARS)

  const { data, error } = await db
    .from('docusign_envelopes')
    .select('id, completed_at, signer_name, signer_email, reused_from')
    .eq('member_id', memberId)
    .eq('envelope_type', type)
    .eq('status', 'completed')
    .gte('completed_at', cutoff.toISOString())
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null

  if (!data.reused_from) {
    return {
      id:          data.id,
      completedAt: data.completed_at,
      signerName:  data.signer_name,
      signerEmail: data.signer_email,
    }
  }

  const { data: root } = await db
    .from('docusign_envelopes')
    .select('id, completed_at, signer_name, signer_email')
    .eq('id', data.reused_from)
    .eq('status', 'completed')
    .maybeSingle()
  if (!root) return null
  return {
    id:          root.id,
    completedAt: root.completed_at,
    signerName:  root.signer_name,
    signerEmail: root.signer_email,
  }
}

// Records that this participant is covered by previously signed paperwork.
// The synthetic envelope_id keeps the UNIQUE/NOT NULL constraints satisfied
// without colliding with real DocuSign GUIDs; completed_at carries the
// original signature date so expiry tracks the original 3-year window
// (sent_at defaults to now — the registration time — for list ordering).
async function recordCoverage(
  db: SupabaseClient,
  ctx: ParticipantContext,
  type: AgreementType,
  source: ValidAgreement,
): Promise<void> {
  await db.from('docusign_envelopes').insert({
    participant_id: ctx.participantId,
    member_id:      ctx.memberId,
    event_slug:     ctx.eventSlug,
    event_title:    ctx.eventTitle,
    envelope_id:    `on-file:${randomUUID()}`,
    envelope_type:  type,
    status:         'completed',
    signer_name:    source.signerName,
    signer_email:   source.signerEmail,
    minor_name:     `${ctx.firstName} ${ctx.lastName}`,
    completed_at:   source.completedAt,
    reused_from:    source.id,
  })
}

async function recordEnvelope(
  db: SupabaseClient,
  ctx: ParticipantContext,
  type: AgreementType,
  envelopeId: string,
  signerName: string,
  signerEmail: string,
): Promise<void> {
  await db.from('docusign_envelopes').insert({
    participant_id: ctx.participantId,
    member_id:      ctx.memberId,
    event_slug:     ctx.eventSlug,
    event_title:    ctx.eventTitle,
    envelope_id:    envelopeId,
    envelope_type:  type,
    status:         'sent',
    signer_name:    signerName,
    signer_email:   signerEmail,
    minor_name:     `${ctx.firstName} ${ctx.lastName}`,
  })
}

async function safeEmail(to: string, content: { subject: string; html: string; text: string }): Promise<void> {
  try {
    await sendEmail({ to, ...content })
  } catch (err) {
    console.error('[docusign] heads-up email failed (non-fatal):', err)
  }
}
