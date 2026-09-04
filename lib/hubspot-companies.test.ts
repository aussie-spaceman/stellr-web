import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  domainFromEmail,
  isFreeEmailDomain,
  normaliseDomain,
} from './hubspot-companies'

describe('normaliseDomain', () => {
  it('strips protocol, www, path, query and port', () => {
    expect(normaliseDomain('https://www.carson.k12.nv.us/about?x=1')).toBe('carson.k12.nv.us')
    expect(normaliseDomain('http://example.com:8080/')).toBe('example.com')
    expect(normaliseDomain('  WWW.Example.COM  ')).toBe('example.com')
  })

  it('keeps multi-part public-suffix domains intact', () => {
    // School districts live under long suffixes; truncating to the last two
    // labels would merge every Nevada district into "nv.us".
    expect(normaliseDomain('washoeschools.net')).toBe('washoeschools.net')
    expect(normaliseDomain('https://ccsd.net')).toBe('ccsd.net')
  })

  it('rejects values that are not domains', () => {
    expect(normaliseDomain('not a domain')).toBeUndefined()
    expect(normaliseDomain('localhost')).toBeUndefined()
    expect(normaliseDomain('')).toBeUndefined()
    expect(normaliseDomain(undefined)).toBeUndefined()
  })
})

describe('domainFromEmail', () => {
  it('takes the domain from an work address', () => {
    expect(domainFromEmail('rchambers@carson.k12.nv.us')).toBe('carson.k12.nv.us')
    expect(domainFromEmail('  Head@Example.COM ')).toBe('example.com')
  })

  /**
   * The trap this guards. A prospect replying from a personal address must not
   * create a company called "Gmail" that then accumulates every unrelated
   * consumer lead as an employee.
   */
  it('returns nothing for consumer mailbox providers', () => {
    for (const e of [
      'a@gmail.com', 'b@yahoo.com', 'c@hotmail.com', 'd@outlook.com',
      'e@icloud.com', 'f@aol.com', 'g@proton.me', 'h@comcast.net',
    ]) {
      expect(domainFromEmail(e)).toBeUndefined()
    }
  })

  it('returns nothing for a malformed address', () => {
    expect(domainFromEmail('no-at-sign')).toBeUndefined()
    expect(domainFromEmail(undefined)).toBeUndefined()
  })
})

describe('isFreeEmailDomain', () => {
  it('identifies consumer providers', () => {
    expect(isFreeEmailDomain('gmail.com')).toBe(true)
    expect(isFreeEmailDomain('ccsd.net')).toBe(false)
    expect(isFreeEmailDomain(undefined)).toBe(false)
  })
})

/**
 * Regression guard for the duplicate accounts the first Apollo backfill
 * produced. `findCompanyByDomain` used to answer `null` both for "no such
 * company" and for "the lookup failed"; under load HubSpot rate-limited the
 * search, the failure read as absent, and a second company was created for a
 * domain that already had one. Two districts ended up doubled.
 */
describe('ensureCompany', () => {
  const OLD = process.env.HUBSPOT_ACCESS_TOKEN

  beforeEach(() => {
    process.env.HUBSPOT_ACCESS_TOKEN = 'test-token'
    vi.resetModules()
  })
  afterEach(() => {
    process.env.HUBSPOT_ACCESS_TOKEN = OLD
    vi.unstubAllGlobals()
  })

  /** Minimal fetch double that records which endpoints were called. */
  function stubFetch(handler: (url: string) => { status: number; body?: unknown }) {
    const calls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(url)
      const { status, body } = handler(url)
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body ?? {},
        text: async () => JSON.stringify(body ?? {}),
      } as Response
    })
    return calls
  }

  it('does NOT create a company when the domain lookup fails', async () => {
    const calls = stubFetch((url) =>
      url.includes('/search') ? { status: 429 } : { status: 200, body: { id: 'NEW' } },
    )
    const { ensureCompany } = await import('./hubspot-companies')
    const result = await ensureCompany({ email: 'head@ccsd.net' })

    expect(result).toBeNull()
    expect(calls.some((u) => u.includes('/search'))).toBe(true)
    // The create endpoint must never have been reached.
    expect(calls.some((u) => /\/companies$/.test(u))).toBe(false)
  })

  it('reuses the existing company when one is found', async () => {
    stubFetch((url) =>
      url.includes('/search')
        ? { status: 200, body: { results: [{ id: '123' }] } }
        : { status: 200, body: { id: 'NEW' } },
    )
    const { ensureCompany } = await import('./hubspot-companies')
    expect(await ensureCompany({ email: 'head@ccsd.net' })).toEqual({
      id: '123',
      created: false,
    })
  })

  /**
   * The other half of the duplicate bug: HubSpot's search index lags writes, so
   * two contacts at the same new domain processed back to back both read
   * "absent". The second must be served from memory, not searched again.
   */
  it('memoises a domain so a second contact cannot create a duplicate', async () => {
    let searches = 0
    let creates = 0
    stubFetch((url) => {
      if (url.includes('/search')) {
        searches++
        return { status: 200, body: { results: [] } } // always "absent"
      }
      creates++
      return { status: 200, body: { id: 'NEW' } }
    })
    const { ensureCompany } = await import('./hubspot-companies')
    const a = await ensureCompany({ email: 'one@arrupejesuit.com' })
    const b = await ensureCompany({ email: 'two@arrupejesuit.com' })

    expect(a).toEqual({ id: 'NEW', created: true })
    expect(b).toEqual({ id: 'NEW', created: false })
    expect(creates).toBe(1)
    expect(searches).toBe(1)
  })

  it('returns null for a consumer mailbox without calling HubSpot', async () => {
    const calls = stubFetch(() => ({ status: 200, body: {} }))
    const { ensureCompany } = await import('./hubspot-companies')
    expect(await ensureCompany({ email: 'someone@gmail.com' })).toBeNull()
    expect(calls).toHaveLength(0)
  })
})
