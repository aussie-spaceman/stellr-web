import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { classifyAgreement, type AgreementType, type EventAgreementType } from './docusign'
import { issueAgreement } from './esign/issue'
import type { CreatedAgreement, MembershipAgreementParams, ProviderId } from './esign/types'
import { escapeHtml as esc } from './email-layout'
import {
  sendEmail,
  docusignSentToMinorEmail,
  docusignSentToGuardianEmail,
  docusignSentToSignerEmail,
  docusignOnFileEmail,
} from './email'
import { notifyCommunityAdmins } from './notify'
import { SandboxCredentialsError } from './env-guards'
import { AGREEMENT_TITLE, AGREEMENT_VERSION } from './esign/native/plan'
import { denormalizeGrade } from './member-enums'

// Human-readable label per agreement type, used in emails and the portal UI:
// the documents' own titles (Participation Agreements V2.3, 2 Oct 2026).
export const AGREEMENT_LABEL: Record<AgreementType, string> = {
  minor:     AGREEMENT_TITLE.minor,
  adult:     AGREEMENT_TITLE.adult,
  mentor:    AGREEMENT_TITLE.mentor,
  // Volunteers execute the mentor document (Stellr, 9 Sept 2026), so the label
  // names what they actually receive.
  volunteer: AGREEMENT_TITLE.mentor,
  membership: AGREEMENT_TITLE.membership,
}

// An adult's, mentor's or volunteer's signed paperwork is valid for this long,
// across all Stellr events. A minor's has no fixed end (see agreementCovers).
const AGREEMENT_VALIDITY_YEARS = 3

// Mentors and volunteers execute the same document (the mentor template —
// Stellr, 9 Sept 2026); only the envelope_type recorded against it differs, by
// the route that issued it. So either one is coverage for the other: a mentor
// who signed at registration must not be sent a second copy when an admin puts
// them on an event's volunteer roster, and vice versa.
const SAME_DOCUMENT: Partial<Record<AgreementType, AgreementType[]>> = {
  mentor:    ['mentor', 'volunteer'],
  volunteer: ['mentor', 'volunteer'],
}

/** Envelope types that satisfy a requirement for `type`. */
export function coveringTypes(type: AgreementType): AgreementType[] {
  return SAME_DOCUMENT[type] ?? [type]
}

/**
 * What dispatchAgreement did. Existing callers ignore it; the admin volunteer
 * assignment reports it back so the admin sees whether paperwork went out.
 *   issued       — a new envelope was sent
 *   on_file      — covered by unexpired signed paperwork; nothing sent
 *   in_flight    — an envelope is already out; nothing sent
 *   not_required — no agreement applies (or no guardian for a minor)
 *   failed       — DocuSign rejected it; admins have been alerted
 */
export type DispatchOutcome = 'issued' | 'on_file' | 'in_flight' | 'not_required' | 'failed'

/**
 * When signed paperwork stops being valid. Three years for every agreement
 * signed before V2.3, and for adults, mentors and volunteers. A minor's V2.3
 * agreement has no fixed end: it lasts until the student is no longer a Minor,
 * their membership closes, consent is withdrawn or a newer version is signed
 * (§ Term), so this returns null for it.
 */
export function agreementExpiry(
  completedAt: string,
  type: AgreementType = 'adult',
  version: string | null = null,
): Date | null {
  if (type === 'minor' && version) return null
  const d = new Date(completedAt)
  d.setFullYear(d.getFullYear() + AGREEMENT_VALIDITY_YEARS)
  return d
}

/** Signed paperwork still valid on `now`, under its own terms. */
export function agreementValid(
  row: { completed_at: string | null; envelope_type: string; agreement_version?: string | null },
  now = new Date(),
): boolean {
  if (!row.completed_at) return false
  const expires = agreementExpiry(row.completed_at, row.envelope_type as AgreementType, row.agreement_version ?? null)
  return expires === null || expires > now
}

/**
 * Whether signed paperwork can be reused for a new event. Adults, mentors and
 * volunteers: while it is valid. A minor: only the current version, because
 * families are asked to sign again when the agreement changes and at no other
 * time (V2.3). Rows from before versions were recorded are an older version.
 */
