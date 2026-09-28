import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync } from 'crypto'

// resendEnvelope must PUT only the signers who still have to act. It used to
// echo the whole GET /recipients payload back, already-signed signers included,
// and most unsigned production envelopes are part-signed (28 Sept 2026).

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

interface Call { url: string; method: string; body: unknown }

function stubDocuSign(signers: { recipientId: string; status: string }[]): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
    const u = String(url)
    if (u.includes('/oauth/token')) {
      return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }
    }
    calls.push({ url: u, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : null })
    return { ok: true, json: async () => ({ signers, carbonCopies: [{ recipientId: '9' }] }), text: async () => '' }
  }))
  return calls
}

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('DOCUSIGN_OAUTH_URL', 'https://account-d.docusign.com')
  vi.stubEnv('DOCUSIGN_BASE_PATH', 'https://demo.docusign.net/restapi')
  vi.stubEnv('DOCUSIGN_ACCOUNT_ID', 'acct-1')
  vi.stubEnv('DOCUSIGN_INTEGRATION_KEY', 'ikey-1')
  vi.stubEnv('DOCUSIGN_USER_ID', 'user-1')
  vi.stubEnv('DOCUSIGN_PRIVATE_KEY', privateKey as string)
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('resendEnvelope', () => {
  it('re-notifies only the signers who have not signed', async () => {
    const calls = stubDocuSign([
      { recipientId: '1', status: 'completed' },
      { recipientId: '2', status: 'sent' },
    ])
    const { resendEnvelope } = await import('./docusign')
    expect(await resendEnvelope('env-1')).toBe(1)

    const put = calls.find((c) => c.method === 'PUT')!
    expect(put.url).toContain('/envelopes/env-1/recipients?resend_envelope=true')
    expect(put.body).toEqual({ signers: [{ recipientId: '2', status: 'sent' }] })
  })

  it('sends nothing when every signer has finished', async () => {
    const calls = stubDocuSign([{ recipientId: '1', status: 'completed' }])
    const { resendEnvelope } = await import('./docusign')
    expect(await resendEnvelope('env-1')).toBe(0)
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
  })
})
