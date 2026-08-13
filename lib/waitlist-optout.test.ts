import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.stubEnv('MARKETING_OPTOUT_SECRET', 'test-signing-secret')
vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://www.stellreducation.org')

const { optOutToken, verifyOptOutToken, waitlistUnsubscribeUrl } = await import('./waitlist-optout')

/**
 * The unsubscribe link is public and carries the address it refers to — it has
 * to, because CAN-SPAM requires opting out without logging in. That makes the
 * signature the only thing standing between the endpoint and a way to
 * unsubscribe anyone whose email you can guess.
 */
describe('optOutToken', () => {
  it('is stable for the same address, so old links keep working', () => {
    expect(optOutToken('a@b.com')).toBe(optOutToken('a@b.com'))
  })

  it('ignores case and surrounding whitespace', () => {
    expect(optOutToken('  A@B.com ')).toBe(optOutToken('a@b.com'))
  })

  it('differs between addresses', () => {
    expect(optOutToken('a@b.com')).not.toBe(optOutToken('c@d.com'))
  })
})

describe('verifyOptOutToken', () => {
  it('accepts a token it issued', () => {
    expect(verifyOptOutToken('a@b.com', optOutToken('a@b.com')!)).toBe(true)
  })

  it("rejects another address's token — the whole point of signing", () => {
    expect(verifyOptOutToken('victim@example.com', optOutToken('attacker@example.com')!)).toBe(false)
  })

  it('rejects a forged, empty, or truncated token', () => {
    const valid = optOutToken('a@b.com')!
    expect(verifyOptOutToken('a@b.com', 'f'.repeat(valid.length))).toBe(false)
    expect(verifyOptOutToken('a@b.com', '')).toBe(false)
    expect(verifyOptOutToken('a@b.com', valid.slice(0, -1))).toBe(false)
  })

  it('accepts a differently-cased address for the same token', () => {
    expect(verifyOptOutToken('A@B.COM', optOutToken('a@b.com')!)).toBe(true)
  })
})

describe('waitlistUnsubscribeUrl', () => {
  it('carries both the token and the address it refers to', () => {
    const url = new URL(waitlistUnsubscribeUrl('a@b.com')!)
    expect(url.pathname).toBe('/api/email/unsubscribe')
    expect(url.searchParams.get('e')).toBe('a@b.com')
    expect(verifyOptOutToken('a@b.com', url.searchParams.get('wl')!)).toBe(true)
  })

  it('url-encodes addresses that need it', () => {
    const url = new URL(waitlistUnsubscribeUrl('a+tag@b.com')!)
    // '+' must survive as a plus, not decode to a space.
    expect(url.searchParams.get('e')).toBe('a+tag@b.com')
  })
})

describe('without a signing secret', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('MARKETING_OPTOUT_SECRET', '')
    vi.stubEnv('CRON_SECRET', '')
  })

  it('produces no token and no link, so the send aborts rather than mailing without an opt-out', async () => {
    const mod = await import('./waitlist-optout')
    expect(mod.optOutToken('a@b.com')).toBeUndefined()
    expect(mod.waitlistUnsubscribeUrl('a@b.com')).toBeUndefined()
    expect(mod.verifyOptOutToken('a@b.com', 'anything')).toBe(false)
  })
})
