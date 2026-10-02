import { SITE_URL } from '@/lib/env'
import { ageOn, isMinorOn } from '@/lib/age'

// ── Verifiable credentials: pure helpers ─────────────────────────────────────
// Edge-safe (no Node crypto, no DocuSign): imported by the OG image and badge
// routes as well as by lib/credentials.ts, which re-exports everything here.
// Design: docs/PLAN-credentials-linkedin-2026-09-21.md.

export type CredentialSource = 'course' | 'event' | 'manual'
export type CredentialTheme = 'space' | 'environmental' | 'campaign'
export type CredentialStatus = 'issued' | 'revoked'
export type CredentialVisibility = 'private' | 'public'
export type CredentialEventKind = 'view' | 'linkedin_add' | 'linkedin_share' | 'copy_link' | 'pdf'

export interface CredentialRow {
  id: string
  number: string
  source: CredentialSource
  member_id: string | null
  participant_id: string | null
  module_id: string | null
  event_slug: string | null
  recipient_name: string
  title: string
  description: string | null
  criteria: string | null
  skills: string[]
  issuer: string
  role_label: string | null
  award: string | null
  /** Event credentials only: participation or a judged award (lib/event-awards). */
  award_type: string | null
  theme: CredentialTheme | null
  badge_path: string | null
  issued_at: string
  expires_at: string | null
  status: CredentialStatus
  revoked_at: string | null
  revoked_reason: string | null
  tombstoned_at: string | null
  visibility: CredentialVisibility
  is_minor: boolean
}

export const CREDENTIAL_COLUMNS =
  'id, number, source, member_id, participant_id, module_id, event_slug, recipient_name, title, description, criteria, skills, issuer, role_label, award, award_type, theme, badge_path, issued_at, expires_at, status, revoked_at, revoked_reason, tombstoned_at, visibility, is_minor'

/** What a verifier sees: the row's state collapsed to one word. */
export type CredentialState = 'valid' | 'expired' | 'revoked' | 'withdrawn'

export function credentialState(c: Pick<CredentialRow, 'status' | 'expires_at' | 'tombstoned_at'>, now = new Date()): CredentialState {
  if (c.tombstoned_at) return 'withdrawn'
  if (c.status === 'revoked') return 'revoked'
  if (c.expires_at && new Date(c.expires_at) < now) return 'expired'
  return 'valid'
}

export function credentialUrl(number: string): string {
  return `${SITE_URL}/credentials/${encodeURIComponent(number)}`
}

// ── Numbers ──────────────────────────────────────────────────────────────────


/** Both the new base32 and the legacy hex forms. Used to 404 junk before a DB hit. */
export const CREDENTIAL_NUMBER_RE = /^STL-\d{4}-[0-9A-Z]{6,8}$/

export function normaliseCredentialNumber(input: string): string | null {
  const n = input.trim().toUpperCase()
  return CREDENTIAL_NUMBER_RE.test(n) ? n : null
}

// ── Age ──────────────────────────────────────────────────────────────────────

// Defined in lib/age.ts so e-signing and credentials share one definition;
// re-exported here for the existing importers.
export { ageOn, isMinorOn }

/**
 * LinkedIn's minimum age is 16. The buttons are hidden below that regardless
 * of consent — we never point a 14-year-old at a service that will refuse
 * them. An unknown date of birth hides the buttons too: both members and
 * participants record one, so "unknown" means something is wrong.
 */
export function canUseLinkedIn(dateOfBirth: string | null | undefined, on = new Date()): boolean {
  if (!dateOfBirth) return false
  return ageOn(dateOfBirth, on) >= 16
}

/**
 * Credential pages of a child under 13 always stay private, whatever the
 * consent form says (Privacy Policy §2, §7.4; D5, 2 Oct). An unknown date of
 * birth is treated the same way: we cannot rule out a child, so we do not
 * publish. Both are read from the live DOB, not the `is_minor` flag stored at
 * issue, which goes stale.
 */
export const MIN_PUBLIC_CREDENTIAL_AGE = 13

export function ageBlock(
  dateOfBirth: string | null | undefined,
  on = new Date(),
): 'under_13' | 'dob_unknown' | null {
  if (!dateOfBirth || !/^\d{4}-\d{2}-\d{2}/.test(dateOfBirth)) return 'dob_unknown'
  return ageOn(dateOfBirth, on) < MIN_PUBLIC_CREDENTIAL_AGE ? 'under_13' : null
}

export type ShareConsent = 'not_required' | 'granted' | 'declined' | 'none' | 'under_13' | 'dob_unknown'

export type ShareBlock =
  | 'revoked' | 'withdrawn' | 'expired' | 'minor_no_consent' | 'minor_declined' | 'under_13' | 'dob_unknown'

/** Whether this credential may be made public / shared, and if not, why. */
export function canShare(
  c: CredentialRow,
  consent: ShareConsent,
): { ok: true } | { ok: false; reason: ShareBlock } {
  const state = credentialState(c)
  if (state !== 'valid') return { ok: false, reason: state }
  if (consent === 'under_13' || consent === 'dob_unknown') return { ok: false, reason: consent }
  if (consent === 'declined') return { ok: false, reason: 'minor_declined' }
  if (consent === 'none') return { ok: false, reason: 'minor_no_consent' }
  return { ok: true }
}
