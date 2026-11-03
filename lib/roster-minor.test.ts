import { describe, it, expect } from 'vitest'
import { isAdultByRole } from './roster-minor'
import { ADULT_ROLES, STUDENT_ROLES } from './membership-rules'
import { VALID_EVENT_ROLES } from './member-enums'

// S0 (3 Nov 2026): "an adult by role" lets a participant row with no usable
// date of birth skip the presumption that it is a minor. It used to mean any
// role that was not a student role, so 'subscriber', a legacy "Student" and
// any string nobody recognised counted as an adult. It is an allowlist now.

describe('isAdultByRole', () => {
  it('is true for the roles only an adult is registered under', () => {
    for (const role of ['teacher', 'mentor', 'volunteer', 'parent', 'adult']) {
      expect(isAdultByRole(role), role).toBe(true)
    }
  })

  it('reads a role the way classifyAgreement does: any case, spaces as underscores', () => {
    for (const role of ['Teacher', 'MENTOR', ' Volunteer ', 'Parent', 'Adult']) {
      expect(isAdultByRole(role), role).toBe(true)
    }
  })

  it('is false for a student role, in any spelling the data has held', () => {
    for (const role of [
      'participant', 'school_student_manager', 'School Student Manager',
      'student', 'Student', 'school_student', 'School Student',
    ]) {
      expect(isAdultByRole(role), role).toBe(false)
    }
  })

  it('is false for the subscriber placeholder, a donor, no role, and anything it does not know', () => {
    for (const role of ['subscriber', 'Subscriber', 'donor', 'chaperone', 'coach', 'teacher assistant', '', null, undefined]) {
      expect(isAdultByRole(role), String(role)).toBe(false)
    }
  })

  it('covers every adult value of the event_role enum and no student one', () => {
    for (const role of ADULT_ROLES) expect(VALID_EVENT_ROLES as readonly string[]).toContain(role)
    for (const role of STUDENT_ROLES) expect(ADULT_ROLES as readonly string[]).not.toContain(role)
    expect(ADULT_ROLES as readonly string[]).not.toContain('subscriber')
  })
})
