import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync } from 'crypto'

// correctRecipient changes one signer's address on the same envelope. It must
// send only that signer, refuse finished envelopes and signers, and not trust
// DocuSign's 200: a rejected recipient comes back inside the body.

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

interface Call { url: string; method: string; body: unknown }
interface Signer { recipientId: string; status: string; email: string; name?: string }

function stubDocuSign(opts: {
  envelopeStatus?: string
  signers: Signer[]
  putResult?: unknown
  putStatus?: number
  /** Whether the PUT actually changes the stored address (false = DocuSign ignored it). */
  applies?: boolean
  tabs?: Record<string, { tabId: string; value: string }[]>
}): Call[] {
  const calls: Call[] = []
  let signers = opts.signers.map((s) => ({ ...s }))
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { method?: string; body?: string }) => {
    const u = String(url)
    if (u.includes('/oauth/token')) {
      return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }
    }
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(init.body) : null
    calls.push({ url: u, method, body })
    const reply = (status: number, json: unknown) => ({
      ok: status < 400, status, json: async () => json, text: async () => JSON.stringify(json),
    })
    if (u.includes('/tabs')) return reply(200, method === 'GET' ? (opts.tabs ?? {}) : {})
    if (u.includes('/recipients') && method === 'PUT') {
      if (opts.putStatus && opts.putStatus >= 400) return reply(opts.putStatus, opts.putResult)
      if (opts.applies !== false) {
        for (const s of (body as { signers: Signer[] }).signers) {
          signers = signers.map((x) => (x.recipientId === s.recipientId ? { ...x, email: s.email, status: 'sent' } : x))
        }
      }
      return reply(200, opts.putResult ?? { recipientUpdateResults: [{ recipientId: '2', errorDetails: { errorCode: 'SUCCESS' } }] })
    }
    if (u.includes('/recipients')) return reply(200, { signers })
    return reply(200, { status: opts.envelopeStatus ?? 'sent' })
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

const GUARDIAN = { recipientId: '1', status: 'sent', email: 'parent@example.com', name: 'Pat Parent' }
const BOUNCED = { recipientId: '2', status: 'autoresponded', email: 'typo@exmaple.com', name: 'Sam Student' }

describe('correctRecipient', () => {
  it('PUTs only the corrected signer, with resend, and returns it as read back', async () => {
    const calls = stubDocuSign({ signers: [GUARDIAN, BOUNCED] })
    const { correctRecipient } = await import('./docusign')
    const r = await correctRecipient('env-1', { recipientId: '2', email: 'sam@example.com' })

    expect(r).toMatchObject({ recipientId: '2', email: 'sam@example.com', status: 'sent' })
    const put = calls.find((c) => c.method === 'PUT' && c.url.includes('/recipients?'))!
    expect(put.url).toContain('/envelopes/env-1/recipients?resend_envelope=true')
    expect(put.body).toEqual({ signers: [{ recipientId: '2', email: 'sam@example.com', name: 'Sam Student' }] })
  })

  it('rewrites the signer’s prefilled email fields while nobody has signed', async () => {
    const calls = stubDocuSign({
      signers: [GUARDIAN, BOUNCED],
      tabs: { emailAddressTabs: [{ tabId: 't1', value: 'typo@exmaple.com' }], textTabs: [{ tabId: 't2', value: 'Sam' }] },
    })
    const { correctRecipient } = await import('./docusign')
    await correctRecipient('env-1', { recipientId: '2', email: 'sam@example.com' })
    const tabPut = calls.find((c) => c.method === 'PUT' && c.url.includes('/recipients/2/tabs'))!
    expect(tabPut.body).toEqual({ emailAddressTabs: [{ tabId: 't1', value: 'sam@example.com' }] })
  })

  it('leaves the document text alone once someone has signed', async () => {
    const calls = stubDocuSign({
      signers: [{ ...GUARDIAN, status: 'completed' }, BOUNCED],
      tabs: { emailAddressTabs: [{ tabId: 't1', value: 'typo@exmaple.com' }] },
    })
    const { correctRecipient } = await import('./docusign')
    await correctRecipient('env-1', { recipientId: '2', email: 'sam@example.com' })
    expect(calls.some((c) => c.url.includes('/tabs'))).toBe(false)
  })

  it.each(['completed', 'voided', 'declined'])('refuses a %s envelope without writing', async (status) => {
    const calls = stubDocuSign({ envelopeStatus: status, signers: [GUARDIAN, BOUNCED] })
    const { correctRecipient } = await import('./docusign')
    await expect(correctRecipient('env-1', { recipientId: '2', email: 'sam@example.com' }))
      .rejects.toMatchObject({ status: 409, errorCode: 'ENVELOPE_NOT_CORRECTABLE' })
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
  })

  it('refuses a signer who has already signed', async () => {
    const calls = stubDocuSign({ signers: [{ ...GUARDIAN, status: 'completed' }, BOUNCED] })
    const { correctRecipient } = await import('./docusign')
    await expect(correctRecipient('env-1', { recipientId: '1', email: 'new@example.com' }))
      .rejects.toMatchObject({ status: 409, errorCode: 'RECIPIENT_FINISHED' })
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
  })

  it('treats a recipient error inside a 200 as a refusal', async () => {
    stubDocuSign({
      signers: [GUARDIAN, BOUNCED],
      applies: false,
      putResult: { recipientUpdateResults: [{ recipientId: '2', errorDetails: { errorCode: 'INVALID_EMAIL_ADDRESS_FOR_RECIPIENT', message: 'bad address' } }] },
    })
    const { correctRecipient } = await import('./docusign')
    await expect(correctRecipient('env-1', { recipientId: '2', email: 'sam@example.com' }))
      .rejects.toMatchObject({ status: 409, errorCode: 'INVALID_EMAIL_ADDRESS_FOR_RECIPIENT' })
  })

  it('maps a locked envelope to a readable refusal', async () => {
    stubDocuSign({ signers: [GUARDIAN, BOUNCED], putStatus: 400, putResult: { errorCode: 'ENVELOPE_LOCKED', message: 'locked' } })
    const { correctRecipient } = await import('./docusign')
    await expect(correctRecipient('env-1', { recipientId: '2', email: 'sam@example.com' }))
      .rejects.toMatchObject({ status: 409, errorCode: 'ENVELOPE_LOCKED' })
  })

  it('fails loudly when DocuSign says yes but the address did not change', async () => {
    stubDocuSign({ signers: [GUARDIAN, BOUNCED], applies: false })
    const { correctRecipient } = await import('./docusign')
    await expect(correctRecipient('env-1', { recipientId: '2', email: 'sam@example.com' }))
      .rejects.toThrow(/still reads typo@exmaple.com/)
  })
})
