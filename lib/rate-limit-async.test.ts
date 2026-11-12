// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ take: vi.fn() }))

vi.mock('@/lib/rate-limit-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./rate-limit-store')>()),
  takeFromStore: h.take,
}))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => { throw new Error('the store must not be reached') } }))

/** The app_errors writer and runAfterResponse, each noting when it is loaded. */
const rows = vi.hoisted(() => {
  const rows = {
    loaded: new Set<string>(),
    record: vi.fn(async (..._args: unknown[]) => true),
    /** lib/app-errors' own errorDigest, set once the real module is loaded below. */
    digest: (route: string, _message: string) => `digest of ${route}`,
    scheduled: [] as Promise<unknown>[],
    async settle() {
      await Promise.all(rows.scheduled)
    },
    appErrors() {
      rows.loaded.add('app-errors')
      return {
        errorDigest: (route: string, message: string) => rows.digest(route, message),
        routeLabel: (method: string, routePath: string) => `${method} ${routePath}`,
        recordBuiltAppError: rows.record,
      }
    },
    afterResponse() {
      rows.loaded.add('after-response')
      return {
        runAfterResponse: (_label: string, task: () => Promise<unknown>) => {
          rows.scheduled.push(task())
        },
      }
    },
  }
  return rows
})
vi.mock('@/lib/app-errors', () => rows.appErrors())
vi.mock('@/lib/after-response', () => rows.afterResponse())

import { rateLimitGuard } from './rate-limit'
import { limit, rateLimit, type LimitOptions } from './rate-limit-async'
import { RATE_LIMIT_ROWS_PER_MINUTE, hashRateLimitKey, resetRateLimitRowState } from './rate-limit-store'
import { STELLR_TENANT_ID } from './tenancy/constants'

// The real digest, so a test can see which disagreements share an app_errors row.
rows.digest = (await vi.importActual<typeof import('./app-errors')>('./app-errors')).errorDigest

const WINDOW = { limit: 1, windowMs: 60_000, tenantId: null }
const OTHER_TENANT = '11111111-1111-4111-8111-111111111111'

// The in-memory buckets outlive a test, so every test takes its own keys.
let n = 0
const fresh = () => `test-key-${++n}`
const request = (ip: string) => new Request('https://example.test/', { headers: { 'x-forwarded-for': ip } })

