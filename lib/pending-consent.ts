import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { ageOn, isMinorOn, isUnder13On, isValidDob } from '@/lib/age'
import { guardianAgreementOnFile } from '@/lib/guardian-consent'
import { normalizeEmail, denormalizeGrade } from '@/lib/member-enums'
import { logActivity } from '@/lib/activity-log'

// Self-registration for minors (decision 24, 3 Nov 2026; plan S1).
//
// Anyone can join Stellr. The controls are by age:
//   • 18+ finish onboarding at once (unchanged);
//   • 13–17 finish onboarding into a PENDING state: a parent or guardian is
//     sent the Student / Minor agreement (the same V2.3 document the
//     membership agreement already issues to a Minor, lib/membership-agreement)
//     and, until it is signed, the account can read public content and its own
//     profile and registrations, but cannot post, chat, react, upload, join a
//     Space or be listed (lib/community memberCommunityTier);
//   • under 13 (COPPA): only a first name, the date of birth and a parent's
//     email are kept before consent. The account stays inactive until the
//     parent signs, with the guardian attestation and the child's birth-year
//     check the signing flow already asks for: getCurrentMember resolves no
//     member for them (so every member page and API refuses them), and the
//     profile, registration and group-join routes refuse them by name
//     (childAwaitingConsentBlock).
//
// The pending row is opened at the age screen, before any other field, so a
// sign-up abandoned there is purged like any other: with no consent 30 days
// after the request, the account and its data are purged through the deletion
// registry, Clerk login included (purgeUnconsentedAccounts, run daily from the
// membership-expiry cron).
//
// Only SELF-registration is pending. A minor an adult route brought here (an
// admin invite, an event registration, an event's consent form) keeps the
// pre-decision-24 path (adultRouteForMinor): no pending row, no purge.
//
// All of it waits behind MINOR_SELF_SIGNUP_ENABLED until the owner approves
// the revised Terms §4.1 and Privacy §2
// (docs/legal/drafts/2026-11-minor-self-registration.md). While it is off,
// minors keep the 2 Oct 2026 behaviour: onboarding refuses them unless an
// adult route brought them.

/** Days a pending account waits for consent before it is purged. */
export const PENDING_CONSENT_DAYS = 30

/** Minimum gap between two consent emails the member can trigger. */
export const RESEND_INTERVAL_MS = 60 * 60 * 1000

/**
 * How long the purge leaves a row it held or failed to delete before trying
 * it again. Under a day, so the next daily run picks it up whatever its jitter.
 */
export const PURGE_RETRY_MS = 20 * 60 * 60 * 1000

/** Whether minors may register themselves (owner approval of the revised Terms/Privacy). */
export function minorSelfSignupEnabled(): boolean {
  return process.env.MINOR_SELF_SIGNUP_ENABLED === 'true'
}

export type AgeBand = 'adult' | 'teen' | 'child'

/**
 * The age band for a date of birth, on today's date. Fails closed: a missing or
 * unreadable date is a child, so it waits for a parent like an under-13.
 */
export function ageBand(dateOfBirth: string | null | undefined, on?: Date): AgeBand {
  if (!isValidDob(dateOfBirth)) return 'child'
  if (isUnder13On(dateOfBirth, on)) return 'child'
  if (isMinorOn(dateOfBirth, on)) return 'teen'
  return 'adult'
}

/** A date of birth on file that says under 13 (unknown is false). */
export function isKnownUnder13(dateOfBirth: string | null | undefined, on?: Date): boolean {
  return isValidDob(dateOfBirth) && ageOn(dateOfBirth, on) < 13
}

/** Guardian relationships a pending request accepts. */
export const GUARDIAN_RELATIONSHIPS = ['Parent', 'Legal Guardian'] as const

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export function isPlausibleEmail(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 254 && EMAIL.test(v.trim())
}

export interface PendingConsent {
  member_id: string
  band: 'teen' | 'child'
  guardian_name: string | null
  /** Null between the age screen and the step that names the parent or guardian. */
  guardian_email: string | null
  requested_at: string
  last_sent_at: string | null
  consented_at: string | null
  purge_after: string
}

const PENDING_COLUMNS =
  'member_id, band, guardian_name, guardian_email, requested_at, last_sent_at, consented_at, purge_after'

