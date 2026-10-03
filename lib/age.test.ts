import { describe, expect, it } from 'vitest'
import { ageOfMajority, ageOn, appToday, isMinorOn, isUnder13On, isValidDob, onDate } from './age'

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

  it('uses the age of majority where the person lives (V2.3: AL/NE 19, MS 21)', () => {
    // 18 years and 364 days old.
    expect(isMinorOn('2007-10-03', on, 'AL')).toBe(true)
    expect(isMinorOn('2007-10-03', on, 'Nebraska')).toBe(true)
    expect(isMinorOn('2007-10-03', on, 'CO')).toBe(false)
    expect(isMinorOn('2007-10-02', on, 'AL')).toBe(false)
    expect(isMinorOn('2005-10-03', on, 'ms')).toBe(true)
    expect(isMinorOn('2005-10-02', on, 'MS')).toBe(false)
  })
})

describe('ageOfMajority', () => {
  it('is 18 unless the state says otherwise, or is unknown', () => {
    expect(ageOfMajority('AL')).toBe(19)
    expect(ageOfMajority(' ne ')).toBe(19)
    expect(ageOfMajority('Mississippi')).toBe(21)
    expect(ageOfMajority('CO')).toBe(18)
    expect(ageOfMajority(null)).toBe(18)
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

describe('the shared "today"', () => {
  it('is the Mountain-time calendar date, so a birthday turns over at local midnight', () => {
    // 9 pm on 1 Oct in Denver is already 2 Oct in UTC.
    const evening = new Date('2026-10-02T03:00:00Z')
    expect(appToday(evening).toISOString().slice(0, 10)).toBe('2026-10-01')
    expect(ageOn('2008-10-02', appToday(evening))).toBe(17)
    expect(ageOn('2008-10-02', appToday(new Date('2026-10-02T07:00:00Z')))).toBe(18)
  })

  it('reads an event date as that calendar day', () => {
    expect(isMinorOn('2008-10-03', onDate('2026-10-02'))).toBe(true)
    expect(isMinorOn('2008-10-03', onDate('2026-10-03T08:30:00'))).toBe(false)
  })
})

describe('isValidDob', () => {
  it('accepts a real past date and nothing else; an unreadable one is never treated as a minor', () => {
    expect(isValidDob('2012-02-29')).toBe(true)
    expect(isValidDob('2013-02-29')).toBe(false)
    expect(isValidDob('not a date')).toBe(false)
    expect(isValidDob('2999-01-01')).toBe(false)
    expect(isMinorOn('not a date', on)).toBe(false)
  })
})
