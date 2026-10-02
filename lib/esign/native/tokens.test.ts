// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mintToken, signingConfigured, signingUrl, verifyToken } from './tokens'

const id = '3f2b8c1e-9d4a-4b7e-8c21-5a6f0e9d1b23'
const now = Date.UTC(2026, 9, 2, 12)

beforeEach(() => vi.stubEnv('ESIGN_TOKEN_SECRET', 'x'.repeat(48)))
afterEach(() => vi.unstubAllEnvs())

describe('signing tokens', () => {
  it('round-trips and carries the signer, purpose and version', () => {
    const { token, expiresAt } = mintToken(id, 'sign', 3, 3600, now)
    expect(verifyToken(token, 'sign', now)).toEqual({ recipientId: id, purpose: 'sign', version: 3, expiresAt })
  })

  it('refuses a token minted for another purpose', () => {
    const { token } = mintToken(id, 'download', 1, 3600, now)
    expect(verifyToken(token, 'sign', now)).toBeNull()
  })

  it('refuses an expired token', () => {
    const { token } = mintToken(id, 'sign', 1, 60, now)
    expect(verifyToken(token, 'sign', now + 61_000)).toBeNull()
  })

  it('refuses any edit: version, expiry, signer or signature', () => {
    const { token } = mintToken(id, 'sign', 1, 3600, now)
    const [r, pv, exp, sig] = token.split('.')
    expect(verifyToken([r, 's2', exp, sig].join('.'), 'sign', now)).toBeNull()
    expect(verifyToken([r, pv, String(Number(exp) + 999), sig].join('.'), 'sign', now)).toBeNull()
    expect(verifyToken(['3f2b8c1e-9d4a-4b7e-8c21-5a6f0e9d1b24', pv, exp, sig].join('.'), 'sign', now)).toBeNull()
    expect(verifyToken([r, pv, exp, sig.slice(0, -2) + 'AA'].join('.'), 'sign', now)).toBeNull()
  })

  it('refuses tokens made with a different secret', () => {
    const { token } = mintToken(id, 'sign', 1, 3600, now)
    vi.stubEnv('ESIGN_TOKEN_SECRET', 'y'.repeat(48))
    expect(verifyToken(token, 'sign', now)).toBeNull()
  })

  it('rejects junk without throwing', () => {
    for (const junk of ['', 'a.b.c', `${id}.s1.notanumber.x`, 'x'.repeat(500)]) {
      expect(verifyToken(junk, 'sign', now)).toBeNull()
    }
  })

  it('will not mint without a dedicated secret of real length', () => {
    vi.stubEnv('ESIGN_TOKEN_SECRET', 'short')
    expect(signingConfigured()).toBe(false)
    expect(() => mintToken(id, 'sign', 1, 60, now)).toThrow(/ESIGN_TOKEN_SECRET/)
  })

  it('puts the token in the fragment, which browsers never send to the server', () => {
    expect(signingUrl('https://www.stellreducation.org', 'tok')).toBe('https://www.stellreducation.org/sign#tok')
  })
})
