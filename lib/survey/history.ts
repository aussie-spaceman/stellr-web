/**
 * A member's surveys as account history: what the admin member page lists,
 * what the account page's event history chips show, and which submissions the
 * activity log has yet to record. Pure functions over plain rows so the rules
 * can be tested without a database; lib/survey/member.ts loads the rows.
 */
import { effectiveStatus, type DistributionStatus } from './schedule'

/** One invitation with its distribution and (if begun) its response. */
export interface MemberSurveyRow {
  invitationId: string
  status: string
  role: 'student' | 'mentor' | 'adult'
  adultRelationship: 'parent' | 'teacher' | null
  sendVia: 'self' | 'guardian'
  invitedAt: string
  distribution: {
    id: string
    eventSlug: string
    eventTitle: string | null
    status: DistributionStatus
    opensAt: string
    closesAt: string
  }
  responseId: string | null
  submittedAt: string | null
}

export type SurveyStatusKey = 'invited' | 'opened' | 'started' | 'submitted' | 'closed' | 'bounced'

export const SURVEY_STATUS_LABEL: Record<SurveyStatusKey, string> = {
  invited: 'Invited',
  opened: 'Opened',
  started: 'Started',
  submitted: 'Submitted',
  closed: 'Closed',
  bounced: 'Email bounced',
}

/**
 * Where one invitation stands. A submission wins; otherwise a survey that has
 * closed (or an invitation that expired unsent) reads as closed, whatever
 * progress was made before it did.
 */
export function surveyStatusOf(row: Pick<MemberSurveyRow, 'status' | 'submittedAt' | 'distribution'>, now = new Date()): SurveyStatusKey {
  if (row.submittedAt || row.status === 'submitted') return 'submitted'
  const d = row.distribution
  if (row.status === 'expired' || effectiveStatus({ status: d.status, opens_at: d.opensAt, closes_at: d.closesAt }, now) === 'closed') return 'closed'
  if (row.status === 'started') return 'started'
  if (row.status === 'opened') return 'opened'
  if (row.status === 'bounced') return 'bounced'
  return 'invited'
}

export function surveyRoleLabel(row: Pick<MemberSurveyRow, 'role' | 'adultRelationship' | 'sendVia'>): string {
  const base = row.role === 'adult' ? (row.adultRelationship === 'teacher' ? 'Teacher' : row.adultRelationship === 'parent' ? 'Parent' : 'Adult') : row.role === 'mentor' ? 'Mentor' : 'Student'
  return row.sendVia === 'guardian' ? `${base} (sent to guardian)` : base
}

/** One line of the Surveys card on the admin member page. */
export interface MemberSurveyItem {
  invitationId: string
  eventTitle: string
  role: string
  status: SurveyStatusKey
  statusLabel: string
  invitedAt: string
  submittedAt: string | null
  responseId: string | null
}

export function toMemberSurveyItems(rows: MemberSurveyRow[], now = new Date()): MemberSurveyItem[] {
  return rows.map((r) => {
    const status = surveyStatusOf(r, now)
    return {
      invitationId: r.invitationId,
      eventTitle: r.distribution.eventTitle ?? r.distribution.eventSlug,
      role: surveyRoleLabel(r),
      status,
      statusLabel: SURVEY_STATUS_LABEL[status],
      invitedAt: r.invitedAt,
      submittedAt: r.submittedAt,
      responseId: r.responseId,
    }
  })
}

export type SurveyChip =
  | { kind: 'submitted'; responseId: string }
  | { kind: 'open'; invitationId: string; started: boolean }

/**
 * The survey chip for each event on the account page, keyed by event slug: a
 * submitted response (to view), else a survey open now (to start or finish).
 * Nothing for a survey that closed unanswered or hasn't opened.
 */
export function surveyChipsByEvent(rows: MemberSurveyRow[], now = new Date()): Record<string, SurveyChip> {
  const out: Record<string, SurveyChip> = {}
  for (const r of rows) {
    const slug = r.distribution.eventSlug
    if (out[slug]?.kind === 'submitted') continue
    if (r.responseId && r.submittedAt) {
      out[slug] = { kind: 'submitted', responseId: r.responseId }
      continue
    }
    if (out[slug]) continue
    const d = r.distribution
    const open = effectiveStatus({ status: d.status, opens_at: d.opensAt, closes_at: d.closesAt }, now) === 'open'
    if (open && r.status !== 'expired') out[slug] = { kind: 'open', invitationId: r.invitationId, started: r.status === 'started' }
  }
  return out
}

/** A response matches a member by account, or by one of their participant rows. */
export function responseBelongsTo(
  owner: { memberId: string | null; participantId: string | null },
  memberId: string,
  participantIds: string[],
): boolean {
  return owner.memberId === memberId || (!!owner.participantId && participantIds.includes(owner.participantId))
}

/**
 * Submitted responses the member's activity log has no `survey_submitted`
 * entry for — answered before the account was linked, so the submit never
 * logged. `loggedResponseIds` are the response_ids already recorded.
 */
export function unloggedSubmissions<T extends { id: string }>(responses: T[], loggedResponseIds: Iterable<string>): T[] {
  const logged = new Set(loggedResponseIds)
  return responses.filter((r) => !logged.has(r.id))
}
