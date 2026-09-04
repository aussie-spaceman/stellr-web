import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  classifyAgreement,
  createConsentEnvelope,
  createAdultAgreementEnvelope,
  createMentorAgreementEnvelope,
  createVolunteerAgreementEnvelope,
  type AgreementType,
  type CreatedEnvelope,
} from './docusign'
import {
  sendEmail,
  docusignSentToMinorEmail,
  docusignSentToGuardianEmail,
  docusignSentToSignerEmail,
  docusignOnFileEmail,
} from './email'
import { notifyCommunityAdmins } from './notify'
import { SandboxCredentialsError } from './env-guards'

// Human-readable label per agreement type, used in emails and the portal UI.
export const AGREEMENT_LABEL: Record<AgreementType, string> = {
  minor:     'Parental Consent Form',
  adult:     'Participation Agreement',
  mentor:    'Mentor Participation Agreement',
  volunteer: 'Volunteer Agreement',
}

// Signed paperwork is valid for this long, across all Stellr events.
export const AGREEMENT_VALIDITY_YEARS = 3

export function agreementExpiry(completedAt: string): Date {
  const d = new Date(completedAt)
  d.setFullYear(d.getFullYear() + AGREEMENT_VALIDITY_YEARS)
  return d
}

export interface ParticipantContext {
  /** Null for program-level agreements not tied to an event participant row. */
  participantId: string | null
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
    // ── Never issue a second envelope for paperwork already in the system ─────
    // Three checks, cheapest first. These used to be partly duplicated in the
    // sheet sync and absent everywhere else, so the join link, the organiser's
    // manual add and a re-run of any of them could each stack a duplicate
    // envelope on the same person. Every caller now gets all three.

    // 1. This participant already has an envelope — re-running the caller (a
    //    sheet re-sync, a replayed Drive webhook) must never re-send.
    if (ctx.participantId) {
      const { data: existing } = await db
        .from('docusign_envelopes')
        .select('id')
        .eq('participant_id', ctx.participantId)
        .limit(1)
        .maybeSingle()
      if (existing) return
    }

    // 2. An envelope for this person is already out for THIS event, issued
    //    against a different participant row (re-added after removal, a second
    //    registration for the same event). Chasing them twice for one signature
    //    reads as a system error; an outstanding envelope is still live.
    if (await hasOpenEnvelopeForEvent(db, ctx, type)) return

