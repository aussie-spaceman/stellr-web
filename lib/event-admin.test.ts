import { describe, it, expect, vi } from 'vitest'

// S0 (2 Nov 2026): lib/age presumes an unknown date of birth is a minor. On the
// roster that is right for a student row, but an adult by role (a mentor or
// teacher added from the sheet before S0 with a blank date) signs an adult's
// agreement, and flagging them as an outstanding minor consent would send the
// check-in desk after paperwork that does not exist.

vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({}) }))

const { isRosterMinor } = await import('./event-admin')

const EVENT = '2026-11-06'

describe('isRosterMinor', () => {
  it('presumes a student row with no usable date of birth is a minor', () => {
    for (const role of ['participant', 'school_student_manager', null]) {
      expect(isRosterMinor(null, role, EVENT), String(role)).toBe(true)
      expect(isRosterMinor('not a date', role, EVENT), String(role)).toBe(true)
    }
  })

  it('does not presume an adult by role with no date of birth is a minor', () => {
    for (const role of ['mentor', 'volunteer', 'teacher', 'adult', 'parent']) {
      expect(isRosterMinor(null, role, EVENT), role).toBe(false)
      expect(isRosterMinor('', role, EVENT), role).toBe(false)
    }
  })

  it('judges a subscriber, a legacy student spelling or an unknown role as a student', () => {
    // Not adults by role (3 Nov 2026), so with no usable date of birth they are
    // presumed minors. participants.date_of_birth is NOT NULL, so on a real
    // row that means a future-dated one.
    for (const role of ['subscriber', 'donor', 'student', 'Student', 'School Student', 'chaperone']) {
      expect(isRosterMinor(null, role, EVENT), role).toBe(true)
      expect(isRosterMinor('2099-01-01', role, EVENT), role).toBe(true)
    }
  })

  it('still reads a legacy spelling of an adult role as an adult', () => {
    for (const role of ['Teacher', 'Mentor', 'Volunteer']) {
      expect(isRosterMinor('2099-01-01', role, EVENT), role).toBe(false)
    }
  })

  it('a known date of birth decides for every role, on the event date', () => {
    expect(isRosterMinor('2010-01-01', 'mentor', EVENT)).toBe(true)
    expect(isRosterMinor('2008-11-06', 'participant', EVENT)).toBe(false) // 18 on the day
    expect(isRosterMinor('2008-11-07', 'participant', EVENT)).toBe(true) // 18 the day after
    expect(isRosterMinor('1985-04-02', 'teacher', EVENT)).toBe(false)
    expect(isRosterMinor('1985-04-02', 'subscriber', EVENT)).toBe(false)
    expect(isRosterMinor('2010-01-01', 'subscriber', EVENT)).toBe(true)
  })
})
