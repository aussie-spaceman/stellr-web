import { randomBytes } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { agreementValid } from '@/lib/docusign-agreements'
import { relabelIssuedAward } from '@/lib/event-awards'
import { isMinorPerPolicy, type MinorFacts } from '@/lib/minor-policy'
import { isKnownMinorOn } from '@/lib/age'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import {
  CREDENTIAL_COLUMNS,
  ageBlock,
  canShare,
  normaliseCredentialNumber,
  type CredentialRow,
  type CredentialSource,
  type CredentialTheme,
  type CredentialVisibility,
  type CredentialEventKind,
  type ShareConsent,
  type ShareBlock,
} from '@/lib/credentials-core'

export * from '@/lib/credentials-core'

// ── Verifiable credentials: database side ────────────────────────────────────
// Issue, revoke, visibility, consent lookups and reads. The pure helpers live
// in lib/credentials-core.ts so the edge routes can use them.
// Design: docs/PLAN-credentials-linkedin-2026-09-21.md.

// ── Numbers ──────────────────────────────────────────────────────────────────

// Crockford base32: no I, L, O or U, so the number survives being read aloud
// or typed from a printed CV.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/**
 * STL-2026-7K3MQ8ZD. 8 chars of base32 = 40 bits. The legacy certificate
 * format (STL-2026-XXXXXX, 6 hex = 24 bits) was enumerable; pages default to
 * private so a guessed number shows "private", not a name, but new issues
 * should not rely on that.
 */
export function generateCredentialNumber(now = new Date()): string {
  const bytes = randomBytes(8)
  let out = ''
  for (let i = 0; i < 8; i++) out += CROCKFORD[bytes[i] % 32]
  return `STL-${now.getFullYear()}-${out}`
}

// ── Minor sharing consent (D1, 21 Sept 2026: opt-out) ────────────────────────

/**
 * Whether a minor's guardian has consented to a public credential page.
 *
 * The parental consent form reads as the guardian opting the child IN unless
 * they note otherwise, so: a valid, completed minor envelope grants unless its
 * `credential_sharing_opt_out` is set. Coverage rows (`reused_from`) defer to
 * the envelope they reuse, the same way findValidAgreement does. No valid
 * envelope at all → 'none' — a student with no signed consent is not one we
 * publish, whatever the default says.
 */
export async function consentForMinor(
  db: SupabaseClient,
  who: { memberId: string | null; participantId: string | null },
  now = new Date(),
): Promise<Exclude<ShareConsent, 'not_required'>> {
  if (!who.memberId && !who.participantId) return 'none'

  const filters = [
    who.memberId ? `member_id.eq.${who.memberId}` : null,
    who.participantId ? `participant_id.eq.${who.participantId}` : null,
  ].filter(Boolean).join(',')

  const { data, error } = await db
    .from('agreements')
    .select('id, completed_at, envelope_type, agreement_version, credential_sharing_opt_out, reused_from')
    .or(filters)
    .eq('envelope_type', 'minor')
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  // Fail CLOSED on any read error (deep review QUAL-5). This value gates whether
  // a minor's credential may be made public against a guardian's recorded
  // opt-out. A discarded error used to read as "no agreement", which the caller
  // treats as unprotected; a transient 5xx while publishing could then expose a
  // child whose guardian had declined. Any error → 'none' (no consent on
  // record), which blocks publication rather than permitting it.
  if (error) return 'none'
  if (!data?.completed_at) return 'none'
  if (!agreementValid(data, now)) return 'none'

  let optOut = Boolean(data.credential_sharing_opt_out)
  if (data.reused_from) {
    // The opt-out is recorded on the originally signed root agreement. If we
    // cannot read it, we cannot prove the guardian consented to share, so fail
    // closed rather than defaulting to "granted".
    const { data: root, error: rootError } = await db
      .from('agreements')
      .select('credential_sharing_opt_out')
      .eq('id', data.reused_from)
      .maybeSingle()
    if (rootError || !root) return 'none'
    optOut = optOut || Boolean(root.credential_sharing_opt_out)
  }
  return optOut ? 'declined' : 'granted'
}

