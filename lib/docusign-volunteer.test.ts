import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync } from 'crypto'

// Volunteers sign the MENTOR agreement (Stellr, 9 Sept 2026) — there is no
// volunteer document and there never has been.
//
// This is pinned at the HTTP-body level on purpose. A wrong roleName or tab
// label does not raise an error: DocuSign accepts the envelope and the fields
// simply arrive blank on a real person's legal agreement. The only way to catch
// that is to assert on what we actually send.

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

interface SentCall { url: string; body: Record<string, unknown> }

function stubDocuSign(): SentCall[] {
  const sent: SentCall[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: string }) => {
    const u = String(url)
    if (u.includes('/oauth/token')) {
      return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) }
    }
    sent.push({ url: u, body: JSON.parse(init?.body ?? '{}') })
    return { ok: true, json: async () => ({ envelopeId: 'env-vol-1' }) }
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
  vi.stubEnv('DOCUSIGN_MENTOR_TEMPLATE_ID', 'tmpl-mentor')
  vi.stubEnv('DOCUSIGN_STELLR_REP_EMAIL', 'rep@stellreducation.org')
  vi.stubEnv('DOCUSIGN_STELLR_REP_NAME', 'Stellr Education')
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

const PARAMS = {
  firstName: 'Grace', lastName: 'Hopper',
  email: 'grace@example.org', phone: '+1 702 555 0100',
  eventTitle: 'Volunteer Program',
}

describe('createVolunteerAgreementEnvelope', () => {
  it('issues the MENTOR template, not a volunteer one', async () => {
    const sent = stubDocuSign()
    const { createVolunteerAgreementEnvelope } = await import('./docusign')
    const res = await createVolunteerAgreementEnvelope(PARAMS)

    expect(res.envelopeId).toBe('env-vol-1')
    const post = sent.find(c => c.url.endsWith('/envelopes'))!
    expect(post.body.templateId).toBe('tmpl-mentor')
  })

  it('uses the Mentor role and Mentor* tab labels so the fields actually populate', async () => {
    const sent = stubDocuSign()
    const { createVolunteerAgreementEnvelope } = await import('./docusign')
    await createVolunteerAgreementEnvelope(PARAMS)

    const roles = (sent.find(c => c.url.endsWith('/envelopes'))!.body.templateRoles ?? []) as {
      roleName: string; email: string; tabs?: { textTabs?: { tabLabel: string; value: string }[] }
    }[]
    const signer = roles.find(r => r.email === PARAMS.email)!

    // The template defines 'Mentor' — a 'Volunteer' role would match nothing.
    expect(signer.roleName).toBe('Mentor')
    const labels = (signer.tabs?.textTabs ?? []).map(t => t.tabLabel).sort()
    expect(labels).toEqual(['EventTitle', 'MentorEmail', 'MentorName', 'MentorPhone'])
    expect(signer.tabs?.textTabs?.find(t => t.tabLabel === 'MentorPhone')?.value).toBe(PARAMS.phone)
    expect(signer.tabs?.textTabs?.find(t => t.tabLabel === 'MentorName')?.value).toBe('Grace Hopper')
  })

  it('adds the Stellr counter-signer when one is configured', async () => {
    const sent = stubDocuSign()
    const { createVolunteerAgreementEnvelope } = await import('./docusign')
    const res = await createVolunteerAgreementEnvelope(PARAMS)

    const roles = (sent.find(c => c.url.endsWith('/envelopes'))!.body.templateRoles ?? []) as { roleName: string }[]
    expect(roles.map(r => r.roleName).sort()).toEqual(['Mentor', 'StellrRepresentative'])
    expect(res.signerCount).toBe(2)
  })

  it('fails on the MENTOR template id, not a volunteer one', async () => {
    // Regression: this used to require DOCUSIGN_VOLUNTEER_TEMPLATE_ID, which was
    // never set in any environment — so every volunteer agreement threw.
    vi.stubEnv('DOCUSIGN_MENTOR_TEMPLATE_ID', '')
    stubDocuSign()
    const { createVolunteerAgreementEnvelope } = await import('./docusign')
    await expect(createVolunteerAgreementEnvelope(PARAMS)).rejects.toThrow(/DOCUSIGN_MENTOR_TEMPLATE_ID/)
  })
})
