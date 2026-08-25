// Which onboarding questions apply to which audience, and which of them are
// mandatory.
//
// Two places enforce this and they MUST agree: the wizard
// (components/member/OnboardingForm.tsx) decides what to ask, and the route it
// posts to (app/api/members/onboarding/route.ts) rejects what is missing. Any
// drift is a dead end for the member — a field the wizard never showed comes
// back as a 400 they have no way to satisfy. Hence one shared rule set rather
// than the two hand-mirrored copies this replaces.

/** 'hidden' — don't ask. 'optional' — ask, never block. 'required' — must answer. */
export type FieldRule = 'hidden' | 'optional' | 'required'

export interface OnboardingAudience {
  event_role: string
  age_bracket: string
  /** ISO date. Drives the minor check; absent means "not known yet". */
  date_of_birth?: string
  /** True on the /volunteer program entry point, where the role is locked to
   *  'volunteer' before the member reaches the details step. */
  volunteerFlow?: boolean
}

export interface OnboardingRequirements {
  /** A participant: the audience the student-only questions are aimed at. */
  isStudent: boolean
  /** A mentor: attends events, but is not a participant. */
  isMentor: boolean
  /** Under 18 on today's date. */
  isMinor: boolean
  grade: FieldRule
  tshirtSize: FieldRule
  /** Never 'hidden' — the school input always renders, labelled optional. */
  school: FieldRule
  emergencyContact: FieldRule
}

/** Under 18 today. Exact to the day, not a year subtraction: someone born in
 *  December is still 17 for most of their eighteenth calendar year. */
export function isMinorDob(dob: string | undefined | null): boolean {
  if (!dob) return false
  const d = new Date(dob)
  if (Number.isNaN(d.getTime())) return false
  const eighteenth = new Date(d.getFullYear() + 18, d.getMonth(), d.getDate())
  return new Date() < eighteenth
}

export function onboardingRequirements(a: OnboardingAudience): OnboardingRequirements {
  const isVolunteerSignup = !!a.volunteerFlow || a.event_role === 'volunteer'

  // The bracket alone cannot answer this. 'Mentor / Volunteer' carries the
  // college bracket because a mentor is often a college student, which used to
  // sweep them into every student-only question — asking a working mentor for
  // their grade and forcing a school on them. A mentor is a helper, not a
  // participant: no grade, school optional. They still attend events, so the
  // t-shirt size and emergency contact stay mandatory.
  const isMentor = !isVolunteerSignup && a.event_role === 'mentor'
  const isStudent =
    !isVolunteerSignup && !isMentor && (a.age_bracket === 'high_school' || a.age_bracket === 'college')
  const isMinor = isMinorDob(a.date_of_birth)

  // A minor is stored as a high-school participant whatever they picked (the
  // route rewrites role and bracket on save), so the participant questions —
  // grade, and an emergency contact — are asked even when the role they chose
  // would not otherwise call for them. Volunteers are the exception: they are
  // blocked for being under 18 rather than questioned.
  const grade: FieldRule =
    !isVolunteerSignup && (isStudent || isMinor) ? 'required' : 'hidden'

  // Volunteers turn up to events too, so they are asked — but the /volunteer
  // signup is a low-friction front door and must not be blocked on either.
  const tshirtSize: FieldRule = isVolunteerSignup
    ? 'optional'
    : isStudent || isMentor
    ? 'required'
    : 'hidden'

  const emergencyContact: FieldRule = isVolunteerSignup
    ? 'optional'
    : isStudent || isMentor || isMinor
    ? 'required'
    : 'hidden'

  return {
    isStudent,
    isMentor,
    isMinor,
    grade,
    tshirtSize,
    // Students attend through a school and teachers represent one; everyone
    // else may add one but is never blocked on it.
    school: isStudent || a.event_role === 'teacher' ? 'required' : 'optional',
    emergencyContact,
  }
}

/** Emergency contact is all-or-nothing: a name with no phone number is not a
 *  contact. Returns true when every field is set, or none is. */
export function emergencyContactComplete(fields: Array<string | null | undefined>) {
  const filled = fields.map((v) => (typeof v === 'string' ? v.trim() : ''))
  return { any: filled.some(Boolean), all: filled.every(Boolean) }
}
