// Group-team ownership check shared by the member portal team routes
// (teams list/detail, add-participant, sheet-sync).
//
// A group registrant is the "owner" of their team. Historically that was keyed
// solely on registrations.teacher_member_id === the session member's id, plus a
// brittle event_role === 'teacher' gate. That broke whenever the registrant's
// Clerk session resolved to a *different* members row than the one stamped on
// the registration — e.g. the batched member upsert dropped the registrant, so
// teacher_member_id was never set and the Clerk webhook later created a fresh
// 'subscriber' row. The result was a 403 on every team action and an empty
// teams tab even though the person clearly registered the group.
//
// Email is the stable identity across those rows (the upsert, the webhook, and
// the registration all carry the same email), so we treat a case-insensitive
// teacher_email match as ownership too. This is the same email the registration
// was created under, so it grants no access the registrant didn't already have.

export interface TeamOwnerMember {
  id: string
  email: string | null
}

export interface TeamOwnerRegistration {
  teacher_member_id: string | null
  teacher_email: string | null
}

export function ownsTeam(member: TeamOwnerMember, registration: TeamOwnerRegistration): boolean {
  if (registration.teacher_member_id && registration.teacher_member_id === member.id) return true
  const regEmail = registration.teacher_email?.trim().toLowerCase()
  const memberEmail = member.email?.trim().toLowerCase()
  return Boolean(regEmail && memberEmail && regEmail === memberEmail)
}
