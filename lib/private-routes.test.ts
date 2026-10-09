import { describe, it, expect } from 'vitest'
import { isPrivatePath } from '@/lib/private-routes'

describe('isPrivatePath', () => {
  it('treats credential pages as private so no tracking loads (MP-1)', () => {
    // The guardian "view credential" email carries a ?k= bearer token for a
    // private minor credential; these pages must not hand it (or the child's
    // name) to GA4 / HubSpot / Vercel Analytics.
    expect(isPrivatePath('/credentials/STL-2026-ABCD1234')).toBe(true)
    expect(isPrivatePath('/credentials')).toBe(true)
  })

  it('keeps the existing private link routes private', () => {
    expect(isPrivatePath('/sign')).toBe(true)
    expect(isPrivatePath('/sign/copy')).toBe(true)
    expect(isPrivatePath('/register/nevada-2027/join/abc')).toBe(true)
    expect(isPrivatePath('/register/nevada-2027/pay/abc')).toBe(true)
    expect(isPrivatePath('/survey/tok')).toBe(true)
    expect(isPrivatePath('/team-profile/tok')).toBe(true)
    expect(isPrivatePath('/privacy/request')).toBe(true)
  })

  it('leaves ordinary public pages public', () => {
    expect(isPrivatePath('/about')).toBe(false)
    expect(isPrivatePath('/events')).toBe(false)
    expect(isPrivatePath('/register/nevada-2027/individual')).toBe(false)
    // not a credential path, just a prefix collision
    expect(isPrivatePath('/credentialsomething')).toBe(false)
  })
})
