import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkInCodeLink, signCheckInCode, verifyCheckInCode } from './check-in-codes'

const ID = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  vi.stubEnv('CREDENTIAL_LINK_SECRET', '')
  vi.stubEnv('SURVEY_TOKEN_SECRET', 'x'.repeat(40))
  vi.stubEnv('ESIGN_TOKEN_SECRET', '')
})
afterEach(() => vi.unstubAllEnvs())

describe('check-in codes', () => {
  it('signs and verifies a participant and a group code for one event', () => {
    const p = signCheckInCode('nevada', 'p', ID) as string
    const g = signCheckInCode('nevada', 'g', ID) as string
    expect(p).toMatch(/^p\.11111111-1111-4111-8111-111111111111\.[A-Za-z0-9_-]{22}$/)
    expect(verifyCheckInCode('nevada', p)).toEqual({ kind: 'p', id: ID })
    expect(verifyCheckInCode('nevada', g)).toEqual({ kind: 'g', id: ID })
  })

  it('refuses a code from another event, a changed kind or id, or a forged signature', () => {
    const p = signCheckInCode('nevada', 'p', ID) as string
    expect(verifyCheckInCode('colorado', p)).toBeNull()
    expect(verifyCheckInCode('nevada', `g${p.slice(1)}`)).toBeNull()
    expect(verifyCheckInCode('nevada', p.replace('1111-4111', '1111-4112'))).toBeNull()
    expect(verifyCheckInCode('nevada', `${p.slice(0, -1)}${p.endsWith('A') ? 'B' : 'A'}`)).toBeNull()
    expect(verifyCheckInCode('nevada', null)).toBeNull()
  })

  it('makes no codes, and trusts none, without a long enough secret', () => {
    const p = signCheckInCode('nevada', 'p', ID) as string
    vi.stubEnv('SURVEY_TOKEN_SECRET', 'short')
    expect(signCheckInCode('nevada', 'p', ID)).toBeNull()
    expect(checkInCodeLink('nevada', 'p', ID)).toBeNull()
    expect(verifyCheckInCode('nevada', p)).toBeNull()
  })

  it('links to the code page on the site', () => {
    expect(checkInCodeLink('nevada', 'g', ID)).toMatch(/\/check-in\/nevada\/code\?c=g\.11111111-1111-4111-8111-111111111111\./)
  })
})
