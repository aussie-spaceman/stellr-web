// Group-team ownership check shared by the member portal team routes
// (teams list/detail, add-participant, sheet-sync).
//
// Two people manage a group registration with full edit rights:
//   1. the registrant — a teacher OR a school student manager (registrant_role),
//      stamped on registrations.teacher_member_id / teacher_email; and
//   2. the nominated Teacher Point of Contact — stored on a student-manager
//      registration as teacher_poc_email. The POC is co-responsible for the
//      group and must be able to see and edit it from their own /account.
//
// Historically ownership was keyed solely on teacher_member_id === the session
// member's id, plus a brittle event_role === 'teacher' gate. That broke whenever
// the registrant's Clerk session resolved to a *different* members row than the
// one stamped on the registration (e.g. the batched member upsert dropped the
// registrant, so teacher_member_id was never set and the Clerk webhook later
// created a fresh 'subscriber' row) — and it never recognised the student
// manager (whose member row is participant) or the teacher POC at all. The
// result was a 403 on every team action and an empty teams tab even though the
// person clearly owns the group.
//
// Email is the stable identity across those rows (the upsert, the webhook, and
// the registration all carry the same email), so we treat a case-insensitive
// teacher_email / teacher_poc_email match as ownership too. These are the same
// emails the registration was created under, so they grant no access the
// registrant / nominated POC didn't already have.

export interface TeamOwnerMember {
  id: string
  email: string | null
}

export interface TeamOwnerRegistration {
  teacher_member_id: string | null
  teacher_email: string | null
  // Present on student-manager registrations; optional so callers that don't
  // select it (and so can't grant POC access) still type-check.
  teacher_poc_email?: string | null
}

function norm(v: string | null | undefined): string | null {
  const s = v?.trim().toLowerCase()
  return s && s.length > 0 ? s : null
}

// True when the member is the registrant of this group (teacher or student
// manager) — by member id or by the email the group was registered under.
export function isTeamRegistrant(member: TeamOwnerMember, registration: TeamOwnerRegistration): boolean {
  if (registration.teacher_member_id && registration.teacher_member_id === member.id) return true
  const regEmail = norm(registration.teacher_email)
  const memberEmail = norm(member.email)
  return Boolean(regEmail && memberEmail && regEmail === memberEmail)
}

// True when the member is the nominated Teacher Point of Contact for this group.
export function isTeamPoc(member: TeamOwnerMember, registration: TeamOwnerRegistration): boolean {
  const pocEmail = norm(registration.teacher_poc_email)
  const memberEmail = norm(member.email)
  return Boolean(pocEmail && memberEmail && pocEmail === memberEmail)
}

// The registrant and the teacher POC both fully own the team.
export function ownsTeam(member: TeamOwnerMember, registration: TeamOwnerRegistration): boolean {
  return isTeamRegistrant(member, registration) || isTeamPoc(member, registration)
}

export type TeamViewerRole = 'teacher' | 'student_manager' | 'teacher_poc'

export interface TeamViewerRegistration extends TeamOwnerRegistration {
  registrant_role?: string | null
}

// How this member relates to the group — used to label the team in the portal.
// The registrant takes precedence (a teacher who is also their own POC reads as
// the organiser); a student-manager registrant reads as 'student_manager'.
export function teamViewerRole(
  member: TeamOwnerMember,
  registration: TeamViewerRegistration,
): TeamViewerRole | null {
  if (isTeamRegistrant(member, registration)) {
    return registration.registrant_role === 'student_manager' ? 'student_manager' : 'teacher'
  }
  if (isTeamPoc(member, registration)) return 'teacher_poc'
  return null
}
