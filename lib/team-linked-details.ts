import { isRegistrationMinor } from '@/lib/registration-eligibility'

// What an organiser sees of a roster row filled from a member's own record through
// a Member ID link: who the person is on the team and how their paperwork and
// payment stand. The stored details belong to the member. A person viewing their
// own row sees it in full.

const VISIBLE_TO_ORGANISER = [
  'id',
  'registration_id',
  'first_name',
  'last_name',
  'event_role',
  'event_companies',
  'join_completed_at',
  'individual_payment_status',
] as const

interface RosterRow {
  member_id?: unknown
  details_from_member?: unknown
  date_of_birth?: unknown
  [key: string]: unknown
}

export function isDetailsHiddenFrom(row: RosterRow, viewerMemberId: string): boolean {
  return row.details_from_member === true && row.member_id !== viewerMemberId
}

export function organiserViewOfParticipant(row: RosterRow, viewerMemberId: string): Record<string, unknown> {
  if (!isDetailsHiddenFrom(row, viewerMemberId)) return row
  const view: Record<string, unknown> = { details_hidden: true }
  for (const key of VISIBLE_TO_ORGANISER) {
    if (key in row) view[key] = row[key]
  }
  // The consent summary counts minors. The form sent already says as much.
  view.is_minor = isRegistrationMinor(row.date_of_birth)
  return view
}

export const DETAILS_MEMBER_MANAGED = {
  code: 'details_member_managed',
  error: "This person keeps their details in their own Stellr profile, so they can't be changed here.",
} as const
