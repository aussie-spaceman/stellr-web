import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync } from 'crypto'

// A parent who enters their own address for the student gets both consent
// signatures in one inbox. Sent concurrently, they can't finish both roles
// (Robert Blake, 28 Sept 2026), so a shared inbox is sequenced: guardian first,
// student second. Pinned at the HTTP body — DocuSign accepts either shape
// without complaint, so nothing else would notice a regression.

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

interface SentCall { url: string; body: Record<string, unknown> }
interface Role { roleName: string; email: string; routingOrder: string; emailNotification: { emailBody: string } }
interface Signer { email: string; routingOrder: string }

function stubDocuSign(): SentCall[] {
  const sent: SentCall[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: string }) => {
    const u = String(url)
    if (u.includes('/oauth/token')) {
      return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }
    }
    sent.push({ url: u, body: JSON.parse(init?.body ?? '{}') })
    return { ok: true, json: async () => ({ envelopeId: 'env-consent-1' }) }
  }))
  return sent
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

const PARAMS = {
  minorFirstName: 'Ada', minorLastName: 'Lovelace',
  minorEmail:     'ada@example.org',
  guardianName:   'Anne Byron',
  guardianEmail:  'anne@example.org',
  eventTitle:     'Space Design Challenge',
}

async function templateRoles(params: typeof PARAMS): Promise<Role[]> {
  vi.stubEnv('DOCUSIGN_TEMPLATE_ID', 'tmpl-consent')
  const sent = stubDocuSign()
  const { createConsentEnvelope } = await import('./docusign')
  await createConsentEnvelope(params)
  return sent.find(c => c.url.endsWith('/envelopes'))!.body.templateRoles as Role[]
}

describe('createConsentEnvelope routing', () => {
  it('sends both signatures at once when the inboxes differ', async () => {
    const roles = await templateRoles(PARAMS)
    expect(roles.map(r => [r.roleName, r.routingOrder])).toEqual([['Guardian', '1'], ['Minor', '1']])
    expect(roles[0].emailNotification.emailBody).not.toMatch(/one after the other/)
  })

  it('sequences guardian then student when they share an inbox (case and whitespace ignored)', async () => {
    const roles = await templateRoles({ ...PARAMS, minorEmail: ' Anne@Example.org ' })
    expect(roles.map(r => [r.roleName, r.routingOrder])).toEqual([['Guardian', '1'], ['Minor', '2']])
    for (const r of roles) expect(r.emailNotification.emailBody).toMatch(/one after the other/)
  })

  it('sequences the no-template fallback the same way', async () => {
    const sent = stubDocuSign()
    const { createConsentEnvelope } = await import('./docusign')
    await createConsentEnvelope({ ...PARAMS, minorEmail: 'anne@example.org' })
    const signers = (sent.find(c => c.url.endsWith('/envelopes'))!.body.recipients as { signers: Signer[] }).signers
    expect(signers.map(s => s.routingOrder)).toEqual(['1', '2'])
  })
})