export function agreementCovers(
  row: { completed_at: string | null; envelope_type: string; agreement_version?: string | null },
  now = new Date(),
): boolean {
  if (row.envelope_type === 'minor') return !!row.completed_at && row.agreement_version === AGREEMENT_VERSION
  return agreementValid(row, now)
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
  /** The student's grade, for the Student / Minor agreement. */
  grade?:             string | null
}

/** What was issued, and how the signer in front of us can sign right now. */
export interface DispatchResult {
  outcome: DispatchOutcome
  provider?: ProviderId
  /** Set when the participant themself is a signer on Stellr signing: sign without waiting for the email. */
  signNowUrl?: string | null
}

// Sends the correct agreement for a single participant, records the envelope,
// and emails a heads-up. Non-fatal: failures are logged, never thrown, so a
// signing outage can't break registration.
export async function dispatchAgreement(
  db: SupabaseClient,
  ctx: ParticipantContext,
): Promise<DispatchOutcome> {
  return (await dispatchAgreementDetailed(db, ctx)).outcome
}

export async function dispatchAgreementDetailed(
  db: SupabaseClient,
  ctx: ParticipantContext,
): Promise<DispatchResult> {
  // The age of majority depends on where the person lives (V2.3 "Minor");
  // the school's state is the best record of that the registration has.
  const type = classifyAgreement(ctx.eventRole, ctx.dateOfBirth, ctx.schoolState)
  if (!type) return { outcome: 'not_required' }
  return issueOrReuse(db, ctx, type)
}

