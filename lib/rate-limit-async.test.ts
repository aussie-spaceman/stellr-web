// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ take: vi.fn() }))

vi.mock('@/lib/rate-limit-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./rate-limit-store')>()),
  takeFromStore: h.take,
}))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => { throw new Error('the store must not be reached') } }))

import { rateLimitGuard } from './rate-limit'
import { limit, rateLimit, type LimitOptions } from './rate-limit-async'
import { STELLR_TENANT_ID } from './tenancy/constants'

const WINDOW = { limit: 1, windowMs: 60_000, tenantId: null }
const OTHER_TENANT = '11111111-1111-4111-8111-111111111111'

// The in-memory buckets outlive a test, so every test takes its own keys.
let n = 0
const fresh = () => `test-key-${++n}`
const request = (ip: string) => new Request('https://example.test/', { headers: { 'x-forwarded-for': ip } })

beforeEach(() => {
  h.take.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('memory mode, the default', () => {
  it('decides in memory and never touches the store', async () => {
    const key = fresh()
    expect((await limit(key, WINDOW)).ok).toBe(true)
    const second = await limit(key, WINDOW)
    expect(second.ok).toBe(false)
    expect(second.retryAfterSeconds).toBeGreaterThan(0)
    expect(h.take).not.toHaveBeenCalled()
  })

  it('treats an unrecognised mode as memory', async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'redis')
    await limit(fresh(), WINDOW)
    expect(h.take).not.toHaveBeenCalled()
  })
})

describe('postgres mode', () => {
  beforeEach(() => vi.stubEnv('RATE_LIMIT_STORE', 'postgres'))

  it('uses the store decision when memory allows the request, in both directions', async () => {
    h.take.mockResolvedValueOnce({ ok: false, retryAfterSeconds: 9 })
    expect(await limit(fresh(), WINDOW)).toEqual({ ok: false, retryAfterSeconds: 9 })

    h.take.mockResolvedValueOnce({ ok: true, retryAfterSeconds: 0 })
    expect(await limit(fresh(), WINDOW)).toEqual({ ok: true, retryAfterSeconds: 0 })
  })

  it('returns a memory denial without a database call', async () => {
    h.take.mockResolvedValue({ ok: true, retryAfterSeconds: 0 })
    const key = fresh()
    await limit(key, WINDOW)
    expect(h.take).toHaveBeenCalledOnce()

    const denied = await limit(key, WINDOW)
    expect(denied.ok).toBe(false)
    expect(denied.retryAfterSeconds).toBeGreaterThan(0)
    expect(h.take).toHaveBeenCalledOnce()
  })

  it('falls back to the memory decision when the store cannot answer, and never allows all', async () => {
    h.take.mockResolvedValue(null)
    const key = fresh()
    expect((await limit(key, WINDOW)).ok).toBe(true)
    expect((await limit(key, WINDOW)).ok).toBe(false)
  })

  it('has been counting in memory all along, so an outage does not restart the window', async () => {
    const key = fresh()
    const twoAllowed = { ...WINDOW, limit: 2 }
    h.take.mockResolvedValueOnce({ ok: true, retryAfterSeconds: 0 })
    await limit(key, twoAllowed)
    h.take.mockResolvedValueOnce(null)
    expect((await limit(key, twoAllowed)).ok).toBe(true)
    expect((await limit(key, twoAllowed)).ok).toBe(false)
  })
})

describe('shadow mode', () => {
  beforeEach(() => vi.stubEnv('RATE_LIMIT_STORE', 'shadow'))

  it('counts in the store and returns the memory decision when the store denies', async () => {
    h.take.mockResolvedValue({ ok: false, retryAfterSeconds: 9 })
    const decision = await limit(fresh(), WINDOW)
    expect(decision).toEqual({ ok: true, retryAfterSeconds: 0 })
    expect(h.take).toHaveBeenCalledOnce()
  })

  it('returns the memory decision when the store allows', async () => {
    h.take.mockResolvedValue({ ok: true, retryAfterSeconds: 0 })
    const key = fresh()
    await limit(key, WINDOW)
    expect((await limit(key, WINDOW)).ok).toBe(false)
  })

  it('makes no database call for a request memory already denies', async () => {
    h.take.mockResolvedValue({ ok: true, retryAfterSeconds: 0 })
    const key = fresh()
    await limit(key, WINDOW)
    await limit(key, WINDOW)
    expect(h.take).toHaveBeenCalledOnce()
  })

  it('logs a disagreement without the key', async () => {
    h.take.mockResolvedValue({ ok: false, retryAfterSeconds: 9 })
    const key = `route:203.0.113.9:${fresh()}`
    await limit(key, WINDOW)
    const logged = JSON.stringify(vi.mocked(console.warn).mock.calls)
    expect(logged).toContain('shadow disagreement')
    expect(logged).not.toContain('203.0.113.9')
  })

  it('logs nothing when they agree, and survives the store failing', async () => {
    h.take.mockResolvedValueOnce({ ok: true, retryAfterSeconds: 0 })
    await limit(fresh(), WINDOW)
    expect(console.warn).not.toHaveBeenCalled()

    h.take.mockResolvedValueOnce(null)
    expect((await limit(fresh(), WINDOW)).ok).toBe(true)
  })
})

