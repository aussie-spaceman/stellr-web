import { describe, it, expect } from 'vitest'
import { gradeBand, gradeOptions, matchesGradeFilter } from './grade-band'

describe('gradeBand', () => {
  // The whole point of the default path: every event that predates the override
  // must produce exactly the copy it produced before this module existed.
  it('derives the historic band from the bracket', () => {
    expect(gradeBand({ gradeLevel: 'High School' })).toMatchObject({ min: 9, max: 12 })
    expect(gradeBand({ gradeLevel: 'Middle School' })).toMatchObject({ min: 6, max: 8 })
    expect(gradeBand({ gradeLevel: 'Both' })).toMatchObject({ min: 6, max: 12 })
  })

  it('falls back to 9–12 when the bracket is missing or unrecognised', () => {
    expect(gradeBand({})).toMatchObject({ min: 9, max: 12 })
    expect(gradeBand({ gradeLevel: 'Kindergarten' })).toMatchObject({ min: 9, max: 12 })
  })

  it('uses an explicit band over the bracket', () => {
    const band = gradeBand({ gradeLevel: 'Both', gradeMin: 7, gradeMax: 12 })
    expect(band).toMatchObject({ min: 7, max: 12, isOverride: true })
    expect(band.audience).toBe('middle and high school students (grades 7–12)')
  })

  // A half-filled override in the Studio is an authoring mistake in progress —
  // inventing a range from one number would put a wrong grade on a live page.
  it('ignores a half-filled override', () => {
    expect(gradeBand({ gradeLevel: 'High School', gradeMin: 7 })).toMatchObject({
      min: 9,
      max: 12,
      isOverride: false,
    })
    expect(gradeBand({ gradeLevel: 'High School', gradeMax: 12 })).toMatchObject({ min: 9, max: 12 })
  })

  it('ignores an inverted override', () => {
    expect(gradeBand({ gradeLevel: 'Both', gradeMin: 12, gradeMax: 7 })).toMatchObject({
      min: 6,
      max: 12,
      isOverride: false,
    })
  })

  it('clamps an out-of-range override into K-12', () => {
    expect(gradeBand({ gradeMin: 0, gradeMax: 20 })).toMatchObject({ min: 1, max: 12 })
  })

  describe('audience wording', () => {
    it('names the school level the band actually covers', () => {
      expect(gradeBand({ gradeLevel: 'High School' }).audience).toBe(
        'high school students (grades 9–12)',
      )
      expect(gradeBand({ gradeLevel: 'Middle School' }).audience).toBe(
        'middle school students (grades 6–8)',
      )
      expect(gradeBand({ gradeMin: 7, gradeMax: 8 }).audienceShort).toBe('middle school')
      expect(gradeBand({ gradeMin: 7, gradeMax: 12 }).audienceShort).toBe('middle and high school')
    })
  })

  describe('pill label', () => {
    it('keeps the bracket when there is no override', () => {
      expect(gradeBand({ gradeLevel: 'High School' }).label).toBe('High School')
      expect(gradeBand({ gradeLevel: 'Both' }).label).toBe('Both')
    })

    // "High School" on a 7–12 event tells an eligible seventh-grader they don't
    // qualify; "Both" tells a teacher nothing about where it starts.
    it('names the grades outright when there is one', () => {
      expect(gradeBand({ gradeLevel: 'Both', gradeMin: 7, gradeMax: 12 }).label).toBe('Grades 7–12')
    })
  })
})

describe('gradeOptions', () => {
  it('lists every grade in the band, lowest first', () => {
    expect(gradeOptions({ min: 7, max: 12 })).toEqual(['7', '8', '9', '10', '11', '12'])
    expect(gradeOptions({ min: 9, max: 12 })).toEqual(['9', '10', '11', '12'])
  })
})

describe('matchesGradeFilter', () => {
  it('matches a band against the chip it overlaps', () => {
    expect(matchesGradeFilter({ gradeLevel: 'High School' }, 'High School')).toBe(true)
    expect(matchesGradeFilter({ gradeLevel: 'High School' }, 'Middle School')).toBe(false)
    expect(matchesGradeFilter({ gradeLevel: 'Middle School' }, 'Middle School')).toBe(true)
    expect(matchesGradeFilter({ gradeLevel: 'Middle School' }, 'High School')).toBe(false)
  })

  // The bug this replaced: exact string equality hid every "Both" document from
  // BOTH chips — the one case where a teacher most wants to find it.
  it('shows a straddling band under both chips', () => {
    expect(matchesGradeFilter({ gradeLevel: 'Both' }, 'Middle School')).toBe(true)
    expect(matchesGradeFilter({ gradeLevel: 'Both' }, 'High School')).toBe(true)
    const co = { gradeLevel: 'Both', gradeMin: 7, gradeMax: 12 }
    expect(matchesGradeFilter(co, 'Middle School')).toBe(true)
    expect(matchesGradeFilter(co, 'High School')).toBe(true)
  })

  it('filters nothing out with no chip selected', () => {
    expect(matchesGradeFilter({ gradeLevel: 'Middle School' }, '')).toBe(true)
  })
})
