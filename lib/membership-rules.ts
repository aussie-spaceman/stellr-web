// Shared membership classification rules used across admin and member portal

export const ROLES_FOR_BRACKET: Record<string, string[]> = {
  high_school: ['school_student', 'school_student_manager'],
  college: ['mentor'],
  adult: ['teacher', 'mentor', 'parent'],
}

export const DEFAULT_ROLE_FOR_BRACKET: Record<string, string> = {
  high_school: 'school_student',
  college: 'mentor',
  adult: 'teacher',
}

// Roles that have group management permissions (same as Teacher)
export const GROUP_MANAGER_ROLES = ['teacher', 'school_student_manager']

// Roles that count as a student participant. A Student Manager is a student who
// also organises the group, so they belong here alongside plain school students —
// used by event Companies auto-assign and participation certificates.
export const STUDENT_ROLES = ['school_student', 'school_student_manager']

// Canonical tier names per (bracket, role). Updated in the standardization sweep
// (migration 094) to the 10-tier schema; the retired tiers (Advisor, Counsellor,
// Luminary, Donor, Expert) are gone.
//
// FUTURE WORK — this (bracket, role) → tier mapping conflates the CONSUME axis
// (membership tier) with the role classification, which the canonical model keeps
// strictly separate. De-conflating it is the Phase 4 (roles) work. Two specific
// placeholders to revisit then:
//   • adult + mentor → Subscriber is an INTERIM. There is no canonical free tier
//     for adult mentors yet; this mirrors the repointed signup grant rule in
//     migration 094 and awaits the mentor/volunteer membership design.
//   • Catalyst is included in the educator ladder; confirm its eligibility surface.
export function getEligibleTierNames(bracket: string, role: string): string[] {
  if (bracket === 'high_school') return ['Explorer', 'Pathfinder', 'Scholar']
  if (bracket === 'college') return ['Alumni', 'Contributor', 'Counselor']
  if (bracket === 'adult' && role === 'teacher') return ['Educator', 'Catalyst', 'Innovator', 'Trailblazer']
  if (bracket === 'adult' && role === 'mentor') return ['Subscriber'] // interim — see note above
  if (bracket === 'adult' && role === 'parent') return ['Parent/Guardian']
  return []
}
