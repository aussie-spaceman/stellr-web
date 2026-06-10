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
} from './email'

// Human-readable label per agreement type, used in emails and the portal UI.
export const AGREEMENT_LABEL: Record<AgreementType, string> = {
  minor:  'Parental Consent Form',
  adult:  'Participation Agreement',
  mentor: 'Mentor Participation Agreement',
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
    if (type === 'minor') {
      if (!ctx.guardianEmail || !ctx.guardianFirstName) return
      const guardianName = [ctx.guardianFirstName, ctx.guardianLastName].filter(Boolean).join(' ')
      const envelopeId = await createConsentEnvelope({
        minorFirstName:   ctx.firstName,
        minorLastName:    ctx.lastName,
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