beforeEach(() => {
  rows.loaded.clear()
  rows.record.mockClear()
  rows.scheduled.length = 0
  h.take.mockReset()
  resetRateLimitRowState()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
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

describe('app_errors rows for shadow disagreements', () => {
  const written = () => rows.record.mock.calls.map(([route, message]) => `${route} | ${message}`)

  it("writes a fixed-text 'RATELIMIT <label>' row when the store and memory disagree", async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'shadow')
    h.take.mockResolvedValue({ ok: false, retryAfterSeconds: 9 })
    await limit(fresh(), WINDOW)
    await rateLimit(request('203.0.113.20'), 'check-in', WINDOW, fresh())
    await rows.settle()
    expect(written()).toEqual([
      'RATELIMIT limit | shadow_disagreement memory=allow store=deny',
      'RATELIMIT check-in | shadow_disagreement memory=allow store=deny',
    ])
    const digests = rows.record.mock.calls.map((call) => call[2])
    expect(new Set(digests).size).toBe(2)
  })

  it('writes each label at most once a minute', async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'shadow')
    vi.useFakeTimers({ toFake: ['Date'] })
    h.take.mockResolvedValue({ ok: false, retryAfterSeconds: 9 })
    await rateLimit(request('203.0.113.23'), 'check-in', WINDOW, fresh())
    await rateLimit(request('203.0.113.24'), 'check-in', WINDOW, fresh())
    await limit(fresh(), WINDOW)
    await rows.settle()
    expect(written()).toEqual([
      'RATELIMIT check-in | shadow_disagreement memory=allow store=deny',
      'RATELIMIT limit | shadow_disagreement memory=allow store=deny',
    ])
    expect(rows.scheduled).toHaveLength(2)

    vi.setSystemTime(Date.now() + 60_000)
    await rateLimit(request('203.0.113.23'), 'check-in', WINDOW, fresh())
    await rows.settle()
    expect(written()).toHaveLength(3)
    expect(written()[2]).toBe('RATELIMIT check-in | shadow_disagreement memory=allow store=deny')
  })

  it('caps its rows each minute, so it cannot use up the budget other app_errors rows share', async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'shadow')
    vi.useFakeTimers({ toFake: ['Date'] })
    h.take.mockResolvedValue({ ok: false, retryAfterSeconds: 9 })
    const labels = Array.from({ length: 30 }, (_, i) => `public-route-${i}`)
    for (const label of labels) await rateLimit(request('203.0.113.25'), label, WINDOW, fresh())
    await rows.settle()
    expect(rows.record).toHaveBeenCalledTimes(RATE_LIMIT_ROWS_PER_MINUTE)
    expect(rows.scheduled).toHaveLength(RATE_LIMIT_ROWS_PER_MINUTE)
    expect(RATE_LIMIT_ROWS_PER_MINUTE).toBeLessThan(labels.length)

    vi.setSystemTime(Date.now() + 60_000)
    for (const label of labels) await rateLimit(request('203.0.113.25'), label, WINDOW, fresh())
    await rows.settle()
    expect(rows.record).toHaveBeenCalledTimes(2 * RATE_LIMIT_ROWS_PER_MINUTE)
  })

  it('never writes a key, an IP or the HMAC', async () => {
    const secret = 'k'.repeat(32)
    vi.stubEnv('RATE_LIMIT_STORE', 'shadow')
    vi.stubEnv('RATE_LIMIT_KEY_SECRET', secret)
    h.take.mockResolvedValue({ ok: false, retryAfterSeconds: 9 })
    const ip = '203.0.113.21'
    const nameKey = `check-in-name:event-slug:Ada:Lovelace:${ip}:${fresh()}`
    const suffix = `token-${fresh()}`
    vi.useFakeTimers({ toFake: ['Date'] })
    await limit(nameKey, WINDOW)
    // A minute on, so the second 'limit' row is not held back as a repeat.
    vi.setSystemTime(Date.now() + 60_000)
    await limit(nameKey, { ...WINDOW, tenantId: OTHER_TENANT })
    await rateLimit(request(ip), 'check-in', WINDOW, suffix)
    await rows.settle()

    expect(rows.record).toHaveBeenCalledTimes(3)
    const sentKeys = h.take.mock.calls.map((call) => call[0] as string)
    const hmacs = sentKeys.map((key) => hashRateLimitKey(key, secret).slice(2))
    const payloads = JSON.stringify(rows.record.mock.calls)
    for (const raw of [...sentKeys, ...hmacs, nameKey, suffix, ip, 'Ada', 'Lovelace', 'event-slug', OTHER_TENANT]) {
      expect(payloads).not.toContain(raw)
    }
  })

  it('writes nothing when they agree, in postgres mode, or when the store cannot answer', async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'shadow')
    h.take.mockResolvedValueOnce({ ok: true, retryAfterSeconds: 0 })
    await limit(fresh(), WINDOW)
    h.take.mockResolvedValueOnce(null)
    await limit(fresh(), WINDOW)
    vi.stubEnv('RATE_LIMIT_STORE', 'postgres')
    h.take.mockResolvedValueOnce({ ok: false, retryAfterSeconds: 9 })
    await limit(fresh(), WINDOW)
    await rows.settle()
    expect(rows.scheduled).toHaveLength(0)
    expect(rows.record).not.toHaveBeenCalled()
  })

  it('does not change the decision when the write fails', async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'shadow')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    rows.record.mockResolvedValueOnce(false)
    h.take.mockResolvedValue({ ok: false, retryAfterSeconds: 9 })
    expect(await limit(fresh(), WINDOW)).toEqual({ ok: true, retryAfterSeconds: 0 })
    await rows.settle()
    expect(console.error).toHaveBeenCalledWith('[rate-limit] app_errors record failed')
  })
})

