// Compliance derivation for background checks & teacher licenses (PRD §13).
//
// One place that answers two questions, shared by the member portal, the admin
// member page, the audit dashboard and the event roster so they always agree:
//
//   requiresBackgroundCheck(role, dob) — does this person need clearance?
//   deriveCompliance(license, checks, role, dob) — what's their current state?
//
// The rule keys off ROLE, not age: clearance is required for an adult (18+) in an
// EVENT-FACING role — one that puts them in a room with students. Student roles
// are exempt regardless of age (a school student who has turned 18 is still
// treated as a minor), and so are roles that never attend: subscriber and parent.
// The original June 2026 rule required every non-student adult, which put every
// newsletter subscriber on the audit page; narrowed 21 Sept 2026.

import type { SupabaseClient } from '@supabase/supabase-js'
import { formatDateShort } from '@/lib/utils'

// Student roles never require a background check (even at 18+). Kept as an
// export because the roster and volunteer code use it to mean "is a student".
export const STUDENT_ROLES = ['participant', 'school_student_manager'] as const

// Roles that DO require clearance once the person is 18: the ones that attend
// events alongside students. An empty or unrecognised role does not qualify —
// the requirement is opt-in by role, so a member we cannot place is not put on
// the audit page or offered a check.
export const BC_REQUIRED_ROLES = ['teacher', 'mentor', 'volunteer', 'adult'] as const

// Background-check validity: 3 years from completion (Stellr-enforced).
export const BC_VALIDITY_YEARS = 3

export type ComplianceState =
  | 'not_required' // student, non-event role, or under 18 — no clearance needed
  | 'valid_bc' // a passed, non-expired background check is on file
  | 'valid_license' // a verified, non-expired teacher license is on file
  | 'in_process' // a check is invited/running, or a license awaits verification
  | 'flagged' // a Consider result nobody has adjudicated yet — NOT cleared
  | 'cancelled' // the check was canceled before completing — just needs re-ordering
  | 'expired' // the invitation expired without completion — just needs re-ordering
  | 'invalid' // required but nothing valid on file (missing, expired, or flagged)

export interface TeacherLicense {
  id: string
  license_number: string
  licensing_state: string
  expiry_date: string // ISO date
  verified_at: string | null
  verified_label: string | null
  /** Storage path of an uploaded license image (private bucket), or null. */
  document_path: string | null
}

export interface BackgroundCheck {
  id: string
  status: 'invited' | 'in_progress' | 'passed' | 'referred' | 'cancelled' | 'expired' | 'error'
  result: string | null
  /** Checkr Assess tag (eligible / review / escalated), when present. */
  assessment: string | null
  /** A completed report that contained one or more canceled screenings. */
  includes_canceled: boolean
  /** Vendor report id (Checkr) — the handle for a "view report" link. */
  provider_report_ref: string | null
  /** When a human decided on a flagged (Consider) report; null = nobody has. */
  adjudicated_at: string | null
  /** 'cleared' = may participate despite the records found; 'not_cleared' = may not. */
  adjudication_outcome: 'cleared' | 'not_cleared' | null
  /** Who decided, captured at decision time. */
  adjudicated_label: string | null
  adjudication_notes: string | null
  /** Checkr's own adjudication field, for comparison with ours. */
  provider_adjudication: string | null
  ordered_at: string
  completed_at: string | null
  expires_at: string | null
  report_pdf_url: string | null
}

export interface ComplianceSummary {
  state: ComplianceState
  /** Short human label, e.g. "Verified license expires 12 May 2027". */
  detail: string | null
  license: TeacherLicense | null
  /** The member's current (newest) background check, if any. */
  check: BackgroundCheck | null
}

function isMinor(dateOfBirth: string | null | undefined, ref: Date = new Date()): boolean {
  if (!dateOfBirth) return false // unknown DOB → treat as adult (safer: require check)
  const dob = new Date(dateOfBirth)
  const age = (ref.getTime() - dob.getTime()) / (365.25 * 24 * 3600 * 1000)
  return age < 18
}