// ── Who is a Minor (Privacy Policy §2, Terms §4.1) ───────────────────────────
//
// Until 9 Oct 2026 credentials used "under 18" alone, so an 18-year-old in
// Nebraska, or an 18-year-old still in high school, was an adult here but a
// Minor in the policy: the issued email went to them rather than their parent
// or guardian, and a public page needed no guardian's consent.

/**
 * The facts the policy's Minor definition turns on (lib/minor-policy), read
 * from the holder's records: date of birth, grade, age bracket, and the
 * school's state standing in for the home state. Member first, then the
 * participant row, field by field. Null when a read fails, so callers can
 * fail closed.
 */
export async function holderMinorFacts(
  db: SupabaseClient,
  who: { memberId: string | null; participantId: string | null },
): Promise<MinorFacts | null> {
  const [m, ms, p] = await Promise.all([
    who.memberId
      ? db.from('members').select('date_of_birth, grade, age_bracket').eq('id', who.memberId).maybeSingle()
      : null,
    who.memberId
      ? db.from('member_schools').select('is_current, schools(state)').eq('member_id', who.memberId)
          .order('is_current', { ascending: false }).limit(1)
      : null,
    who.participantId
      ? db.from('participants').select('date_of_birth, grade, age_bracket, registrations(school_address_state)')
          .eq('id', who.participantId).maybeSingle()
      : null,
  ])
  if (m?.error || ms?.error || p?.error) return null

  type Person = { date_of_birth?: string | null; grade?: string | null; age_bracket?: string | null }
  const one = <T,>(v: unknown) => (Array.isArray(v) ? v[0] : v) as T | null | undefined
  const mem = (m?.data ?? null) as Person | null
  const part = (p?.data ?? null) as (Person & { registrations?: unknown }) | null
  const school = one<{ schools?: unknown }>(ms?.data)?.schools
  return {
    dateOfBirth: mem?.date_of_birth ?? part?.date_of_birth ?? null,
    grade:       mem?.grade ?? part?.grade ?? null,
    ageBracket:  mem?.age_bracket ?? part?.age_bracket ?? null,
    state:       one<{ state?: string | null }>(school)?.state
                   ?? one<{ school_address_state?: string | null }>(part?.registrations)?.school_address_state
                   ?? null,
  }
}

/**
 * Whether the holder is a Minor now, or was when the credential was issued
 * (`is_minor`). Decides who the credential emails are addressed to. A failed
 * read falls back to the DOB alone: guessing "Minor" would send an adult's
 * email to their emergency contact, which is no safer than the reverse.
 */
export async function holderIsMinor(
  db: SupabaseClient,
  c: CredentialRow & { date_of_birth?: string | null },
): Promise<boolean> {
  if (c.is_minor) return true
  const known = 'date_of_birth' in c ? (c.date_of_birth ?? null) : null
  const facts = await holderMinorFacts(db, { memberId: c.member_id, participantId: c.participant_id })
  if (!facts) return isKnownMinorOn(known)
  return minorPerPolicyIfDobKnown({ ...facts, dateOfBirth: known ?? facts.dateOfBirth })
}

/**
 * Who the credential emails go to, and the `is_minor` stamped on a new
 * credential, keep reading a missing date of birth as "not a Minor" — the one
 * exception to lib/age and lib/minor-policy presuming a minor (S0, 2 Nov 2026).
 * `is_minor` never clears, so a guess would make an educator with no DOB on
 * file (PD credentials) a Minor for life; going public already fails closed on
 * an unknown DOB (ageBlock); and a student is still caught by grade or the
 * high-school bracket.
 */
function minorPerPolicyIfDobKnown(facts: MinorFacts): boolean {
  return isMinorPerPolicy({ ...facts, presumeMinorIfUnknown: false })
}

/**
 * The age rules come first and use the live DOB: under 13 (or unknown) never
 * goes public. Then anyone who is a Minor today needs consent, even if the
 * credential was issued as an adult's (`is_minor` false): under the age of
 * majority in their school's state, or still in school. Callers holding a
 * CredentialView already have the DOB; the rest is looked up. A failed read
 * is treated as a Minor, which needs consent (QUAL-5 fails closed).
 */