    // 3. Paperwork on the member's profile is valid for 3 years across events:
    //    if an unexpired signed agreement of the required type is on record,
    //    link this participant to it instead of issuing a fresh envelope.
    const coverageMemberId = ctx.memberId ?? (await memberIdByEmail(db, ctx.email))
    if (coverageMemberId) {
      const onFile = await findValidAgreement(db, coverageMemberId, type)
      if (onFile) {
        await recordCoverage(db, { ...ctx, memberId: coverageMemberId }, type, onFile)
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
      if (!ctx.guardianEmail || !ctx.guardianFirstName) {
        // A minor's parental consent is required but there's no guardian on file,
        // so no envelope can be issued. Silently skipping would leave the minor
        // unpapered with nobody aware — alert admins to collect the guardian's
        // details and re-issue. Non-fatal.
        await notifyCommunityAdmins({
          type: 'action',
          body: `${ctx.firstName} ${ctx.lastName} needs a parental consent form for ${ctx.eventTitle}, but no guardian contact is on file.`,
          referenceType: 'participant',
          referenceId: ctx.participantId ?? undefined,
          email: {
            subject: `Action needed: missing guardian for ${ctx.firstName} ${ctx.lastName}`,
            html: `<p>A parental consent form is required for <strong>${ctx.firstName} ${ctx.lastName}</strong> (${ctx.email}) for <strong>${ctx.eventTitle}</strong>, but no guardian name/email is on file — DocuSign could not be issued.</p><p>Collect the guardian's details and re-issue the consent form.</p>`,
            text: `A parental consent form is required for ${ctx.firstName} ${ctx.lastName} (${ctx.email}) for ${ctx.eventTitle}, but no guardian contact is on file. Collect the guardian's details and re-issue.`,
          },
        }).catch(() => {})
        return
      }
      const guardianName = [ctx.guardianFirstName, ctx.guardianLastName].filter(Boolean).join(' ')
      const envelope = await createConsentEnvelope({
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
      await recordEnvelope(db, ctx, type, envelope, guardianName, ctx.guardianEmail)
      await safeEmail(ctx.email, docusignSentToMinorEmail({
        firstName: ctx.firstName, guardianName, guardianEmail: ctx.guardianEmail, eventTitle: ctx.eventTitle,
      }))
      // The guardian is the signature that actually gates the registration, yet
      // until now they only ever heard from DocuSign — so a filtered or ignored
      // DocuSign email was a silent dead end for everyone. Tell them directly,
      // in our own voice, what is coming and from whom.
      await safeEmail(ctx.guardianEmail, docusignSentToGuardianEmail({
        guardianName,
        minorName:  `${ctx.firstName} ${ctx.lastName}`,
        eventTitle: ctx.eventTitle,
      }))
      return
    }

    // Adult, mentor or volunteer — self-signed, sourced from the participant's own phone column
    const signerName = `${ctx.firstName} ${ctx.lastName}`
    const envelope = type === 'adult'
      ? await createAdultAgreementEnvelope({
          firstName: ctx.firstName, lastName: ctx.lastName, email: ctx.email,
          phone: ctx.phone ?? undefined, eventTitle: ctx.eventTitle,
          schoolName: ctx.schoolName ?? undefined, schoolState: ctx.schoolState ?? undefined,
        })
      : type === 'volunteer'
      ? await createVolunteerAgreementEnvelope({
          firstName: ctx.firstName, lastName: ctx.lastName, email: ctx.email,
          phone: ctx.phone ?? undefined, eventTitle: ctx.eventTitle,
        })
      : await createMentorAgreementEnvelope({
          firstName: ctx.firstName, lastName: ctx.lastName, email: ctx.email,
          phone: ctx.phone ?? undefined, eventTitle: ctx.eventTitle,
        })
    await recordEnvelope(db, ctx, type, envelope, signerName, ctx.email)
    await safeEmail(ctx.email, docusignSentToSignerEmail({
      firstName: ctx.firstName, eventTitle: ctx.eventTitle, agreementLabel: AGREEMENT_LABEL[type],
    }))
  } catch (err) {
    console.error(`[docusign] dispatchAgreement (${type}) failed (non-fatal):`, err)

    // The sandbox guard (lib/env-guards) fires here. Registration still succeeds
    // — paperwork is deliberately non-fatal — but the participant is now
    // unpapered and nothing else in the system will notice, which is precisely
    // how three months of demo consent forms went unremarked. A production
    // deployment on sandbox credentials is an outage, so say so loudly.
    if (err instanceof SandboxCredentialsError) {
      await notifyCommunityAdmins({
        type: 'action',
        body: `No agreement could be issued for ${ctx.firstName} ${ctx.lastName} (${ctx.eventTitle}): production is pointed at the DocuSign sandbox. Registration succeeded but the participant has NO paperwork. Complete the DocuSign production cutover (docs/GO-LIVE-CHECKLIST.md §4a), then re-issue.`,
        referenceType: 'participant',
        referenceId: ctx.participantId ?? undefined,
        email: {
          subject: `URGENT: DocuSign is on sandbox — no agreement issued for ${ctx.firstName} ${ctx.lastName}`,
          html: `<p><strong>${ctx.firstName} ${ctx.lastName}</strong> (${ctx.email}) registered for <strong>${ctx.eventTitle}</strong>, but no ${AGREEMENT_LABEL[type] ?? 'agreement'} could be issued: this production deployment is configured against the DocuSign <strong>sandbox</strong>, whose envelopes are stamped "Demonstration document only" and are not binding.</p><p>The registration went through. The participant currently has <strong>no paperwork on file</strong>.</p><p>Complete the DocuSign production cutover (docs/GO-LIVE-CHECKLIST.md §4a), then re-issue.</p>`,
          text: `${ctx.firstName} ${ctx.lastName} (${ctx.email}) registered for ${ctx.eventTitle}, but no ${AGREEMENT_LABEL[type] ?? 'agreement'} could be issued: this production deployment is on the DocuSign SANDBOX. The registration went through; the participant has no paperwork on file. Complete the production cutover (docs/GO-LIVE-CHECKLIST.md §4a), then re-issue.`,
        },
      }).catch(() => {})
    }
  }
}

// Envelope states that mean "this person has live paperwork in flight" (see the
// status CHECK in migration 010). A declined or voided envelope is dead and must
// be re-issued; a completed one is caught by findValidAgreement — which carries
// coverage across all events, not just this one — so neither is listed here.
const OPEN_ENVELOPE_STATUSES = ['created', 'sent', 'delivered']

// Is an agreement of this type already out for this person and this event? The
// participant-id check can't see it when the person was re-added under a new
// participant row, or registered for the same event through two routes — and
// findValidAgreement only matches COMPLETED paperwork, so an unsigned envelope
// was invisible to both and a duplicate went out. Matched on member id when we
// have one, otherwise on the signer's email.
async function hasOpenEnvelopeForEvent(
  db: SupabaseClient,
  ctx: ParticipantContext,
  type: AgreementType,
): Promise<boolean> {
  let q = db
    .from('docusign_envelopes')
    .select('id')
    .eq('event_slug', ctx.eventSlug)
    .eq('envelope_type', type)
    .in('status', OPEN_ENVELOPE_STATUSES)
    .limit(1)

  // For a minor the signer is the guardian, so signer_email won't match the
  // participant — fall back to the minor's name only when there's no member id.
  q = ctx.memberId
    ? q.eq('member_id', ctx.memberId)
    : q.eq('signer_email', ctx.email)

  const { data, error } = await q.maybeSingle()
  if (error) {
    // Don't let a lookup blip suppress required paperwork — issuing a possible
    // duplicate is the safer failure here than silently leaving someone unpapered.
    console.error('[docusign] open-envelope check failed (issuing anyway):', error)
    return false
  }
  return !!data
}

// Resolve a member by email when the caller had no member id — a failed or
// skipped member upsert (blank sheet rows, a transient error) otherwise bypassed
// the 3-year on-file check entirely and re-sent paperwork the person had already
// signed.
async function memberIdByEmail(db: SupabaseClient, email: string): Promise<string | null> {
  if (!email) return null
  const { data, error } = await db
    .from('members')
    .select('id')
    .eq('email', email)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('[docusign] member-by-email lookup failed (non-fatal):', error)
    return null
  }
  return (data?.id as string | undefined) ?? null
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
    participant_id:    ctx.participantId,
    member_id:         ctx.memberId,
    event_slug:        ctx.eventSlug,
    event_title:       ctx.eventTitle,
    envelope_id:       `on-file:${randomUUID()}`,
    envelope_type:     type,
    status:            'completed',
    signer_name:       source.signerName,
    signer_email:      source.signerEmail,
    minor_name:        `${ctx.firstName} ${ctx.lastName}`,
    completed_at:      source.completedAt,
    reused_from:       source.id,
    signers_total:     1,
    signers_completed: 1,
  })
}

async function recordEnvelope(
  db: SupabaseClient,
  ctx: ParticipantContext,
  type: AgreementType,
  envelope: CreatedEnvelope,
  signerName: string,
  signerEmail: string,
): Promise<void> {
  await db.from('docusign_envelopes').insert({
    participant_id:    ctx.participantId,
    member_id:         ctx.memberId,
    event_slug:        ctx.eventSlug,
    event_title:       ctx.eventTitle,
    envelope_id:       envelope.envelopeId,
    envelope_type:     type,
    status:            'sent',
    signer_name:       signerName,
    signer_email:      signerEmail,
    minor_name:        `${ctx.firstName} ${ctx.lastName}`,
    signers_total:     envelope.signerCount,
    signers_completed: 0,
  })
}

async function safeEmail(to: string, content: { subject: string; html: string; text: string }): Promise<void> {
  try {
    await sendEmail({ to, ...content })
  } catch (err) {
    console.error('[docusign] heads-up email failed (non-fatal):', err)
  }
}
