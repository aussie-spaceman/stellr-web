import { describe, it, expect } from 'vitest'
import { readCredentialOptOut, formatFormDate, CREDENTIAL_OPT_OUT_TAB } from './docusign-form-data'

describe('formatFormDate', () => {
  it('writes an ISO date the way the form prints it (DD-MMM-YYYY)', () => {
    expect(formatFormDate('2012-04-10')).toBe('10-Apr-2012')
    expect(formatFormDate('2009-12-01T00:00:00Z')).toBe('01-Dec-2009')
  })
  it('leaves blanks blank and passes anything else through', () => {
    expect(formatFormDate(null)).toBe('')
    expect(formatFormDate(undefined)).toBe('')
    expect(formatFormDate('10/04/2012')).toBe('10/04/2012')
    expect(formatFormDate('2012-13-01')).toBe('2012-13-01')
  })
})

describe('readCredentialOptOut', () => {
  it('returns null when the tab is absent (pre-change template)', () => {
    expect(readCredentialOptOut([{ name: 'MinorName', value: 'Ada' }])).toBeNull()
  })
  it('reads a ticked box as an opt-out', () => {
    expect(readCredentialOptOut([{ name: CREDENTIAL_OPT_OUT_TAB, value: 'X' }])).toBe(true)
    expect(readCredentialOptOut([{ name: CREDENTIAL_OPT_OUT_TAB, value: 'true' }])).toBe(true)
    expect(readCredentialOptOut([{ name: 'credentialsharingoptout', value: 'on' }])).toBe(true)
  })
  it('reads an unticked box as no opt-out', () => {
    expect(readCredentialOptOut([{ name: CREDENTIAL_OPT_OUT_TAB, value: '' }])).toBe(false)
    expect(readCredentialOptOut([{ name: CREDENTIAL_OPT_OUT_TAB, value: 'false' }])).toBe(false)
  })
  it('treats any ticked copy as an opt-out when the tab appears on both roles', () => {
    expect(readCredentialOptOut([
      { name: CREDENTIAL_OPT_OUT_TAB, value: '' },
      { name: CREDENTIAL_OPT_OUT_TAB, value: 'X' },
    ])).toBe(true)
  })
})