export async function shareConsentFor(
  db: SupabaseClient,
  c: CredentialRow & { date_of_birth?: string | null },
): Promise<ShareConsent> {
  const facts = await holderMinorFacts(db, { memberId: c.member_id, participantId: c.participant_id })
  const dob = 'date_of_birth' in c ? (c.date_of_birth ?? null) : (facts?.dateOfBirth ?? null)
  const blocked = ageBlock(dob)
  if (blocked) return blocked
  const minor = c.is_minor || !facts || isMinorPerPolicy({ ...facts, dateOfBirth: dob })
  if (!minor) return 'not_required'
  return consentForMinor(db, { memberId: c.member_id, participantId: c.participant_id })
}

// ── Issue / revoke / visibility ──────────────────────────────────────────────

export interface IssueInput {
  source: CredentialSource
  memberId?: string | null
  participantId?: string | null
  moduleId?: string | null
  eventSlug?: string | null
  recipient: { firstName: string; lastName: string; dateOfBirth: string | null }
  title: string
  description?: string | null
  criteria?: string | null
  skills?: string[]
  issuer?: string
  roleLabel?: string | null
  award?: string | null
  /** Event credentials: which certificate this is. Defaults to participation. */
  awardType?: string | null
  theme?: CredentialTheme | null
  expiresAt?: string | null
  /** PD credentials: hours recorded, standards, and the activity's name/day/place. */
  pdHours?: number | null
  standards?: string[]
  activityTitle?: string | null
  activityDate?: string | null
  activityLocation?: string | null
}

/** Why issueCredential made no credential (S5 wave 7, A10a). */
export type CredentialNotIssuedReason = 'consent_pending' | 'tenant_not_issuer'

const NOT_ISSUED: Record<CredentialNotIssuedReason, string> = {
  consent_pending: 'Not issued: their parent or guardian hasn’t signed the consent form yet.',
  tenant_not_issuer: 'Not issued: Stellr doesn’t issue credentials for another organisation’s event.',
}

/**
 * issueCredential's refusal. It is thrown, not returned, so the return shape stays
 * `{ row, created }` and every caller's existing catch reports it as it does any other
 * failure. A caller that tells the two apart checks `instanceof` and `reason`.
 */
export class CredentialNotIssuedError extends Error {
  readonly reason: CredentialNotIssuedReason
  constructor(reason: CredentialNotIssuedReason) {
    super(NOT_ISSUED[reason])
    this.name = 'CredentialNotIssuedError'
    this.reason = reason
  }
}

/**
 * The tenant that owns an event, from the mirror, which is where the derivation trigger
 * stamps a credential's tenant from. An event the mirror does not hold counts as
 * Stellr's, as the trigger and lib/authz read it. A failed read throws: answering Stellr
 * there would issue for another tenant's event while the read is down.
 */
async function eventTenant(db: SupabaseClient, slug: string): Promise<string> {
  const { data, error } = await db.from('events').select('tenant_id').eq('slug', slug).maybeSingle()
  if (error) throw new Error(`[credentials] reading the event's owner failed: ${error.message}`)
  return (data as { tenant_id?: string | null } | null)?.tenant_id ?? STELLR_TENANT_ID
}

/**
 * May a new credential be issued for this input? Stellr's events, and credentials with
 * no event (courses), go ahead with no consent read. For another tenant's event: a
 * participant whose guardian has not signed the tenant's consent form is skipped (A16),
 * and otherwise the issue is refused, because Stellr is not that tenant's issuer
 * (decision W7-9, default). Either way it throws CredentialNotIssuedError.
 */
async function assertMayIssue(db: SupabaseClient, input: IssueInput): Promise<void> {
  if (!input.eventSlug) return
  const tenantId = await eventTenant(db, input.eventSlug)
  if (tenantId === STELLR_TENANT_ID) return
  if (input.participantId) {
    const { unconsentedParticipantIds } = await import('@/lib/registration/tenant-guardian-consent')
    if ((await unconsentedParticipantIds(db, tenantId)).has(input.participantId)) {
      throw new CredentialNotIssuedError('consent_pending')
    }
  }
  throw new CredentialNotIssuedError('tenant_not_issuer')
}

