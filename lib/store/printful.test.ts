// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifyPrintfulWebhook } from './printful'

// deep review TEST-1: the Printful fulfilment webhook authenticates by a shared
// secret carried in the `x-printful-secret` header or a `?secret=` query param,
// compared in constant time. It must fail CLOSED when PRINTFUL_WEBHOOK_SECRET is
// unset, and reject a wrong/absent secret. verifyPrintfulWebhook reads the env
// per call, so no module reset is needed. Tested directly: the verifier is the
// whole gate and the route is a thin wrapper over it.

const SECRET = 'pf-secret-123'
const req = (opts: { header?: string; query?: string } = {}) => {
  const url = opts.query !== undefined
    ? `https://app.test/api/printful/webhook?secret=${encodeURIComponent(opts.query)}`
    : 'https://app.test/api/printful/webhook'
  const headers: Record<string, string> = {}
  if (opts.header !== undefined) headers['x-printful-secret'] = opts.header
  return new Request(url, { method: 'POST', headers })
}

afterEach(() => vi.unstubAllEnvs())

describe('verifyPrintfulWebhook', () => {
  it('fails closed when PRINTFUL_WEBHOOK_SECRET is unset, even if a secret is supplied', () => {
    vi.stubEnv('PRINTFUL_WEBHOOK_SECRET', '')
    expect(verifyPrintfulWebhook(req({ header: 'anything' }))).toBe(false)
    expect(verifyPrintfulWebhook(req({ query: 'anything' }))).toBe(false)
  })

  it('rejects a request carrying no secret at all', () => {
    vi.stubEnv('PRINTFUL_WEBHOOK_SECRET', SECRET)
    expect(verifyPrintfulWebhook(req())).toBe(false)
  })

  it('rejects a wrong secret in either the header or the query', () => {
    vi.stubEnv('PRINTFUL_WEBHOOK_SECRET', SECRET)
    expect(verifyPrintfulWebhook(req({ header: 'wrong' }))).toBe(false)
    expect(verifyPrintfulWebhook(req({ query: 'wrong' }))).toBe(false)
  })

  it('accepts the correct secret in the header', () => {
    vi.stubEnv('PRINTFUL_WEBHOOK_SECRET', SECRET)
    expect(verifyPrintfulWebhook(req({ header: SECRET }))).toBe(true)
  })

  it('accepts the correct secret in the query param', () => {
    vi.stubEnv('PRINTFUL_WEBHOOK_SECRET', SECRET)
    expect(verifyPrintfulWebhook(req({ query: SECRET }))).toBe(true)
  })
})
