import { describe, it, expect } from 'vitest'
import { readCredentialOptOut, CREDENTIAL_OPT_OUT_TAB } from './docusign-form-data'

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