/**
 * Idempotent on the partial unique indexes (member+course,
 * participant+event+award, member+event for a mentor or a live PD credential):
 * a re-run returns the existing row with `created: false`. A concurrent first
 * issue is treated the same way — the unique violation is the signal.
 *
 * A new credential for an event first reads the event's owner (assertMayIssue): only
 * Stellr's events are issued for, and a refusal throws CredentialNotIssuedError.
 */
export async function issueCredential(
  db: SupabaseClient,
  input: IssueInput,
): Promise<{ row: CredentialRow; created: boolean }> {
  const existing = await findExisting(db, input)
  if (existing) return { row: existing, created: false }
  await assertMayIssue(db, input)

  // Minor per the policy, not just under 18 (holderMinorFacts). If the records
  // cannot be read, fall back to the DOB alone rather than storing a guess:
  // the consent check and the email re-read the records anyway.
  const facts = await holderMinorFacts(db, { memberId: input.memberId ?? null, participantId: input.participantId ?? null })
  const isMinor = facts
    ? minorPerPolicyIfDobKnown({ ...facts, dateOfBirth: input.recipient.dateOfBirth ?? facts.dateOfBirth })
    : isKnownMinorOn(input.recipient.dateOfBirth)

  const insert = {
    number:         generateCredentialNumber(),
    source:         input.source,
    member_id:      input.memberId ?? null,
    participant_id: input.participantId ?? null,
    module_id:      input.moduleId ?? null,
    event_slug:     input.eventSlug ?? null,
    recipient_name: `${input.recipient.firstName} ${input.recipient.lastName}`.trim(),
    title:          input.title,
    description:    input.description ?? null,
    criteria:       input.criteria ?? null,
    skills:         input.skills ?? [],
    issuer:         input.issuer ?? 'Stellr Education',
    role_label:     input.roleLabel ?? null,
    award:          input.award ?? null,
    award_type:     input.source === 'event' ? input.awardType ?? 'participation' : null,
    theme:          input.theme ?? null,
    expires_at:     input.expiresAt ?? null,
    pd_hours:          input.source === 'pd' ? input.pdHours ?? null : null,
    standards:         input.standards ?? [],
    activity_title:    input.activityTitle ?? null,
    activity_date:     input.activityDate ?? null,
    activity_location: input.activityLocation ?? null,
    is_minor:       isMinor,
  }

  const { data, error } = await db
    .from('credentials')
    .insert(insert)
    .select(CREDENTIAL_COLUMNS)
    .single()

  if (error) {
    // Unique violation = a concurrent request issued it first.
    if (String(error.message).includes('duplicate') || error.code === '23505') {
      const again = await findExisting(db, input)
      if (again) return { row: again, created: false }
    }
    throw new Error(`[credentials] issue failed: ${error.message}`)
  }
  return { row: data as CredentialRow, created: true }
}

async function findExisting(db: SupabaseClient, input: IssueInput): Promise<CredentialRow | null> {
  let q = db.from('credentials').select(CREDENTIAL_COLUMNS).eq('source', input.source)
  if (input.source === 'course') {
    if (!input.memberId || !input.moduleId) throw new Error('[credentials] course credential needs memberId + moduleId')
    q = q.eq('member_id', input.memberId).eq('module_id', input.moduleId)
  } else if (input.source === 'event' && input.awardType === 'mentor') {
    // Mentors are members, not participants (credentials_event_mentor_once).
    if (!input.memberId || !input.eventSlug) throw new Error('[credentials] mentor credential needs memberId + eventSlug')
    q = q.eq('member_id', input.memberId).eq('event_slug', input.eventSlug).eq('award_type', 'mentor')
  } else if (input.source === 'event') {
    if (!input.participantId || !input.eventSlug) throw new Error('[credentials] event credential needs participantId + eventSlug')
    q = q
      .eq('participant_id', input.participantId)
      .eq('event_slug', input.eventSlug)
      .eq('award_type', input.awardType ?? 'participation')
  } else if (input.source === 'pd') {
    // One live PD credential per educator per event (credentials_pd_once): a
    // revoked one is a correction, not a block, so only issued rows match.
    if (!input.memberId || !input.eventSlug) throw new Error('[credentials] PD credential needs memberId + eventSlug')
    q = q.eq('member_id', input.memberId).eq('event_slug', input.eventSlug).eq('status', 'issued')
  } else {
    return null
  }
  const { data } = await q.maybeSingle()
  return (data as CredentialRow | null) ?? null
}

