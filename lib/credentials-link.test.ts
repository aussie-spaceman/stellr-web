import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/env', () => ({ SITE_URL: 'https://www.stellreducation.org', AUTH_APP_URL: 'https://app.stellreducation.org' }))

import {
  credentialViewToken,
  verifyCredentialViewToken,
  familyCredentialUrl,
  familyLinkConfigured,
  credentialPdfToken,
  verifyCredentialPdfToken,
  familyCertificateUrl,
} from './credentials-link'

const ID = '00000000-0000-4000-e000-000000000002'
const OTHER = '00000000-0000-4000-e000-000000000003'
const SECRET = 'a'.repeat(32)

const KEYS = ['CREDENTIAL_LINK_SECRET', 'SURVEY_TOKEN_SECRET', 'ESIGN_TOKEN_SECRET'] as const
let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
  for (const k of KEYS) delete process.env[k]
})
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('family credential link', () => {
  it('round-trips for the credential it was minted for, and no other', () => {
    process.env.CREDENTIAL_LINK_SECRET = SECRET
    const t = credentialViewToken(ID)!
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(verifyCredentialViewToken(ID, t)).toBe(true)
    expect(verifyCredentialViewToken(OTHER, t)).toBe(false)
  })

  it('refuses missing, malformed and tampered tokens', () => {
    process.env.CREDENTIAL_LINK_SECRET = SECRET
    const t = credentialViewToken(ID)!
    expect(verifyCredentialViewToken(ID, null)).toBe(false)
    expect(verifyCredentialViewToken(ID, '')).toBe(false)
    expect(verifyCredentialViewToken(ID, 'short')).toBe(false)
    expect(verifyCredentialViewToken(ID, (t[0] === 'A' ? 'B' : 'A') + t.slice(1))).toBe(false)
  })

  it('falls back to the survey secret, then the e-sign one', () => {
    process.env.ESIGN_TOKEN_SECRET = 'e'.repeat(32)
    const fromEsign = credentialViewToken(ID)
    process.env.SURVEY_TOKEN_SECRET = 's'.repeat(32)
    const fromSurvey = credentialViewToken(ID)
    expect(fromEsign).toBeTruthy()
    expect(fromSurvey).toBeTruthy()
    expect(fromSurvey).not.toBe(fromEsign)
  })

  it('a token minted under one secret fails once the secret changes', () => {
    process.env.CREDENTIAL_LINK_SECRET = SECRET
    const t = credentialViewToken(ID)!
    process.env.CREDENTIAL_LINK_SECRET = 'b'.repeat(32)
    expect(verifyCredentialViewToken(ID, t)).toBe(false)
  })

  it('with no usable secret: no token, nothing verifies, the email gets the plain page', () => {
    process.env.CREDENTIAL_LINK_SECRET = 'too-short'
    expect(familyLinkConfigured()).toBe(false)
    expect(credentialViewToken(ID)).toBeNull()
    expect(verifyCredentialViewToken(ID, 'A'.repeat(43))).toBe(false)
    expect(familyCredentialUrl({ id: ID, number: 'STL-2026-E2EADA01' })).toBe(
      'https://www.stellreducation.org/credentials/STL-2026-E2EADA01',
    )
  })

  it('builds the emailed URL with the token as ?k=', () => {
    process.env.CREDENTIAL_LINK_SECRET = SECRET
    const url = familyCredentialUrl({ id: ID, number: 'STL-2026-E2EADA01' })
    expect(url).toBe(`https://www.stellreducation.org/credentials/STL-2026-E2EADA01?k=${credentialViewToken(ID)}`)
  })
})

describe('family certificate link', () => {
  it('round-trips for its credential, and is not interchangeable with the view link', () => {
    process.env.CREDENTIAL_LINK_SECRET = SECRET
    const pdf = credentialPdfToken(ID)!
    expect(verifyCredentialPdfToken(ID, pdf)).toBe(true)
    expect(verifyCredentialPdfToken(OTHER, pdf)).toBe(false)
    // A page link never downloads the PDF, and a PDF link never opens the page.
    expect(verifyCredentialPdfToken(ID, credentialViewToken(ID))).toBe(false)
    expect(verifyCredentialViewToken(ID, pdf)).toBe(false)
    expect(verifyCredentialPdfToken(ID, null)).toBe(false)
    expect(verifyCredentialPdfToken(ID, 'short')).toBe(false)
  })

  it('builds the app-host download URL, or null with no secret', () => {
    process.env.CREDENTIAL_LINK_SECRET = SECRET
    const url = familyCertificateUrl({ id: ID, number: 'STL-2026-7K3MQ8ZD' })!
    expect(url).toBe(`https://app.stellreducation.org/api/credentials/STL-2026-7K3MQ8ZD/certificate?k=${credentialPdfToken(ID)}`)
    for (const k of KEYS) delete process.env[k]
    expect(familyCertificateUrl({ id: ID, number: 'STL-2026-7K3MQ8ZD' })).toBeNull()
  })
})