describe('memory mode loads nothing new', () => {
  // Fresh modules, with the two lazy imports registered again, so a test sees whether they load.
  async function freshAsync() {
    vi.resetModules()
    vi.doMock('@/lib/app-errors', () => rows.appErrors())
    vi.doMock('@/lib/after-response', () => rows.afterResponse())
    rows.loaded.clear()
    return import('./rate-limit-async')
  }

  it('imports neither lib/app-errors nor lib/after-response, and writes nothing, with RATE_LIMIT_STORE unset', async () => {
    vi.stubEnv('RATE_LIMIT_STORE', undefined as unknown as string)
    const async = await freshAsync()
    const key = fresh()
    await async.limit(key, WINDOW)
    await async.limit(key, WINDOW)
    const route = fresh()
    await async.rateLimit(request('203.0.113.22'), route, WINDOW)
    expect((await async.rateLimit(request('203.0.113.22'), route, WINDOW))?.status).toBe(429)
    expect(h.take).not.toHaveBeenCalled()
    expect(rows.scheduled).toHaveLength(0)
    expect([...rows.loaded]).toEqual([])
  })

  it('loads them only once there is a row to write', async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'shadow')
    const async = await freshAsync()
    h.take.mockResolvedValue({ ok: true, retryAfterSeconds: 0 })
    await async.limit(fresh(), WINDOW)
    expect([...rows.loaded]).toEqual([])

    h.take.mockResolvedValue({ ok: false, retryAfterSeconds: 9 })
    await async.limit(fresh(), WINDOW)
    await rows.settle()
    expect([...rows.loaded].sort()).toEqual(['after-response', 'app-errors'])
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

describe('the store budget, for keys a client chooses', () => {
  const BUDGET = 2_000
  const ip = () => `198.51.100.${++n % 250}`

  /** Spend an IP's budget on keys that each hold something new, as a client spraying slugs would. */
  async function spend(addr: string) {
    for (let i = 0; i < BUDGET; i++) await rateLimit(request(addr), 'spray', WINDOW, fresh())
  }

  it('stops one IP writing a row for every request, and refuses nobody for it', async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'postgres')
    h.take.mockResolvedValue({ ok: true, retryAfterSeconds: 0 })
    const addr = ip()
    await spend(addr)
    expect(h.take).toHaveBeenCalledTimes(BUDGET)

    expect(await rateLimit(request(addr), 'spray', WINDOW, fresh())).toBeNull()
    expect(h.take).toHaveBeenCalledTimes(BUDGET)

    await rateLimit(request(ip()), 'spray', WINDOW, fresh())
    expect(h.take).toHaveBeenCalledTimes(BUDGET + 1)
  })

  it('keeps counting in memory past the budget', async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'postgres')
    h.take.mockResolvedValue({ ok: true, retryAfterSeconds: 0 })
    const addr = ip()
    await spend(addr)
    const suffix = fresh()
    expect(await rateLimit(request(addr), 'spray', WINDOW, suffix)).toBeNull()
    expect((await rateLimit(request(addr), 'spray', WINDOW, suffix))?.status).toBe(429)
  })

  it('is per route, and leaves unsuffixed calls and limit() reaching the store', async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'postgres')
    h.take.mockResolvedValue({ ok: true, retryAfterSeconds: 0 })
    const addr = ip()
    await spend(addr)
    h.take.mockClear()

    await rateLimit(request(addr), 'spray', WINDOW, fresh())
    expect(h.take).not.toHaveBeenCalled()
    await limit(fresh(), WINDOW)
    await rateLimit(request(addr), fresh(), WINDOW)
    await rateLimit(request(addr), fresh(), WINDOW, fresh())
    expect(h.take).toHaveBeenCalledTimes(3)
  })

  it('cannot be spent to lift a limit() the store is already refusing', async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'postgres')
    h.take.mockResolvedValue({ ok: true, retryAfterSeconds: 0 })
    await spend(ip())
    h.take.mockResolvedValue({ ok: false, retryAfterSeconds: 9 })
    expect(await limit(fresh(), WINDOW)).toEqual({ ok: false, retryAfterSeconds: 9 })
  })

  it('past the budget, a key the store would refuse is decided in memory', async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'postgres')
    h.take.mockResolvedValue({ ok: true, retryAfterSeconds: 0 })
    const addr = ip()
    await spend(addr)
    h.take.mockResolvedValue({ ok: false, retryAfterSeconds: 9 })
    expect(await rateLimit(request(addr), 'spray', WINDOW, fresh())).toBeNull()
  })

  it('holds when a spray pushes the in-memory limiter past its key cap', async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'postgres')
    h.take.mockResolvedValue({ ok: true, retryAfterSeconds: 0 })
    const addr = ip()
    for (let i = 0; i < 12_000; i++) await rateLimit(request(addr), 'spray', WINDOW, fresh())
    expect(h.take).toHaveBeenCalledTimes(BUDGET)
  })

  it('starts again when its hour is up', async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'postgres')
    h.take.mockResolvedValue({ ok: true, retryAfterSeconds: 0 })
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const addr = ip()
      await spend(addr)
      h.take.mockClear()
      vi.setSystemTime(Date.now() + 60 * 60 * 1000)
      await rateLimit(request(addr), 'spray', WINDOW, fresh())
      expect(h.take).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a bounded number of budgets, dropping the oldest first', async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'postgres')
    h.take.mockResolvedValue({ ok: true, retryAfterSeconds: 0 })
    const addr = ip()
    await spend(addr)
    for (let i = 0; i < 10_000; i++) {
      await rateLimit(request(`2001:db8::${i.toString(16)}`), 'spray', WINDOW, 'one-key')
    }
    h.take.mockClear()
    await rateLimit(request(addr), 'spray', WINDOW, fresh())
    expect(h.take).toHaveBeenCalledOnce()
  })

  it('does not apply in shadow mode answers, and memory mode keeps no count of it', async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'shadow')
    h.take.mockResolvedValue({ ok: false, retryAfterSeconds: 9 })
    const addr = ip()
    await spend(addr)
    expect(await rateLimit(request(addr), 'spray', WINDOW, fresh())).toBeNull()

    vi.stubEnv('RATE_LIMIT_STORE', 'memory')
    const untouched = ip()
    await spend(untouched)
    vi.stubEnv('RATE_LIMIT_STORE', 'postgres')
    h.take.mockClear()
    h.take.mockResolvedValue({ ok: true, retryAfterSeconds: 0 })
    await rateLimit(request(untouched), 'spray', WINDOW, fresh())
    expect(h.take).toHaveBeenCalledOnce()
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
