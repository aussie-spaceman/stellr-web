import { describe, expect, it } from 'vitest'
import { ageOn, isMinorOn, isUnder13On } from './age'

const on = new Date('2026-10-02T12:00:00Z')

describe('ageOn', () => {
  it('counts completed years, not calendar years', () => {
    expect(ageOn('2008-10-02', on)).toBe(18)
    expect(ageOn('2008-10-03', on)).toBe(17)
  })

  it('reads the date parts from the string, so a timestamp suffix does not shift the day', () => {
    expect(ageOn('2008-10-02T00:00:00+00:00', on)).toBe(18)
  })

  it('returns 0 for a value that is not a date', () => {
    expect(ageOn('not a date', on)).toBe(0)
  })
})

describe('isMinorOn', () => {
  it('is true until the 18th birthday', () => {
    expect(isMinorOn('2008-10-03', on)).toBe(true)
    expect(isMinorOn('2008-10-02', on)).toBe(false)
  })

  it('is false when the date of birth is unknown', () => {
    expect(isMinorOn(null, on)).toBe(false)
    expect(isMinorOn('', on)).toBe(false)
  })
})

describe('isUnder13On', () => {
  it('is true until the 13th birthday', () => {
    expect(isUnder13On('2013-10-03', on)).toBe(true)
    expect(isUnder13On('2013-10-02', on)).toBe(false)
  })

  it('is false when the date of birth is unknown', () => {
    expect(isUnder13On(undefined, on)).toBe(false)
  })
})
