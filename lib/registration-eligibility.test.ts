import { describe, expect, it } from 'vitest'
import { checkRegistrationAge, isRegistrationMinor, registrationAgeDate } from './registration-eligibility'

// S0 (2 Nov 2026): the date-of-birth check every participant-writing route
// shares. An unknown or unreadable date never reads as an adult.

const today = new Date('2026-11-02T12:00:00Z')

describe('checkRegistrationAge', () => {
  it('refuses a missing date of birth, naming whose it is', () => {
    for (const v of [undefined, null, '', '   ', 42, {}]) {
      expect(checkRegistrationAge(v, { today })).toEqual({ ok: false, error: 'Please add your date of birth.' })
    }
    expect(checkRegistrationAge('', { today, name: 'Sam Lee' })).toEqual({ ok: false, error: 'Please add a date of birth for Sam Lee.' })
  })

  it('refuses an unreadable, impossible, future or implausibly old date', () => {
    for (const v of ['abc', '12/01/2013', '2013-02-29', '2013-13-01', '2026-11-03', '2999-01-01', '1890-01-01', '0211-05-04']) {
      const r = checkRegistrationAge(v, { today })
      expect(r.ok, v).toBe(false)
      if (!r.ok) expect(r.error).toMatch(/doesn't look right/)
    }
  })

  it('works out the age on the event date, and today', () => {
    const r = checkRegistrationAge('2008-12-01', { today, eventDate: '2027-01-15' })
    expect(r).toEqual({ ok: true, dateOfBirth: '2008-12-01', ageAtEvent: 18, ageToday: 17, isMinor: true })
  })

  it('counts a minor on either date as a minor, so nobody registering as a minor is stored as an adult', () => {
    // 17 today, 18 by the event.
    expect(checkRegistrationAge('2008-12-01', { today, eventDate: '2027-01-15' })).toMatchObject({ isMinor: true })
    // 18 today and at the event.
    expect(checkRegistrationAge('2008-11-02', { today, eventDate: '2027-01-15' })).toMatchObject({ isMinor: false })
  })

  it('uses today when the event has no usable date (a campaign)', () => {
    expect(checkRegistrationAge('2013-11-02', { today })).toMatchObject({ ok: true, ageAtEvent: 13, ageToday: 13 })
    expect(checkRegistrationAge('2013-11-02', { today, eventDate: 'TBC' })).toMatchObject({ ageAtEvent: 13 })
    expect(registrationAgeDate(null, today)).toBe(today)
    expect(registrationAgeDate('2027-03-04T09:00:00Z', today).toISOString().slice(0, 10)).toBe('2027-03-04')
  })

  it.each([
    ['12', '2013-11-03', 12], // 13 tomorrow
    ['13', '2013-11-02', 13],
    ['14', '2012-11-02', 14],
  ])('accepts a %s-year-old for a Stellr event (no floor) as a minor', (_l, dob, age) => {
    expect(checkRegistrationAge(dob, { today })).toEqual({ ok: true, dateOfBirth: dob, ageAtEvent: age, ageToday: age, isMinor: true })
  })

  it('applies a floor on the event date when one is given (the tenant 14+ rule)', () => {
    expect(checkRegistrationAge('2013-01-01', { today, eventDate: '2026-12-01', minAge: 14 })).toEqual({
      ok: false, error: 'You must be 14 or older on the day of the event to take part.',
    })
    // 13 today, 14 by the event: allowed.
    expect(checkRegistrationAge('2012-11-20', { today, eventDate: '2026-12-01', minAge: 14 })).toMatchObject({ ok: true, ageAtEvent: 14 })
    expect(checkRegistrationAge('2013-01-01', { today, minAge: 14, name: 'Sam' })).toMatchObject({ error: 'Sam must be 14 or older on the day of the event to take part.' })
  })

  it('returns the date as YYYY-MM-DD, trimmed', () => {
    expect(checkRegistrationAge(' 1990-05-06T00:00:00Z ', { today })).toMatchObject({ ok: true, dateOfBirth: '1990-05-06', isMinor: false })
  })
})

describe('isRegistrationMinor', () => {
  it('fails closed: anything that does not pass the check is a minor', () => {
    expect(isRegistrationMinor('')).toBe(true)
    expect(isRegistrationMinor('nonsense')).toBe(true)
    expect(isRegistrationMinor(null)).toBe(true)
    expect(isRegistrationMinor('1990-05-06')).toBe(false)
  })
})