async function issueOrReuse(
  db: SupabaseClient,
  ctx: ParticipantContext,
  type: EventAgreementType,
): Promise<DispatchResult> {

  try {
    // ── Never issue a second envelope for paperwork already in the system ─────
    // Three checks, cheapest first. These used to be partly duplicated in the
    // sheet sync and absent everywhere else, so the join link, the organiser's
    // manual add and a re-run of any of them could each stack a duplicate
    // envelope on the same person. Every caller now gets all three.

    // 1. This participant already has LIVE OR SIGNED paperwork — re-running the
    //    caller (a sheet re-sync, a replayed Drive webhook) must never re-send.
    //
    //    The status filter matters: this check used to match ANY row, including
    //    voided and declined ones. A voided envelope is dead paperwork that MUST
    //    be re-issuable, so the omission made re-issue impossible through every
    //    code path — dispatchAgreement simply returned, silently, and the
    //    participant stayed unpapered. Found 9 Sept 2026 while re-issuing the
    //    consent forms that had been executed in the DocuSign sandbox.
    if (ctx.participantId) {
      const { data: existing } = await db
        .from('agreements')
        .select('id')
        .eq('participant_id', ctx.participantId)
        .in('status', BLOCKING_ENVELOPE_STATUSES)
        .limit(1)
        .maybeSingle()
      if (existing) return { outcome: 'in_flight' }
    }

    // 2. An envelope for this person is already out for THIS event, issued
    //    against a different participant row (re-added after removal, a second
    //    registration for the same event). Chasing them twice for one signature
    //    reads as a system error; an outstanding envelope is still live.
    if (await hasOpenEnvelopeForEvent(db, ctx, type)) return { outcome: 'in_flight' }

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
          expiresOn:      agreementExpiry(onFile.completedAt, onFile.type, onFile.version)?.toISOString() ?? null,
        }))
        return { outcome: 'on_file' }
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
        return { outcome: 'not_required' }
      }
      const guardianName = [ctx.guardianFirstName, ctx.guardianLastName].filter(Boolean).join(' ')
      const envelope = await issueAgreement(db, {
        type: 'minor',
        accounts: { memberId: ctx.memberId },
        params: {
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
          grade:            ctx.grade ? (denormalizeGrade(ctx.grade) ?? ctx.grade) : undefined,
        },
      })
      const recorded = await recordEnvelope(db, ctx, type, envelope, guardianName, ctx.guardianEmail)
      // Stellr signing's own email IS the request; the heads-up pair below
      // exists only because DocuSign's email arrives separately.
      if (envelope.provider === 'docusign') {
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
      }
      return { outcome: 'issued', provider: envelope.provider, signNowUrl: recorded.signNowUrl }
    }

    // Adult, mentor or volunteer — self-signed, sourced from the participant's own phone column
    const signerName = `${ctx.firstName} ${ctx.lastName}`
    const signer = {
      firstName: ctx.firstName, lastName: ctx.lastName, email: ctx.email,
      phone: ctx.phone ?? undefined, eventTitle: ctx.eventTitle,
    }
    const accounts = { memberId: ctx.memberId }
    // The emergency contact a registration collects is also the parent who
    // co-signs for a Mentor under the age of majority (V2.3 §3A).
    const contactName = [ctx.guardianFirstName, ctx.guardianLastName].filter(Boolean).join(' ').trim()
    const envelope = type === 'adult'
      ? await issueAgreement(db, {
          type: 'adult',
          accounts,
          params: { ...signer, schoolName: ctx.schoolName ?? undefined, schoolState: ctx.schoolState ?? undefined },
        })
      : await issueAgreement(db, {
          type,
          accounts,
          params: {
            ...signer,
            dateOfBirth:           ctx.dateOfBirth ?? null,
            state:                 ctx.schoolState ?? null,
            emergencyContactName:  contactName || undefined,
            emergencyContactPhone: ctx.guardianPhone ?? undefined,
            guardianName:          contactName || undefined,
            guardianEmail:         ctx.guardianEmail ?? undefined,
            guardianPhone:         ctx.guardianPhone ?? undefined,
            relationship:          ctx.relationship ?? undefined,
          },
        })
    const recorded = await recordEnvelope(db, ctx, type, envelope, signerName, ctx.email)
    if (envelope.provider === 'docusign') {
      await safeEmail(ctx.email, docusignSentToSignerEmail({
        firstName: ctx.firstName, eventTitle: ctx.eventTitle, agreementLabel: AGREEMENT_LABEL[type],
      }))
    }
    return { outcome: 'issued', provider: envelope.provider, signNowUrl: recorded.signNowUrl }
  } catch (err) {
    console.error(`[docusign] dispatchAgreement (${type}) failed (non-fatal):`, err)

    // The sandbox guard (lib/env-guards) fires here. Registration still succeeds
    // — paperwork is deliberately non-fatal — but the participant is now
    // unpapered and nothing else in the system will notice, which is precisely
    // how three months of demo consent forms went unremarked. A production
    // deployment on sandbox credentials is an outage, so say so loudly.
    // ANY failure here leaves a registered participant with no paperwork, and
    // nothing else in the system notices — that silence is how three months of
    // demonstration consent forms went unremarked. The most likely cause in
    // production is now the envelope quota (the plan allows 40 per month, and a
    // single 30-student group registration nearly exhausts it), which DocuSign
    // rejects per-envelope: registration succeeds, the log gets a line, and the
    // participant is unpapered. So alert on everything, not just the sandbox guard.
    const label = AGREEMENT_LABEL[type] ?? 'agreement'
    const who = `${ctx.firstName} ${ctx.lastName}`
    const sandbox = err instanceof SandboxCredentialsError
    const message = err instanceof Error ? err.message : String(err)
    const reason = sandbox
      ? 'this production deployment is configured against the DocuSign SANDBOX, whose envelopes are stamped "Demonstration document only" and are not binding'
      : `the signing service refused the request: ${message}`
    const fix = sandbox
      ? 'Complete the DocuSign production cutover (docs/GO-LIVE-CHECKLIST.md §4a), then re-issue.'
      : 'Check the signing engine card under Admin → Consent forms, then re-issue. It is retried automatically each day.'

    // A visible row, not only an alert: the participant shows as needing
    // paperwork on the roster, and the daily job retries it. Recorded as
    // 'voided' because, like a voided envelope, it is dead paperwork that must
    // be re-issued, and nothing treats it as in flight.
    await recordIssueFailure(db, ctx, type, message)

    await notifyCommunityAdmins({
      type: 'action',
      body: `No ${label} could be issued for ${who} (${ctx.eventTitle}) — ${reason}. Registration succeeded but the participant has NO paperwork on file. ${fix}`,
      referenceType: 'participant',
      referenceId: ctx.participantId ?? undefined,
      email: {
        subject: `Action needed: no ${label} issued for ${who}`,
        html: `<p><strong>${esc(who)}</strong> (${esc(ctx.email)}) registered for <strong>${esc(ctx.eventTitle)}</strong>, but no ${esc(label)} could be issued — ${esc(reason)}.</p><p>The registration went through. The participant currently has <strong>no paperwork on file</strong>.</p><p>${esc(fix)}</p>`,
        text: `${who} (${ctx.email}) registered for ${ctx.eventTitle}, but no ${label} could be issued — ${reason}. The registration went through; the participant has no paperwork on file. ${fix}`,
      },
    }).catch(() => {})
    return { outcome: 'failed' }
  }
}

