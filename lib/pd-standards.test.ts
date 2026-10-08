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
  // 8 Oct: the certificate back is the source of truth — Common Core only, 17
  // codes, in the order printed. A change to the back must change this list.
  it('matches the certificate back, code for code', () => {
    expect(pdStandardCodes()).toEqual([
      'MP1', 'MP2', 'MP3', 'MP4', 'MP6',
      'HSN-Q.A.1', 'HSN-Q.A.2', 'HSN-Q.A.3', 'HSN-CED.A.3', 'HSN-MG.A.3',
      'RST.11-12.7', 'RST.11-12.9', 'WHST.11-12.2', 'WHST.11-12.6', 'SL.11-12.1', 'SL.11-12.4', 'SL.11-12.5',
    ])
    expect(new Set(PD_STANDARDS.map((s) => s.framework))).toEqual(new Set(['CCSS']))
    expect(new Set(PD_STANDARDS.map((s) => s.group)).size).toBe(3)
  })
  it('still describes a code retired from the set', () => {
    // The 7 Oct set lives on in dev snapshots; it still renders, ungrouped.
    expect(describeStandard('NGSS SEP 1')).toEqual({ code: 'NGSS SEP 1', framework: 'NGSS', group: 'NGSS', label: '' })
    expect(describeStandard('MP7')).toEqual({ code: 'MP7', framework: 'CCSS', group: 'Common Core', label: '' })
  })
  it('formats hours without a trailing .0', () => {
    expect(formatPdHours(8)).toBe('8')
    expect(formatPdHours(7.5)).toBe('7.5')
  })
})
