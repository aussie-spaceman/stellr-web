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

export function getEligibleTierNames(bracket: string, role: string): string[] {
  if (bracket === 'high_school') return ['Explorer', 'Pathfinder', 'Scholar']
  if (bracket === 'college') return ['Advisor', 'Contributor', 'Counsellor', 'Luminary']
  if (bracket === 'adult' && role === 'teacher') return ['Educator', 'Innovator']
  if (bracket === 'adult' && role === 'mentor') return ['Donor', 'Expert']
  if (bracket === 'adult' && role === 'parent') return ['Parent / Guardian']
  return []
}