/** Prefix of the synthetic envelope_id on a row recording an issue that failed on every engine. */
export const ISSUE_FAILED_PREFIX = 'failed:'

async function recordIssueFailure(
  db: SupabaseClient,
  ctx: ParticipantContext,
  type: AgreementType,
  error: string,
): Promise<void> {
  try {
    const minor = type === 'minor'
    await db.from('agreements').insert({
      participant_id: ctx.participantId,
      member_id:      ctx.memberId,
      event_slug:     ctx.eventSlug,
      event_title:    ctx.eventTitle,
      envelope_id:    `${ISSUE_FAILED_PREFIX}${randomUUID()}`,
      envelope_type:  type,
      status:         'voided',
      signer_name:    minor ? [ctx.guardianFirstName, ctx.guardianLastName].filter(Boolean).join(' ') : `${ctx.firstName} ${ctx.lastName}`,
      signer_email:   minor ? (ctx.guardianEmail ?? '') : ctx.email,
      minor_name:     `${ctx.firstName} ${ctx.lastName}`,
      issue_error:    error.slice(0, 1000),
      signers_total:  0,
    })
  } catch (recordErr) {
    console.error('[docusign] recording the failed issue also failed:', recordErr)
  }
}

// Envelope states that mean "this person has live paperwork in flight" (see the
// status CHECK in migration 010). A declined or voided envelope is dead and must
// be re-issued; a completed one is caught by findValidAgreement — which carries
// coverage across all events, not just this one — so neither is listed here.
const OPEN_ENVELOPE_STATUSES = ['created', 'sent', 'delivered']

// Envelope states that still count as paperwork on a participant's record, and
// so must block a duplicate issue: in flight, or signed. Voided and declined are
// deliberately absent — both mean the paperwork is dead and has to be re-issued.
const BLOCKING_ENVELOPE_STATUSES = [...OPEN_ENVELOPE_STATUSES, 'completed']

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
    .from('agreements')
    .select('id')
    .eq('event_slug', ctx.eventSlug)
    .in('envelope_type', coveringTypes(type))
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
  type:        AgreementType
  version:     string | null
}

interface SignedRow {
  id: string
  completed_at: string
  signer_name: string
  signer_email: string
  envelope_type: string
  agreement_version: string | null
  reused_from: string | null
}