/** The member's open request: none, pending, or unknown (the read failed). */
export type PendingRead =
  | { state: 'none' }
  | { state: 'pending'; row: PendingConsent }
  | { state: 'unknown' }

export async function readPendingConsent(db: SupabaseClient, memberId: string): Promise<PendingRead> {
  const { data, error } = await db
    .from('member_pending_consent')
    .select(PENDING_COLUMNS)
    .eq('member_id', memberId)
    .is('consented_at', null)
    .maybeSingle()
  if (error) return { state: 'unknown' }
  return data ? { state: 'pending', row: data as PendingConsent } : { state: 'none' }
}

/**
 * The member's open (unconsented) request, or null. THROWS when the read
 * fails: an error must never be read as "nothing pending" by a caller that
 * would then give a pending minor the full account.
 */
export async function getPendingConsent(db: SupabaseClient, memberId: string): Promise<PendingConsent | null> {
  const read = await readPendingConsent(db, memberId)
  if (read.state === 'unknown') throw new Error('Reading the consent request failed')
  return read.state === 'pending' ? read.row : null
}

export function purgeAfter(from: Date): string {
  return new Date(from.getTime() + PENDING_CONSENT_DAYS * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * The age screen's row: opened as soon as a self-registering minor gives a
 * date of birth, before any other field, so the 30-day purge reaches a sign-up
 * abandoned there. No guardian yet. Idempotent: an existing row (and its clock)
 * is left as it is.
 */
export async function openScreenedRequest(
  db: SupabaseClient,
  input: { memberId: string; band: 'teen' | 'child'; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date()
  const { data: existing, error: readError } = await db
    .from('member_pending_consent')
    .select('member_id')
    .eq('member_id', input.memberId)
    .maybeSingle()
  if (readError) throw new Error(`Reading the consent request failed: ${readError.message}`)
  if (existing) return
  const { error } = await db.from('member_pending_consent').insert({
    member_id: input.memberId,
    band: input.band,
    guardian_name: null,
    guardian_email: null,
    requested_at: now.toISOString(),
    purge_after: purgeAfter(now),
  })
  if (error) throw new Error(`Recording the consent request failed: ${error.message}`)
}

/**
 * Opens (or updates) the member's pending request. Re-running onboarding or
 * changing the guardian's email never restarts the 30-day clock: only the
 * guardian fields move.
 */
export async function openPendingConsent(
  db: SupabaseClient,
  input: { memberId: string; band: 'teen' | 'child'; guardianName: string | null; guardianEmail: string; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date()
  const guardianEmail = normalizeEmail(input.guardianEmail)
  if (!guardianEmail) throw new Error('A guardian email is required')
  const { data: existing, error: readError } = await db
    .from('member_pending_consent')
    .select('member_id, consented_at')
    .eq('member_id', input.memberId)
    .maybeSingle()
  if (readError) throw new Error(`Reading the consent request failed: ${readError.message}`)
  if (existing) {
    const { error } = await db
      .from('member_pending_consent')
      .update({ band: input.band, guardian_name: input.guardianName, guardian_email: guardianEmail })
      .eq('member_id', input.memberId)
    if (error) throw new Error(`Updating the consent request failed: ${error.message}`)
    return
  }
  const { error } = await db.from('member_pending_consent').insert({
    member_id: input.memberId,
    band: input.band,
    guardian_name: input.guardianName,
    guardian_email: guardianEmail,
    requested_at: now.toISOString(),
    purge_after: purgeAfter(now),
  })
  if (error) throw new Error(`Recording the consent request failed: ${error.message}`)
}

/**
 * Who a guardian's agreement can be on file for: the member, and every
 * participant row of theirs (an event form dispatched before the account was
 * linked carries only the participant id). The same scope mayLinkLogin reads.
 * Throws when the participants read fails.
 */
export async function consentScope(
  db: SupabaseClient,
  memberId: string,
): Promise<{ memberId: string; participantIds: string[] }> {
  const { data, error } = await db.from('participants').select('id').eq('member_id', memberId)
  if (error) throw new Error(`Reading participant rows failed: ${error.message}`)
  return { memberId, participantIds: ((data ?? []) as Array<{ id: string }>).map((p) => p.id) }
}

/** A guardian's completed minor agreement for the member or any of their participant rows. Errors read as no. */
export async function guardianConsentOnFile(db: SupabaseClient, memberId: string): Promise<boolean> {
  try {
    return await guardianAgreementOnFile(db, await consentScope(db, memberId))
  } catch {
    return false
  }
}

/**
 * Whether an adult route brought this minor to Stellr, so they are NOT a
 * self-registration: an admin invite, a participants row (an event or group
 * registration, which sends its own guardian form), or a minor consent form
 * other than the membership one this flow sends. 'unknown' when a read fails:
 * callers must neither open a pending row nor purge on it.
 */
export async function adultRouteForMinor(
  db: SupabaseClient,
  memberId: string,
): Promise<'yes' | 'no' | 'unknown'> {
  const { MEMBERSHIP_SLUG } = await import('@/lib/membership-agreement')
  const [member, participations, envelopes] = await Promise.all([
    db.from('members').select('account_invite_sent_at').eq('id', memberId).maybeSingle(),
    db.from('participants').select('id', { count: 'exact', head: true }).eq('member_id', memberId),
    db.from('agreements').select('id', { count: 'exact', head: true })
      .eq('member_id', memberId)
      .eq('envelope_type', 'minor')
      .or(`event_slug.is.null,event_slug.neq.${MEMBERSHIP_SLUG}`),
  ])
  if (member.error || participations.error || envelopes.error) return 'unknown'
  if ((member.data as { account_invite_sent_at?: string | null } | null)?.account_invite_sent_at) return 'yes'
  if ((participations.count ?? 0) > 0 || (envelopes.count ?? 0) > 0) return 'yes'
  return 'no'
}

/** The name the consent form addresses an under-13's parent by until they sign with their own. */
export const PARENT_PLACEHOLDER_NAME = 'Parent or guardian'

/**
 * Sends the consent request: the Student / Minor agreement through the
 * membership-agreement path on Stellr signing, addressed to the guardian, who
 * signs first (with the "I am the parent or legal guardian" attestation and the
 * birth-year check) and then the member. Idempotent: an agreement already out
 * for signature is reported as in flight, not sent twice.
 */
export async function sendConsentRequest(
  db: SupabaseClient,
  memberId: string,
): Promise<{ outcome: string; signNowUrl?: string | null }> {
  const pending = await getPendingConsent(db, memberId)
  if (!pending?.guardian_email) return { outcome: 'not_required' }
  const { data } = await db
    .from('members')
    .select('id, first_name, last_name, email, phone, date_of_birth, grade, ec_phone, ec_relationship')
    .eq('id', memberId)
    .maybeSingle()
  const m = data as {
    id: string; first_name: string | null; last_name: string | null; email: string | null; phone: string | null
    date_of_birth: string | null; grade: string | null; ec_phone: string | null; ec_relationship: string | null
  } | null
  if (!m?.email) return { outcome: 'not_required' }

  const child = pending.band === 'child'
  const { dispatchTyped } = await import('@/lib/docusign-agreements')
  const { MEMBERSHIP_SLUG, MEMBERSHIP_TITLE } = await import('@/lib/membership-agreement')
  const result = await dispatchTyped(
    db,
    {
      participantId: null,
      memberId: m.id,
      eventSlug: MEMBERSHIP_SLUG,
      eventTitle: MEMBERSHIP_TITLE,
      firstName: m.first_name ?? '',
      lastName: m.last_name ?? '',
      email: m.email,
      // Nothing beyond the name, date of birth and the parent's email is held
      // for an under-13 before consent, so nothing else is put on the form.
      phone: child ? null : m.phone,
      dateOfBirth: m.date_of_birth,
    },
    'membership',
    {
      memberId: m.id,
      dateOfBirth: m.date_of_birth ?? undefined,
      grade: !child && m.grade ? (denormalizeGrade(m.grade) ?? m.grade) : undefined,
      guardianName: pending.guardian_name?.trim() || PARENT_PLACEHOLDER_NAME,
      guardianEmail: pending.guardian_email,
      guardianPhone: child ? undefined : m.ec_phone ?? undefined,
      relationship: child ? undefined : m.ec_relationship ?? undefined,
    },
  )
  if (result.outcome === 'issued') await markConsentRequestSent(db, memberId)
  return result
}

export async function markConsentRequestSent(db: SupabaseClient, memberId: string, now = new Date()): Promise<void> {
  await db.from('member_pending_consent').update({ last_sent_at: now.toISOString() }).eq('member_id', memberId)
}

/** Marks the request consented. Returns true when this call cleared it. */
export async function clearPendingConsent(db: SupabaseClient, memberId: string, now = new Date()): Promise<boolean> {
  const { data, error } = await db
    .from('member_pending_consent')
    .update({ consented_at: now.toISOString() })
    .eq('member_id', memberId)
    .is('consented_at', null)
    .select('member_id')
  if (error || !data?.length) return false
  await logActivity({
    memberId,
    category: 'account',
    action: 'guardian_consent_received',
    summary: 'A parent or guardian signed the consent form; the account is no longer pending',
    actorType: 'system',
  }, db)
  return true
}

/**
 * Clears the request when the guardian's agreement is complete. Called from
 * the agreement completion hook (lib/esign/completion) and, as a backstop for
 * a missed hook, wherever the pending state is read. True when consent is on file.
 */
export async function settlePendingConsent(db: SupabaseClient, memberId: string): Promise<boolean> {
  if (!(await guardianConsentOnFile(db, memberId))) return false
  await clearPendingConsent(db, memberId)
  return true
}

/**
 * Whether a child's account is still waiting for a parent's consent: an open
 * request in the under-13 band that is not settled. Fails closed: a failed read
 * counts as waiting. Callers ask it only for a member whose date of birth says
 * under 13, so a read error never locks out anyone else.
 */
export async function childAwaitingConsent(db: SupabaseClient, memberId: string): Promise<boolean> {
  const read = await readPendingConsent(db, memberId)
  if (read.state === 'unknown') return true
  if (read.state === 'none' || read.row.band !== 'child') return false
  return !(await settlePendingConsent(db, memberId))
}

/**
 * The 403 for a signed-in child whose parent has not consented, or null to
 * carry on. For routes that resolve the member themselves rather than through
 * getCurrentMember (which already resolves no member for them): the profile
 * PATCH, individual registration and group join.
 */
export async function childAwaitingConsentBlock(db: SupabaseClient, clerkUserId: string): Promise<NextResponse | null> {
  const { data, error } = await db
    .from('members')
    .select('id, date_of_birth')
    .eq('clerk_user_id', clerkUserId)
    .maybeSingle()
  if (error) return consentPendingResponse()
  const m = data as { id: string; date_of_birth: string | null } | null
  // Every pending child has an under-13 date of birth on file (the age screen
  // and the parent step both write it), so nobody else pays the extra read.
  if (!m || !isKnownUnder13(m.date_of_birth)) return null
  return (await childAwaitingConsent(db, m.id)) ? consentPendingResponse() : null
}

/** childAwaitingConsentBlock for whoever is signed in (none: null). */
export async function sessionChildAwaitingConsentBlock(db: SupabaseClient): Promise<NextResponse | null> {
  const { auth } = await import('@clerk/nextjs/server')
  const { userId } = await auth()
  return userId ? childAwaitingConsentBlock(db, userId) : null
}

/**
 * The signed-in login's own active member row, for the consent routes. Not
 * getCurrentMember: that resolves no member for a child awaiting consent, and
 * the child's own resend and correction must still work.
 */
export async function signedInMemberForConsent(
  db: SupabaseClient,
): Promise<{ id: string; email: string | null } | null> {
  const { auth } = await import('@clerk/nextjs/server')
  const { userId } = await auth()
  if (!userId) return null
  const { data } = await db
    .from('members')
    .select('id, email')
    .eq('clerk_user_id', userId)
    .eq('is_active', true)
    .maybeSingle()
  return (data as { id: string; email: string | null } | null) ?? null
}

export function consentPendingResponse(): NextResponse {
  return NextResponse.json(
    {
      code: 'guardian_consent_pending',
      error: 'This opens up once your parent or guardian has signed your consent form.',
    },
    { status: 403 },
  )
}

/**
 * Whether the guardian has signed their part of an agreement for this member,
 * even if the member has not signed theirs yet. The purge never deletes such an
 * account: the parent has consented. Reads the same scope as consent on file
 * (member and participant rows), and answers yes when unsure.
 */
export async function guardianHasSigned(db: SupabaseClient, memberId: string): Promise<boolean> {
  let scope: { memberId: string; participantIds: string[] }
  try {
    scope = await consentScope(db, memberId)
  } catch {
    return true // unsure: never purge on a failed read
  }
  if (await guardianAgreementOnFile(db, scope).catch(() => false)) return true
  const filter = [
    `member_id.eq.${memberId}`,
    scope.participantIds.length ? `participant_id.in.(${scope.participantIds.join(',')})` : null,
  ].filter(Boolean).join(',')
  const { data: agreements, error } = await db
    .from('agreements')
    .select('id')
    .or(filter)
    .eq('envelope_type', 'minor')
    .in('status', ['sent', 'delivered'])
  if (error) return true
  const ids = ((agreements ?? []) as Array<{ id: string }>).map((a) => a.id)
  if (!ids.length) return false
  const { count, error: rErr } = await db
    .from('agreement_recipients')
    .select('id', { count: 'exact', head: true })
    .in('envelope_row', ids)
    .eq('role_name', 'Guardian')
    .eq('status', 'completed')
  if (rErr) return true
  return (count ?? 0) > 0
}

export interface PurgeResult {
  scanned: number
  purged: string[]
  cleared: string[]
  heldGuardianSigned: string[]
  /** An adult route (invite, event registration, event form) appeared, or could not be ruled out. */
  heldAdultRoute: string[]
  errors: Array<{ memberId: string; error: string }>
}

/** Rows per run, so the purge fits beside the cron's other work. */
export const PURGE_BATCH = 25

/**
 * Deletes every account whose consent request is older than 30 days and still
 * unanswered. Each goes through the deletion registry as a
 * `pending_consent_member`: in-flight forms voided, the Clerk login deleted,
 * and no archive snapshot kept (data held only to ask for consent must not
 * outlive the request). An account whose agreement completed in the meantime
 * is cleared instead. One whose guardian has signed but the member has not, or
 * that an adult route now reaches (an event registration, an invite, an event
 * form), is never deleted.
 *
 * Fair queue: a row held or failed is given a next_attempt_at, and the batch
 * takes rows never tried first, then the longest-waiting retries, so held rows
 * can never fill every batch and starve newer accounts.
 */
export async function purgeUnconsentedAccounts(
  db: SupabaseClient,
  opts: {
    now?: Date
    limit?: number
    deleteMember?: (memberId: string) => Promise<void>
  } = {},
): Promise<PurgeResult> {
  const now = opts.now ?? new Date()
  const nowIso = now.toISOString()
  const result: PurgeResult = {
    scanned: 0, purged: [], cleared: [], heldGuardianSigned: [], heldAdultRoute: [], errors: [],
  }
  const { data, error } = await db
    .from('member_pending_consent')
    .select('member_id')
    .is('consented_at', null)
    .lte('purge_after', nowIso)
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .order('next_attempt_at', { ascending: true, nullsFirst: true })
    .order('purge_after', { ascending: true })
    .limit(opts.limit ?? PURGE_BATCH)
  if (error) throw new Error(`Reading pending consent requests failed: ${error.message}`)

  const deleteMember = opts.deleteMember ?? (async (memberId: string) => {
    const { executeDeletion } = await import('@/lib/deletion/execute')
    await executeDeletion('pending_consent_member', memberId, { mode: 'hard', deletedBy: null })
  })
  const retryLater = async (memberId: string) => {
    await db
      .from('member_pending_consent')
      .update({ next_attempt_at: new Date(now.getTime() + PURGE_RETRY_MS).toISOString() })
      .eq('member_id', memberId)
  }

  for (const row of (data ?? []) as Array<{ member_id: string }>) {
    result.scanned += 1
    const memberId = row.member_id
    try {
      if (await settlePendingConsent(db, memberId)) {
        result.cleared.push(memberId)
        continue
      }
      if ((await adultRouteForMinor(db, memberId)) !== 'no') {
        result.heldAdultRoute.push(memberId)
        await retryLater(memberId)
        continue
      }
      if (await guardianHasSigned(db, memberId)) {
        result.heldGuardianSigned.push(memberId)
        await retryLater(memberId)
        continue
      }
      await deleteMember(memberId)
      result.purged.push(memberId)
    } catch (err) {
      result.errors.push({ memberId, error: err instanceof Error ? err.message : String(err) })
      await retryLater(memberId).catch(() => {})
    }
  }
  return result
}