/**
 * Does this member need a background check or a verified license to take part?
 * True for an event-facing role (BC_REQUIRED_ROLES) aged 18+. `eventDate` lets
 * the roster evaluate the person's age as of the event (matching
 * lib/event-admin.isMinor).
 */
export function requiresBackgroundCheck(
  eventRole: string | null | undefined,
  dateOfBirth: string | null | undefined,
  eventDate?: string,
): boolean {
  const role = (eventRole ?? '').toLowerCase()
  if (!(BC_REQUIRED_ROLES as readonly string[]).includes(role)) return false
  return !isMinor(dateOfBirth, eventDate ? new Date(eventDate) : new Date())
}

function licenseExpired(l: TeacherLicense, ref: Date): boolean {
  return new Date(l.expiry_date) < ref
}


/**
 * Compute the single current compliance state for a member from their current
 * license and their background-check history. Pass the member's role/dob so a
 * person who doesn't need clearance returns 'not_required' rather than 'invalid'.
 *
 * Precedence (user-confirmed): a valid license or passed BC (green) beats an
 * in-process item (orange), which beats nothing/expired (red "Invalid").
 */
export function deriveCompliance(
  license: TeacherLicense | null,
  checks: BackgroundCheck[],
  eventRole: string | null | undefined,
  dateOfBirth: string | null | undefined,
  eventDate?: string,
): ComplianceSummary {
  const ref = eventDate ? new Date(eventDate) : new Date()
  // Current check = newest by ordered_at.
  const check =
    [...checks].sort((a, b) => new Date(b.ordered_at).getTime() - new Date(a.ordered_at).getTime())[0] ??
    null

  if (!requiresBackgroundCheck(eventRole, dateOfBirth, eventDate)) {
    return { state: 'not_required', detail: null, license, check }
  }

  const licenseValid = !!license && !!license.verified_at && !licenseExpired(license, ref)
  const licensePending = !!license && !license.verified_at && !licenseExpired(license, ref)

  // A Consider that a human has adjudicated as 'cleared' clears the person just
  // as a clear report does. The check's own `status` stays 'referred' — it
  // mirrors the vendor's report status, which is what the Checkr certification
  // compares — so the decision lives alongside it rather than overwriting it.
  const bcCleared =
    !!check && (check.status === 'passed' || (check.status === 'referred' && check.adjudication_outcome === 'cleared'))
  const bcValid = bcCleared && !!check!.expires_at && new Date(check!.expires_at) > ref
  const bcInProcess = !!check && (check.status === 'invited' || check.status === 'in_progress')
  // Flagged and nobody has looked at it yet. Distinct from 'invalid' because the
  // action is "someone must decide", not "order a check" — and because an admin
  // needs to be able to count and filter the ones awaiting a decision.
  const bcFlagged = !!check && check.status === 'referred' && !check.adjudicated_at

  if (bcValid) {
    const base = check!.expires_at
      ? `Background check valid until ${formatDateShort(check!.expires_at)}`
      : 'Background check passed'
    const withCanceled = check!.includes_canceled ? `${base} (completed with canceled screenings)` : base
    return {
      state: 'valid_bc',
      detail:
        check!.status === 'referred'
          ? `${withCanceled} — cleared on review${check!.adjudicated_label ? ` by ${check!.adjudicated_label}` : ''}`
          : withCanceled,
      license,
      check,
    }
  }
  if (licenseValid) {
    return {
      state: 'valid_license',
      detail: `Verified license expires ${formatDateShort(license!.expiry_date)}`,
      license,
      check,
    }
  }
  if (bcInProcess) {
    return {
      state: 'in_process',
      detail: check!.status === 'invited' ? 'Background check invitation sent' : 'Background check in progress',
      license,
      check,
    }
  }
  if (bcFlagged) {
    return {
      state: 'flagged',
      detail: 'Background check flagged — awaiting review by the adjudicator',
      license,
      check,
    }
  }
  if (licensePending) {
    return { state: 'in_process', detail: 'License awaiting verification', license, check }
  }

  // Required, but not cleared. A canceled or expired check is an operational state
  // (the attempt ended; just re-order) — surface it distinctly rather than as a
  // red "Invalid". The person is still not cleared, so it never reads as compliant.
  if (check?.status === 'cancelled') {
    return { state: 'cancelled', detail: 'Background check was canceled — re-order required', license, check }
  }
  if (check?.status === 'expired') {
    return { state: 'expired', detail: 'Background check invitation expired — re-order required', license, check }
  }

  // Otherwise genuinely invalid: missing, expired clearance, or flagged for review.
  let detail = 'No valid clearance on file'
  if (check?.status === 'referred' && check.adjudication_outcome === 'not_cleared') {
    detail = `Not cleared on review${check.adjudicated_label ? ` by ${check.adjudicated_label}` : ''}${
      check.adjudicated_at ? ` (${formatDateShort(check.adjudicated_at)})` : ''
    }`
  } else if (license && licenseExpired(license, ref)) detail = `License expired ${formatDateShort(license.expiry_date)}`
  else if (check?.status === 'referred') detail = 'Background check flagged for review'
  else if (bcCleared && check?.expires_at) detail = `Background check expired ${formatDateShort(check.expires_at)}`
  return { state: 'invalid', detail, license, check }
}

