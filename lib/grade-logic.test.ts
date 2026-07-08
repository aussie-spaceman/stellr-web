import { describe, it, expect } from 'vitest'
import { estimateSchoolGrade, inferHighSchoolGrade } from './grade-logic'

// Fixed evaluation date so the "current school year" is deterministic. October is
// past the July rollover, so the fall year is 2026.
const ASOF = '2026-10-01'

describe('estimateSchoolGrade', () => {
  it('applies the core rule with the default Sep 1 cutoff', () => {
    // Born Mar 2012, before Sep 1 → K in 2017 → grade 9 in fall 2026.
    expect(estimateSchoolGrade('2012-03-01', { asOf: ASOF }).grade).toBe(9)
    expect(estimateSchoolGrade('2011-03-01', { asOf: ASOF }).grade).toBe(10)
  })

  it('a birthday after the cutoff pushes the student down a grade', () => {
    // Same birth year, either side of Sep 1.
    expect(estimateSchoolGrade('2011-08-15', { asOf: ASOF }).grade).toBe(10)
    expect(estimateSchoolGrade('2011-09-15', { asOf: ASOF }).grade).toBe(9)
  })

  it("honours a state's cutoff (New York = Dec 1)", () => {
    // Oct 15 is after the default Sep 1 (→ grade 9) but before NY's Dec 1 (→ grade 10).
    expect(estimateSchoolGrade('2011-10-15', { asOf: ASOF }).grade).toBe(9)
    expect(estimateSchoolGrade('2011-10-15', { asOf: ASOF, state: 'New York' }).grade).toBe(10)
  })

  it('throws on an unparseable date', () => {
    expect(() => estimateSchoolGrade('not-a-date', { asOf: ASOF })).toThrow()
  })
})

describe('inferHighSchoolGrade', () => {
  it('returns the estimated HS grade as a string', () => {
    expect(inferHighSchoolGrade('2012-03-01', undefined, ASOF)).toBe('9')
    expect(inferHighSchoolGrade('2009-03-01', undefined, ASOF)).toBe('12')
  })

  it('clamps out-of-band ages into 9–12', () => {
    expect(inferHighSchoolGrade('2020-01-01', undefined, ASOF)).toBe('9')  // too young → 9
    expect(inferHighSchoolGrade('1990-01-01', undefined, ASOF)).toBe('12') // too old → 12
  })

  it('applies the school State to the inference', () => {
    expect(inferHighSchoolGrade('2011-10-15', null, ASOF)).toBe('9')
    expect(inferHighSchoolGrade('2011-10-15', 'New York', ASOF)).toBe('10')
  })

  it('returns "" for missing or invalid input rather than throwing', () => {
    expect(inferHighSchoolGrade('', 'Utah', ASOF)).toBe('')
    expect(inferHighSchoolGrade('not-a-date', 'Utah', ASOF)).toBe('')
  })
})
