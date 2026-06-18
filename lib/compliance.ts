// Compliance derivation for background checks & teacher licenses (PRD §13).
//
// One place that answers two questions, shared by the member portal, the admin
// member page, the audit dashboard and the event roster so they always agree:
//
//   requiresBackgroundCheck(role, dob) — does this person need clearance?
//   deriveCompliance(license, checks, role, dob) — what's their current state?
//
// The rule keys off ROLE, not age: clearance is required for any NON-student who
// is 18+. That naturally exempts the PRD edge case — a school student who has
// turned 18 is still treated as a minor and needs no check — because the student
// roles are excluded regardless of age.

import type { SupabaseClient } from '@supabase/supabase-js'

// Student roles never require a background check (even at 18+). Everyone else
// (teacher / mentor / adult / parent / subscriber) does once they are 18.
export const STUDENT_ROLES = ['school_student', 'school_student_manager'] as const

// Background-check validity: 3 years from completion (Stellr-enforced).
export const BC_VALIDITY_YEARS = 3

export type ComplianceState =
  | 'not_required' // student, or under 18 — no clearance needed
  | 'valid_bc' // a passed, non-expired background check is on file
  | 'valid_license' // a verified, non-expired teacher license is on file
  | 'in_process' // a check is invited/running, or a license awaits verification
  | 'invalid' // required but nothing valid on file (missing or expired)

export interface TeacherLicense {
  id: string
  license_number: string
  licensing_state: string
  expiry_date: string // ISO date
  verified_at: string | null
  verified_label: string | null
}

export interface BackgroundCheck {
  id: string
  status: 'invited' | 'in_progress' | 'passed' | 'referred' | 'cancelled' | 'error'
  result: string | null
  /** Vendor report id (Checkr) — the handle for a "view report" link. */
  provider_report_ref: string | null
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
 * True for non-student roles aged 18+. `eventDate` lets the roster evaluate the
 * person's age as of the event (matching lib/event-admin.isMinor).
 */
export function requiresBackgroundCheck(
  eventRole: string | null | undefined,
  dateOfBirth: string | null | undefined,
  eventDate?: string,
): boolean {
  const role = (eventRole ?? '').toLowerCase()
  if ((STUDENT_ROLES as readonly string[]).includes(role)) return false
  return !isMinor(dateOfBirth, eventDate ? new Date(eventDate) : new Date())
}

function licenseExpired(l: TeacherLicense, ref: Date): boolean {
  return new Date(l.expiry_date) < ref
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
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

  const bcValid =
    !!check && check.status === 'passed' && !!check.expires_at && new Date(check.expires_at) > ref
  const bcInProcess = !!check && (check.status === 'invited' || check.status === 'in_progress')

  if (bcValid) {
    return {
      state: 'valid_bc',
      detail: check!.expires_at ? `Background check valid until ${fmtDate(check!.expires_at)}` : 'Background check passed',
      license,
      check,
    }
  }
  if (licenseValid) {
    return {
      state: 'valid_license',
      detail: `Verified license expires ${fmtDate(license!.expiry_date)}`,
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
  if (licensePending) {
    return { state: 'in_process', detail: 'License awaiting verification', license, check }
  }

  // Required, but nothing valid on file — missing, expired, or referred.
  let detail = 'No valid clearance on file'
  if (license && licenseExpired(license, ref)) detail = `License expired ${fmtDate(license.expiry_date)}`
  else if (check?.status === 'referred') detail = 'Background check flagged for review'
  else if (check?.status === 'passed' && check.expires_at) detail = `Background check expired ${fmtDate(check.expires_at)}`
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
  member_teacher_licenses(id, license_number, licensing_state, expiry_date, verified_at, verified_label),
  member_background_checks(id, status, result, provider_report_ref, ordered_at, completed_at, expires_at, report_pdf_url)
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