// Newest completed agreement of the given type (or one executing the same
// document — see coveringTypes) on the member's record that still covers a new
// event (agreementCovers), resolved to the root signed envelope (a coverage
// row's reused_from always points at the originally signed row, so one hop
// suffices).
async function findValidAgreement(
  db: SupabaseClient,
  memberId: string,
  type: AgreementType,
): Promise<ValidAgreement | null> {
  const { data, error } = await db
    .from('agreements')
    .select('id, completed_at, signer_name, signer_email, envelope_type, agreement_version, reused_from')
    .eq('member_id', memberId)
    .in('envelope_type', coveringTypes(type))
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null

  let row = data as SignedRow
  if (row.reused_from) {
    const { data: root } = await db
      .from('agreements')
      .select('id, completed_at, signer_name, signer_email, envelope_type, agreement_version, reused_from')
      .eq('id', row.reused_from)
      .eq('status', 'completed')
      .maybeSingle()
    if (!root) return null
    row = root as SignedRow
  }
  if (!agreementCovers(row)) return null
  return {
    id:          row.id,
    completedAt: row.completed_at,
    signerName:  row.signer_name,
    signerEmail: row.signer_email,
    type:        row.envelope_type as AgreementType,
    version:     row.agreement_version,
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
  await db.from('agreements').insert({
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
    agreement_version: source.version,
    signers_total:     1,
    signers_completed: 1,
  })
}

async function recordEnvelope(
  db: SupabaseClient,
  ctx: ParticipantContext,
  type: AgreementType,
  envelope: CreatedAgreement,
  signerName: string,
  signerEmail: string,
): Promise<{ signNowUrl: string | null }> {
  const row = {
    participant_id:    ctx.participantId,
    member_id:         ctx.memberId,
    event_slug:        ctx.eventSlug,
    event_title:       ctx.eventTitle,
    envelope_id:       envelope.externalId,
    provider:          envelope.provider,
    envelope_type:     type,
    status:            'sent',
    signer_name:       signerName,
    signer_email:      signerEmail,
    minor_name:        `${ctx.firstName} ${ctx.lastName}`,
    signers_total:     envelope.signerCount,
    signers_completed: 0,
    // Both engines issue the V2.3 documents (the DocuSign templates were
    // updated to them on 2 Oct 2026), so every new row carries this version.
    agreement_version: AGREEMENT_VERSION,
    ...envelope.rowFields,
  }
  if (!envelope.afterRecord) {
    await db.from('agreements').insert(row)
    return { signNowUrl: null }
  }

  // Stellr signing needs the row's id to create its signer rows.
  const { data, error } = await db.from('agreements').insert(row).select('id').single()
  if (error || !data) throw new Error(`Recording the agreement failed: ${error?.message ?? 'no row'}`)
  const after = await envelope.afterRecord(db, (data as { id: string }).id)
  return { signNowUrl: after?.signNowUrl ?? null }
}

/**
 * Issues an agreement of a given type that no event role implies: the
 * membership agreement, and an admin re-issue that names the type. Same
 * duplicate and coverage checks as event paperwork.
 */
export async function dispatchTyped(
  db: SupabaseClient,
  ctx: ParticipantContext,
  type: AgreementType,
  membership?: Omit<MembershipAgreementParams, 'firstName' | 'lastName' | 'email' | 'phone'>,
): Promise<DispatchResult> {
  if (type !== 'membership') return issueOrReuse(db, ctx, type)
  if (!membership) throw new Error('Membership details are required for the membership agreement')
  try {
    if (await hasOpenEnvelopeForEvent(db, ctx, membership.guardianEmail ? 'minor' : type)) return { outcome: 'in_flight' }
    const envelope = await issueAgreement(db, {
      type: 'membership',
      accounts: { memberId: ctx.memberId },
      params: { ...membership, firstName: ctx.firstName, lastName: ctx.lastName, email: ctx.email, phone: ctx.phone ?? undefined },
    })
    const minor = !!membership.guardianEmail
    // A Minor joining signs the Student / Minor agreement (V2.3), which covers
    // membership and every event, so it is recorded as one: their next event
    // finds it on file instead of sending the family a second copy.
    const recorded = await recordEnvelope(
      db, ctx, minor ? 'minor' : type, envelope,
      minor ? membership.guardianName ?? '' : `${ctx.firstName} ${ctx.lastName}`,
      minor ? membership.guardianEmail ?? '' : ctx.email,
    )
    return { outcome: 'issued', provider: envelope.provider, signNowUrl: recorded.signNowUrl }
  } catch (err) {
    console.error('[docusign] membership agreement failed (non-fatal):', err)
    await recordIssueFailure(db, ctx, type, err instanceof Error ? err.message : String(err))
    await notifyCommunityAdmins({
      type: 'action',
      body: `No Membership Agreement could be issued for ${ctx.firstName} ${ctx.lastName}: ${err instanceof Error ? err.message : String(err)}. It is retried automatically each day.`,
      referenceType: 'member',
      referenceId: ctx.memberId ?? undefined,
    }).catch(() => {})
    return { outcome: 'failed' }
  }
}

async function safeEmail(to: string, content: { subject: string; html: string; text: string }): Promise<void> {
  try {
    await sendEmail({ to, ...content })
  } catch (err) {
    console.error('[docusign] heads-up email failed (non-fatal):', err)
  }
}