// Row shapes as returned by the nested Supabase select below.
type LicenseRow = TeacherLicense
type CheckRow = BackgroundCheck
interface MemberComplianceRow {
  id: string
  email: string | null
  event_role: string | null
  date_of_birth: string | null
  member_teacher_licenses: LicenseRow[] | null
  member_background_checks: CheckRow[] | null
}

const COMPLIANCE_SELECT = `
  id, email, event_role, date_of_birth,
  member_teacher_licenses!member_id(id, license_number, licensing_state, expiry_date, verified_at, verified_label, document_path),
  member_background_checks!member_id(id, status, result, assessment, includes_canceled, provider_report_ref, ordered_at, completed_at, expires_at, report_pdf_url, adjudicated_at, adjudication_outcome, adjudicated_label, adjudication_notes, provider_adjudication)
`

export interface ComplianceRecords {
  license: TeacherLicense | null
  checks: BackgroundCheck[]
}

/**
 * Load the raw license + background-check records for a set of member emails in
 * one query — used by the event roster, where the requirement is driven by the
 * participant's role for THIS event (not the member row's role), so the caller
 * derives the state itself with deriveCompliance(). Emails with no member row
 * are simply absent from the map; the caller treats those as 'invalid' when a
 * check is required.
 */
export async function loadComplianceRecordsByEmails(
  db: SupabaseClient,
  emails: string[],
): Promise<Map<string, ComplianceRecords>> {
  const out = new Map<string, ComplianceRecords>()
  const unique = [...new Set(emails.map((e) => (e ?? '').trim().toLowerCase()).filter(Boolean))]
  if (unique.length === 0) return out

  const { data } = await db.from('members').select(COMPLIANCE_SELECT).in('email', unique)
  for (const row of (data as MemberComplianceRow[] | null) ?? []) {
    if (!row.email) continue
    out.set(row.email.toLowerCase(), {
      license: row.member_teacher_licenses?.[0] ?? null,
      checks: row.member_background_checks ?? [],
    })
  }
  return out
}

/** Load and derive a single member's compliance by id. */
export async function loadComplianceForMember(
  db: SupabaseClient,
  memberId: string,
): Promise<ComplianceSummary | null> {
  const { data } = await db.from('members').select(COMPLIANCE_SELECT).eq('id', memberId).maybeSingle()
  const row = data as MemberComplianceRow | null
  if (!row) return null
  return deriveCompliance(
    row.member_teacher_licenses?.[0] ?? null,
    row.member_background_checks ?? [],
    row.event_role,
    row.date_of_birth,
  )
}