describe('tenant keys', () => {
  beforeEach(() => {
    vi.stubEnv('RATE_LIMIT_STORE', 'postgres')
    h.take.mockResolvedValue({ ok: true, retryAfterSeconds: 0 })
  })

  it('are the bare key for Stellr, by id and for null', async () => {
    const [byNull, byId] = [fresh(), fresh()]
    await limit(byNull, { ...WINDOW, tenantId: null })
    await limit(byId, { ...WINDOW, tenantId: STELLR_TENANT_ID })
    expect(h.take.mock.calls.map((call) => call[0])).toEqual([byNull, byId])
  })

  it('must be stated: leaving tenantId out does not compile', () => {
    // @ts-expect-error tenantId is required, so no route lands in Stellr's bucket by omission.
    const opts: LimitOptions = { limit: 1, windowMs: 1 }
    expect(opts.limit).toBe(1)
  })

  it('differ for another tenant', async () => {
    const key = fresh()
    await limit(key, { ...WINDOW, tenantId: OTHER_TENANT })
    expect(h.take.mock.calls[0][0]).toBe(`tenant:${OTHER_TENANT}:${key}`)
  })

  it('keep two tenants in separate memory windows', async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'memory')
    const key = fresh()
    await limit(key, WINDOW)
    expect((await limit(key, { ...WINDOW, tenantId: OTHER_TENANT })).ok).toBe(true)
    expect((await limit(key, { ...WINDOW, tenantId: STELLR_TENANT_ID })).ok).toBe(false)
  })
})

describe('rateLimit', () => {
  it('returns null under the limit, then the same 429 the sync guard sends', async () => {
    const route = fresh()
    const ip = '203.0.113.10'
    expect(await rateLimit(request(ip), route, WINDOW)).toBeNull()
    const blocked = await rateLimit(request(ip), route, WINDOW)

    const syncRoute = fresh()
    rateLimitGuard(request(ip), syncRoute, WINDOW)
    const syncBlocked = rateLimitGuard(request(ip), syncRoute, WINDOW)

    expect(blocked?.status).toBe(429)
    expect(blocked?.status).toBe(syncBlocked?.status)
    expect(blocked?.headers.get('content-type')).toBe(syncBlocked?.headers.get('content-type'))
    expect(Number(blocked?.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(await blocked?.text()).toBe(await syncBlocked?.text())
  })

  it('logs the same line as the sync guard when it blocks', async () => {
    const ip = '203.0.113.13'
    const route = fresh()
    await rateLimit(request(ip), route, WINDOW)
    await rateLimit(request(ip), route, WINDOW)
    expect(console.warn).toHaveBeenCalledWith('[rate-limit] 429', route, ip)

    const syncRoute = fresh()
    rateLimitGuard(request(ip), syncRoute, WINDOW)
    rateLimitGuard(request(ip), syncRoute, WINDOW)
    expect(console.warn).toHaveBeenCalledWith('[rate-limit] 429', syncRoute, ip)
  })

  it('shares its bucket with the sync guard, so the keys match, with and without a suffix', async () => {
    const route = fresh()
    expect(rateLimitGuard(request('203.0.113.11'), route, WINDOW)).toBeNull()
    expect((await rateLimit(request('203.0.113.11'), route, WINDOW))?.status).toBe(429)

    expect(rateLimitGuard(request('203.0.113.11'), route, WINDOW, 'suffix')).toBeNull()
    expect((await rateLimit(request('203.0.113.11'), route, WINDOW, 'suffix'))?.status).toBe(429)
  })

  it('takes Retry-After from the store in postgres mode', async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'postgres')
    h.take.mockResolvedValue({ ok: false, retryAfterSeconds: 33 })
    const blocked = await rateLimit(request('203.0.113.12'), fresh(), WINDOW)
    expect(blocked?.headers.get('Retry-After')).toBe('33')
  })
})
