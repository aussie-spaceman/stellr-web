import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { vi } from 'vitest'

vi.mock('@/lib/env', () => ({ SITE_URL: 'https://www.stellreducation.org' }))

import { linkedInAddToProfileUrl, linkedInShareUrl, linkedInManualDetails } from './linkedin'

const cred = {
  number: 'STL-2026-7K3MQ8ZD',
  title: 'Orbital Mechanics 101',
  issuer: 'Stellr Academy',
  issued_at: '2026-09-01T15:00:00Z',
  expires_at: null as string | null,
}

describe('linkedInAddToProfileUrl', () => {
  const original = process.env.LINKEDIN_ORGANIZATION_ID
  beforeEach(() => { delete process.env.LINKEDIN_ORGANIZATION_ID })
  afterEach(() => { if (original !== undefined) process.env.LINKEDIN_ORGANIZATION_ID = original })

  it('prefills name, date, ID and the credential URL', () => {
    const u = new URL(linkedInAddToProfileUrl(cred))
    expect(u.origin + u.pathname).toBe('https://www.linkedin.com/profile/add')
    expect(u.searchParams.get('startTask')).toBe('CERTIFICATION_NAME')
    expect(u.searchParams.get('name')).toBe('Orbital Mechanics 101')
    expect(u.searchParams.get('issueYear')).toBe('2026')
    expect(u.searchParams.get('issueMonth')).toBe('9')
    expect(u.searchParams.get('certId')).toBe('STL-2026-7K3MQ8ZD')
    expect(u.searchParams.get('certUrl')).toBe('https://www.stellreducation.org/credentials/STL-2026-7K3MQ8ZD')
    expect(u.searchParams.get('expirationYear')).toBeNull()
  })

  it('falls back to organizationName when the Page ID is unset', () => {
    const u = new URL(linkedInAddToProfileUrl(cred))
    expect(u.searchParams.get('organizationId')).toBeNull()
    expect(u.searchParams.get('organizationName')).toBe('Stellr Education')
  })

  it('uses organizationId when set, and only when numeric', () => {
    process.env.LINKEDIN_ORGANIZATION_ID = '12345678'
    let u = new URL(linkedInAddToProfileUrl(cred))
    expect(u.searchParams.get('organizationId')).toBe('12345678')
    expect(u.searchParams.get('organizationName')).toBeNull()

    process.env.LINKEDIN_ORGANIZATION_ID = 'stellr-education'
    u = new URL(linkedInAddToProfileUrl(cred))
    expect(u.searchParams.get('organizationId')).toBeNull()
    expect(u.searchParams.get('organizationName')).toBe('Stellr Education')
  })

  it('adds expiry when present', () => {
    const u = new URL(linkedInAddToProfileUrl({ ...cred, expires_at: '2029-09-01T00:00:00Z' }))
    expect(u.searchParams.get('expirationYear')).toBe('2029')
    expect(u.searchParams.get('expirationMonth')).toBe('9')
  })
})

describe('linkedInShareUrl', () => {
  it('wraps the credential URL for the feed composer', () => {
    expect(linkedInShareUrl('https://www.stellreducation.org/credentials/STL-2026-7K3MQ8ZD'))
      .toBe('https://www.linkedin.com/sharing/share-offsite/?url=https%3A%2F%2Fwww.stellreducation.org%2Fcredentials%2FSTL-2026-7K3MQ8ZD')
  })
})

describe('linkedInManualDetails', () => {
  it('gives the five fields a member types by hand', () => {
    expect(linkedInManualDetails(cred)).toEqual({
      name: 'Orbital Mechanics 101',
      organization: 'Stellr Education',
      issueDate: 'September 2026',
      credentialId: 'STL-2026-7K3MQ8ZD',
      credentialUrl: 'https://www.stellreducation.org/credentials/STL-2026-7K3MQ8ZD',
    })
  })
})
