import { describe, it, expect } from 'vitest'
import { PD_STANDARDS, describeStandard, formatPdHours, parsePdHours, pdCredentialTitle, pdStandardCodes } from './pd-standards'

describe('pdCredentialTitle', () => {
  // The title is what LinkedIn shows as the certification name, so the hours
  // must be in it (decision Q7: one LinkedIn entry per event).
  it('names the event and the hours', () => {
    expect(pdCredentialTitle('Colorado Space Design Competition', 8)).toBe('Professional Development — Colorado Space Design Competition (8 hours)')
  })
  it('keeps half hours and uses the singular for one', () => {
    expect(pdCredentialTitle(' Workshop ', 7.5)).toBe('Professional Development — Workshop (7.5 hours)')
    expect(pdCredentialTitle('Workshop', 1)).toBe('Professional Development — Workshop (1 hour)')
  })
})

describe('parsePdHours', () => {
  it('accepts numbers and numeric strings, rounded to one decimal', () => {
    expect(parsePdHours(8)).toBe(8)
    expect(parsePdHours('7.5')).toBe(7.5)
    expect(parsePdHours('2.25')).toBe(2.3)
  })
  it('refuses what the column would refuse', () => {
    for (const bad of [0, -1, 40.1, 'eight', '', null, undefined, Number.NaN]) expect(parsePdHours(bad)).toBeNull()
    expect(parsePdHours(40)).toBe(40)
  })
})

describe('standards', () => {
  it('covers both frameworks the certificate names', () => {
    const frameworks = new Set(PD_STANDARDS.map((s) => s.framework))
    expect(frameworks).toEqual(new Set(['NGSS', 'CCSS']))
    expect(pdStandardCodes()).toHaveLength(PD_STANDARDS.length)
  })
  it('still describes a code retired from the set', () => {
    expect(describeStandard('CCSS.MATH.PRACTICE.MP7')).toEqual({ code: 'CCSS.MATH.PRACTICE.MP7', framework: 'CCSS', label: '' })
  })
  it('formats hours without a trailing .0', () => {
    expect(formatPdHours(8)).toBe('8')
    expect(formatPdHours(7.5)).toBe('7.5')
  })
})
