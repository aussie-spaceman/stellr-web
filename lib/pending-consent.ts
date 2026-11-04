import type { SupabaseClient } from '@supabase/supabase-js'
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
//     email are kept before consent. The account stays inactive (onboarding is
//     not complete, so every member surface sends them back to the waiting
//     page) until the parent signs, with the guardian attestation and the
//     child's birth-year check the signing flow already asks for.
//
// With no consent 30 days after the request, the account and its data are
// purged through the deletion registry, Clerk login included
// (purgeUnconsentedAccounts, run daily from the membership-expiry cron).
//
// All of it waits behind MINOR_SELF_SIGNUP_ENABLED until the owner approves
// the revised Terms §4.1 and Privacy §2
// (docs/legal/drafts/2026-11-minor-self-registration.md). While it is off,
// minors keep the 2 Oct 2026 behaviour: onboarding refuses them unless an
// adult route (invite, event registration, consent envelope) brought them.

/** Days a pending account waits for consent before it is purged. */
export const PENDING_CONSENT_DAYS = 30

/** Minimum gap between two consent emails the member can trigger. */
export const RESEND_INTERVAL_MS = 60 * 60 * 1000

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
  guardian_email: string
  requested_at: string
  last_sent_at: string | null
  consented_at: string | null
  purge_after: string
}

const PENDING_COLUMNS =
  'member_id, band, guardian_name, guardian_email, requested_at, last_sent_at, consented_at, purge_after'

/** The member's open (unconsented) request, or null. A read error counts as none. */
export async function getPendingConsent(db: SupabaseClient, memberId: string): Promise<PendingConsent | null> {
  const { data, error } = await db
    .from('member_pending_consent')
    .select(PENDING_COLUMNS)
    .eq('member_id', memberId)
    .is('consented_at', null)
    .maybeSingle()
  if (error) return null
  return (data as PendingConsent | null) ?? null
}

export function purgeAfter(from: Date): string {
  return new Date(from.getTime() + PENDING_CONSENT_DAYS * 24 * 60 * 60 * 1000).toISOString()
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
  const { data: existing } = await db
    .from('member_pending_consent')
    .select('member_id, consented_at')
    .eq('member_id', input.memberId)
    .maybeSingle()
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
  if (!pending) return { outcome: 'not_required' }
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
  const onFile = await guardianAgreementOnFile(db, { memberId }).catch(() => false)
  if (!onFile) return false
  await clearPendingConsent(db, memberId)
  return true
}

/**
 * Whether the guardian has signed their part of an agreement for this member,
 * even if the member has not signed theirs yet. The purge never deletes such an
 * account: the parent has consented.
 */
export async function guardianHasSigned(db: SupabaseClient, memberId: string): Promise<boolean> {
  if (await guardianAgreementOnFile(db, { memberId }).catch(() => false)) return true
  const { data: agreements, error } = await db
    .from('agreements')
    .select('id')
    .eq('member_id', memberId)
    .eq('envelope_type', 'minor')
    .in('status', ['sent', 'delivered'])
  if (error) return true // unsure: never purge on a failed read
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
 * is cleared instead; one whose guardian has signed but the member has not is
 * left alone.
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
  const result: PurgeResult = { scanned: 0, purged: [], cleared: [], heldGuardianSigned: [], errors: [] }
  const { data, error } = await db
    .from('member_pending_consent')
    .select('member_id')
    .is('consented_at', null)
    .lte('purge_after', now.toISOString())
    .order('purge_after', { ascending: true })
    .limit(opts.limit ?? PURGE_BATCH)
  if (error) throw new Error(`Reading pending consent requests failed: ${error.message}`)

  const deleteMember = opts.deleteMember ?? (async (memberId: string) => {
    const { executeDeletion } = await import('@/lib/deletion/execute')
    await executeDeletion('pending_consent_member', memberId, { mode: 'hard', deletedBy: null })
  })

  for (const row of (data ?? []) as Array<{ member_id: string }>) {
    result.scanned += 1
    const memberId = row.member_id
    try {
      if (await settlePendingConsent(db, memberId)) {
        result.cleared.push(memberId)
        continue
      }
      if (await guardianHasSigned(db, memberId)) {
        result.heldGuardianSigned.push(memberId)
        continue
      }
      await deleteMember(memberId)
      result.purged.push(memberId)
    } catch (err) {
      result.errors.push({ memberId, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return result
}
