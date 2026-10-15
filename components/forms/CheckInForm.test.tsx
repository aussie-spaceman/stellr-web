import { describe, expect, it } from 'vitest'
import { dobToIso, shortShirtSize } from './CheckInForm'

describe('dobToIso', () => {
  it('turns month, day and year into the ISO date the API takes', () => {
    expect(dobToIso({ month: '3', day: '7', year: '2011' })).toBe('2011-03-07')
    expect(dobToIso({ month: '12', day: '31', year: '2009' })).toBe('2009-12-31')
  })

  it('rejects dates that do not exist, short years and future dates', () => {
    expect(dobToIso({ month: '2', day: '30', year: '2011' })).toBeNull()
    expect(dobToIso({ month: '13', day: '1', year: '2011' })).toBeNull()
    expect(dobToIso({ month: '1', day: '1', year: '11' })).toBeNull()
    expect(dobToIso({ month: '', day: '1', year: '2011' })).toBeNull()
    expect(dobToIso({ month: '1', day: '1', year: String(new Date().getFullYear() + 1) })).toBeNull()
  })
})

describe('shortShirtSize', () => {
  it('shortens the open-ended largest size so it fits a phone tile', () => {
    expect(shortShirtSize('3XL (or larger)')).toBe('3XL+')
    expect(shortShirtSize('M')).toBe('M')
  })
})