export async function revokeCredential(
  db: SupabaseClient,
  id: string,
  reason: string,
  revokedBy: string | null,
): Promise<CredentialRow | null> {
  const { data } = await db
    .from('credentials')
    .update({
      status: 'revoked',
      revoked_at: new Date().toISOString(),
      revoked_reason: reason,
      revoked_by: revokedBy,
      // Visibility is left as it was: a credential that was public when it was
      // revoked must keep answering "Revoked" at the URL already on LinkedIn.
      // Setting it private would turn the verifier's answer into "private".
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'issued')
    .select(CREDENTIAL_COLUMNS)
    .maybeSingle()
  return (data as CredentialRow | null) ?? null
}

/**
 * Undo a revocation — an award taken away and then given back to the same
 * person. The unique index means the old row is the only row this person can
 * hold for it, so it is restored (same number, same URL) rather than re-issued.
 */
export async function reinstateCredential(db: SupabaseClient, id: string): Promise<CredentialRow | null> {
  const { data } = await db
    .from('credentials')
    .update({ status: 'issued', revoked_at: null, revoked_reason: null, revoked_by: null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'revoked')
    .is('tombstoned_at', null)
    .select(CREDENTIAL_COLUMNS)
    .maybeSingle()
  return (data as CredentialRow | null) ?? null
}

/**
 * Making a credential public is the earner's choice, gated by canShare().
 * Callers resolve consent first; this refuses rather than trusting them.
 */
export async function setVisibility(
  db: SupabaseClient,
  c: CredentialRow,
  visibility: CredentialVisibility,
  consent: ShareConsent,
): Promise<{ ok: true; row: CredentialRow } | { ok: false; reason: ShareBlock }> {
  if (visibility === 'public') {
    const check = canShare(c, consent)
    if (!check.ok) return check
  }
  const { data } = await db
    .from('credentials')
    .update({ visibility, updated_at: new Date().toISOString() })
    .eq('id', c.id)
    .select(CREDENTIAL_COLUMNS)
    .single()
  return { ok: true, row: data as CredentialRow }
}

/**
 * A guardian's opt-out withdraws consent, so every public page the minor holds
 * goes private — including revoked ones, whose page would otherwise still show
 * the name. Unlike revocation, the verifier's answer changing to "private" is
 * the intended outcome here: the family has asked for the name to come down.
 * Returns the rows that changed so the caller can tell the family. With a tenant,
 * only that tenant's credentials change or count; with none, every one the person holds.
 */
export async function unpublishCredentialsFor(
  db: SupabaseClient,
  who: { memberId: string | null; participantId: string | null; tenant?: { value: string; includeNull: boolean } | null },
): Promise<CredentialRow[]> {
  const filters = [
    who.memberId ? `member_id.eq.${who.memberId}` : null,
    who.participantId ? `participant_id.eq.${who.participantId}` : null,
  ].filter(Boolean).join(',')
  if (!filters) return []
  const scoped = db
    .from('credentials')
    .update({ visibility: 'private', updated_at: new Date().toISOString() })
    .or(filters)
    .eq('visibility', 'public')
    .is('tombstoned_at', null)
  const inTenant = !who.tenant
    ? scoped
    : who.tenant.includeNull
      ? scoped.or(`tenant_id.eq.${who.tenant.value},tenant_id.is.null`)
      : scoped.eq('tenant_id', who.tenant.value)
  const { data, error } = await inTenant.select(CREDENTIAL_COLUMNS)
  if (error) console.error('[credentials] unpublish failed:', error.message)
  return (data ?? []) as CredentialRow[]
}

// ── Reads ────────────────────────────────────────────────────────────────────

export interface CredentialView extends CredentialRow {
  /** The owning tenant, NULL for a Stellr row the backfill has not reached (S5). */
  tenant_id: string | null
  /** From the linked member or participant; used for the LinkedIn age gate. */
  date_of_birth: string | null
  /**
   * Who holds it: the member it was issued to, or — for an event credential
   * issued before the student's account was linked — the member their
   * participant row points at now. Ownership checks use this, not member_id.
   */
  owner_member_id: string | null
}

export async function getCredentialByNumber(db: SupabaseClient, number: string): Promise<CredentialView | null> {
  const n = normaliseCredentialNumber(number)
  if (!n) return null
  const { data, error } = await db
    .from('credentials')
    .select(`${CREDENTIAL_COLUMNS}, tenant_id, members!credentials_member_id_fkey(date_of_birth), participants(date_of_birth, member_id)`)
    .eq('number', n)
    .maybeSingle()
  if (error) console.error('[credentials] lookup failed:', error.message)
  if (!data) return null
  return withDob(data as Record<string, unknown>)
}

export async function listMemberCredentials(db: SupabaseClient, memberId: string): Promise<CredentialView[]> {
  // Event credentials follow the participant row, so one issued before the
  // student's account was linked still reaches their wallet.
  const { data: parts } = await db.from('participants').select('id').eq('member_id', memberId)
  const participantIds = (parts ?? []).map((p) => p.id as string)
  const owner = participantIds.length
    ? `member_id.eq.${memberId},participant_id.in.(${participantIds.join(',')})`
    : `member_id.eq.${memberId}`
  const { data } = await db
    .from('credentials')
    .select(`${CREDENTIAL_COLUMNS}, tenant_id, members!credentials_member_id_fkey(date_of_birth), participants(date_of_birth, member_id)`)
    .or(owner)
    .is('tombstoned_at', null)
    .order('issued_at', { ascending: false })
  return ((data ?? []) as Record<string, unknown>[]).map(withDob)
}

function withDob(row: Record<string, unknown>): CredentialView {
  const one = (v: unknown) =>
    (Array.isArray(v) ? v[0] : v) as { date_of_birth?: string | null; member_id?: string | null } | null
  const { members, participants, ...rest } = row
  // Reads are for display, so a renamed award shows its current label.
  // tenant_id rides along from the select. Were a select to leave it out, it would be
  // undefined, which is not NULL: the row then counts as nobody's, never as Stellr's.
  const cred = relabelIssuedAward(rest as unknown as CredentialRow & { tenant_id: string | null })
  const dob = one(members)?.date_of_birth ?? one(participants)?.date_of_birth ?? null
  return { ...cred, date_of_birth: dob, owner_member_id: cred.member_id ?? one(participants)?.member_id ?? null }
}

// ── Telemetry ────────────────────────────────────────────────────────────────

/** Fire-and-forget; never let a stats write break a page or a share. */
export async function recordCredentialEvent(db: SupabaseClient, credentialId: string, kind: CredentialEventKind): Promise<void> {
  const { error } = await db.from('credential_events').insert({ credential_id: credentialId, kind })
  if (error) console.error('[credentials] event write failed:', error.message)
}

// ── Erasure ──────────────────────────────────────────────────────────────────

/**
 * Right-to-erasure hook, called from lib/deletion before the person's row goes.
 * The number keeps resolving — a verifier holding a CV gets "withdrawn", not a
 * 404 that looks like a forgery — but the name is gone and the page is private.
 * Runs before the FK nulls the link, or the rows could not be found.
 */
export async function tombstoneCredentialsFor(
  db: SupabaseClient,
  who: 'member' | 'participant',
  id: string,
): Promise<number> {
  const col = who === 'member' ? 'member_id' : 'participant_id'
  const now = new Date().toISOString()
  const { data, error } = await db
    .from('credentials')
    .update({ tombstoned_at: now, recipient_name: '', visibility: 'private', updated_at: now })
    .eq(col, id)
    .is('tombstoned_at', null)
    .select('id')
  if (error) console.error('[credentials] tombstone failed:', error.message)
  return data?.length ?? 0
}
