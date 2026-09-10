import { describe, it, expect } from 'vitest'
import { normalizeGrade, denormalizeGrade, VALID_GRADES } from './member-enums'
import { SCHOOL_GRADES, deriveAgeBracket } from './registration-constants'

// `participants.grade` is text and always accepted "7"; `members.grade` is the
// grade_type enum, which started at grade_9. So a seventh-grader could register
// for a grades 7–12 event, pay, and appear on the roster while normalizeGrade
// quietly returned null and their member profile carried no grade at all.
describe('normalizeGrade', () => {
  it('maps every offerable school grade to an enum value', () => {
    for (const g of SCHOOL_GRADES) {
      expect(normalizeGrade(g), `grade ${g}`).toBe(`grade_${g}`)
    }
  })

  it('round-trips the middle-school grades through the display form', () => {
    expect(normalizeGrade('7')).toBe('grade_7')
    expect(denormalizeGrade('grade_7')).toBe('7')
    expect(normalizeGrade('8')).toBe('grade_8')
    expect(denormalizeGrade('grade_8')).toBe('8')
  })

  it('still rejects a grade with no enum value rather than inventing one', () => {
    expect(normalizeGrade('5')).toBeNull()
    expect(normalizeGrade('')).toBeNull()
    expect(normalizeGrade(null)).toBeNull()
  })

  it('keeps the enum list in school order', () => {
    expect(VALID_GRADES.indexOf('grade_6')).toBeLessThan(VALID_GRADES.indexOf('grade_7'))
    expect(VALID_GRADES.indexOf('grade_7')).toBeLessThan(VALID_GRADES.indexOf('grade_9'))
  })
})

// The bracket gates minor consent and the student membership tier. A
// seventh-grader needs both exactly as a freshman does, so they belong in the
// same bracket despite its name.
describe('deriveAgeBracket', () => {
  it('treats a middle-school grade as a school student', () => {
    expect(deriveAgeBracket('2013-05-01', '7')).toBe('High School')
    expect(deriveAgeBracket('2013-05-01', '8')).toBe('High School')
  })

  it('still separates college and adult', () => {
    expect(deriveAgeBracket('2004-05-01', 'College Junior')).toBe('College')
    expect(deriveAgeBracket('1985-05-01', '')).toBe('Adult')
  })
})
