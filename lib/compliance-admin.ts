// Admin compliance audit (PRD §13): list every adult who needs clearance and
// derive their current state, so admins can spot lapsed background checks /
// licenses and review newly submitted licenses.

import { supabaseServer } from '@/lib/supabase'
import {
  deriveCompliance,
  requiresBackgroundCheck,
  STUDENT_ROLES,
  type ComplianceState,
  type TeacherLicense,
  type BackgroundCheck,
} from '@/lib/compliance'

export interface ComplianceAuditRow {
  memberId: string
  name: string
  email: string | null
  eventRole: string | null
  state: ComplianceState
  detail: string | null
  license: TeacherLicense | null
  check: { status: string; ordered_at: string; expires_at: string | null } | null
}

export interface ComplianceAudit {
  rows: ComplianceAuditRow[]
  counts: Record<ComplianceState, number>
  /** Members with a license submitted but not yet verified (review queue). */
  reviewQueue: ComplianceAuditRow[]
}

interface MemberRow {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  event_role: string | null
  date_of_birth: string | null
  is_active: boolean | null
  member_teacher_licenses: TeacherLicense[] | null
  member_background_checks: BackgroundCheck[] | null
}

// Sort: things needing attention first (invalid, then in_process), then cleared.
const STATE_ORDER: Record<ComplianceState, number> = {
  invalid: 0,
  cancelled: 0,
  expired: 0,
  in_process: 1,
  valid_license: 2,
  valid_bc: 2,
  not_required: 3,
}

export async function getComplianceAudit(): Promise<ComplianceAudit> {
  const db = supabaseServer()

  // Candidate set: active members in a non-student role. Age (18+) is applied in
  // JS via requiresBackgroundCheck so the rule stays in one place.
  const { data } = await db
    .from('members')
    .select(`
      id, first_name, last_name, email, event_role, date_of_birth, is_active,
      member_teacher_licenses!member_id(id, license_number, licensing_state, expiry_date, verified_at, verified_label),
      member_background_checks!member_id(id, status, result, assessment, includes_canceled, provider_report_ref, ordered_at, completed_at, expires_at, report_pdf_url)
    `)
    .not('event_role', 'in', `(${STUDENT_ROLES.join(',')})`)
    .or('is_active.is.null,is_active.eq.true')

  const rows: ComplianceAuditRow[] = []
  for (const m of (data as MemberRow[] | null) ?? []) {
    if (!requiresBackgroundCheck(m.event_role, m.date_of_birth)) continue
    const summary = deriveCompliance(
      m.member_teacher_licenses?.[0] ?? null,
      m.member_background_checks ?? [],
      m.event_role,
      m.date_of_birth,
    )
    rows.push({
      memberId: m.id,
      name: [m.first_name, m.last_name].filter(Boolean).join(' ') || (m.email ?? 'Unknown'),
      email: m.email,
      eventRole: m.event_role,
      state: summary.state,
      detail: summary.detail,
      license: summary.license,
      check: summary.check
        ? { status: summary.check.status, ordered_at: summary.check.ordered_at, expires_at: summary.check.expires_at }
        : null,
    })
  }

  rows.sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.name.localeCompare(b.name))

  const counts: Record<ComplianceState, number> = {
    not_required: 0, valid_bc: 0, valid_license: 0, in_process: 0, cancelled: 0, expired: 0, invalid: 0,
  }
  for (const r of rows) counts[r.state]++

  const reviewQueue = rows.filter((r) => r.license && !r.license.verified_at)

  return { rows, counts, reviewQueue }
}
