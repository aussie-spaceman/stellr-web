// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

const h = vi.hoisted(() => ({ rpc: vi.fn(), server: vi.fn(), cronStart: vi.fn(), cronFail: vi.fn(), cronFinish: vi.fn() }))

vi.mock('@/lib/supabase', () => ({ supabaseServer: h.server }))
vi.mock('@/lib/cron-runs', () => ({ startCronRun: h.cronStart }))

/** The app_errors writer and runAfterResponse, each noting when it is loaded. */
const rows = vi.hoisted(() => {
  const rows = {
    loaded: new Set<string>(),
    record: vi.fn(async (..._args: unknown[]) => true),
    /** lib/app-errors' own errorDigest, set once the real module is loaded below. */
    digest: (route: string, _message: string) => `digest of ${route}`,
    scheduled: [] as { label: string; task: Promise<unknown> }[],
    async settle() {
      await Promise.all(rows.scheduled.map((s) => s.task))
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
        runAfterResponse: (label: string, task: () => Promise<unknown>) => {
          rows.scheduled.push({ label, task: task() })
        },
      }
    },
  }
  return rows
})
vi.mock('@/lib/app-errors', () => rows.appErrors())
vi.mock('@/lib/after-response', () => rows.afterResponse())

import {
  RATE_LIMIT_ROWS_PER_MINUTE,
  STORE_TIMEOUT_MS,
  gcRateLimitStore,
  hashRateLimitKey,
  rateLimitStoreMode,
  takeFromStore,
} from './rate-limit-store'

// The real digest, so a test can see which failures share an app_errors row.
const appErrors = await vi.importActual<typeof import('./app-errors')>('./app-errors')
rows.digest = appErrors.errorDigest

const SECRET = 'k'.repeat(32)
const WINDOW = { limit: 5, windowMs: 60_000 }
const DAY_MS = 24 * 60 * 60 * 1000

/** What db.rpc(...).abortSignal(signal) resolves to. */
function rpcResolves(result: unknown) {
  h.rpc.mockReturnValue({ abortSignal: () => Promise.resolve(result) })
}

beforeEach(() => {
  rows.loaded.clear()
  rows.record.mockClear()
  rows.scheduled.length = 0
  h.rpc.mockReset()
  h.server.mockReset().mockReturnValue({ rpc: h.rpc })
  h.cronFail.mockReset()
  h.cronFinish.mockReset()
  h.cronStart.mockReset().mockResolvedValue({ id: 'run', fail: h.cronFail, finish: h.cronFinish })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubEnv('RATE_LIMIT_KEY_SECRET', SECRET)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('rateLimitStoreMode', () => {
  it('is memory when unset, empty or unrecognised', () => {
    for (const value of [undefined, '', 'redis', 'POSTGRES']) {
      vi.stubEnv('RATE_LIMIT_STORE', value as string)
      expect(rateLimitStoreMode()).toBe('memory')
    }
  })

  it('reads shadow and postgres, ignoring surrounding space', () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'shadow')
    expect(rateLimitStoreMode()).toBe('shadow')
    vi.stubEnv('RATE_LIMIT_STORE', 'postgres')
    expect(rateLimitStoreMode()).toBe('postgres')
    vi.stubEnv('RATE_LIMIT_STORE', ' shadow ')
    expect(rateLimitStoreMode()).toBe('shadow')
  })

  it('says nothing when unset or memory, and logs an unrecognised value without repeating it', () => {
    vi.useFakeTimers({ now: Date.now() + 10 * DAY_MS })
    vi.stubEnv('RATE_LIMIT_STORE', 'memory')
    rateLimitStoreMode()
    vi.stubEnv('RATE_LIMIT_STORE', '')
    rateLimitStoreMode()
    expect(console.error).not.toHaveBeenCalled()

    vi.stubEnv('RATE_LIMIT_STORE', 'Postgres')
    expect(rateLimitStoreMode()).toBe('memory')
    expect(console.error).toHaveBeenCalledOnce()
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('Postgres')
  })
})

describe('hashRateLimitKey', () => {
  it('is the keyed HMAC-SHA256 in bytea hex', () => {
    const expected = createHmac('sha256', SECRET).update('k1').digest('hex')
    expect(hashRateLimitKey('k1', SECRET)).toBe(`\\x${expected}`)
    expect(hashRateLimitKey('k1', SECRET)).toHaveLength(2 + 64)
  })

  it('changes with the secret and with the key', () => {
    expect(hashRateLimitKey('k1', SECRET)).not.toBe(hashRateLimitKey('k1', 'z'.repeat(32)))
    expect(hashRateLimitKey('k1', SECRET)).not.toBe(hashRateLimitKey('k2', SECRET))
  })
})

describe('takeFromStore', () => {
  it('sends only the hash, with the window in seconds, and reads the row', async () => {
    rpcResolves({ data: [{ allowed: false, retry_after: 42 }], error: null })
    const key = 'check-in-name:event:Ada:Lovelace:203.0.113.9'

    expect(await takeFromStore(key, WINDOW)).toEqual({ ok: false, retryAfterSeconds: 42 })

    expect(h.rpc).toHaveBeenCalledWith('rate_limit_take', {
      p_keys: [hashRateLimitKey(key, SECRET)],
      p_limits: [5],
      p_windows: [60],
    })
    const sent = JSON.stringify(h.rpc.mock.calls)
    for (const raw of ['203.0.113.9', 'Ada', 'Lovelace', 'check-in', SECRET]) expect(sent).not.toContain(raw)
  })

  it('rounds a sub-second window up to the one second the table can hold', async () => {
    rpcResolves({ data: [{ allowed: true, retry_after: 0 }], error: null })
    await takeFromStore('k', { limit: 1, windowMs: 200 })
    expect(h.rpc.mock.calls[0][1].p_windows).toEqual([1])
  })

  it('sends nothing without a secret, or with one that is too short', async () => {
    vi.stubEnv('RATE_LIMIT_KEY_SECRET', '')
    expect(await takeFromStore('k', WINDOW)).toBeNull()
    vi.stubEnv('RATE_LIMIT_KEY_SECRET', 'short')
    expect(await takeFromStore('k', WINDOW)).toBeNull()
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('gives up and aborts at the timeout', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    h.rpc.mockReturnValue({
      abortSignal: (s: AbortSignal) => {
        signal = s
        return new Promise(() => {})
      },
    })

    const pending = takeFromStore('k', WINDOW)
    await vi.advanceTimersByTimeAsync(STORE_TIMEOUT_MS - 1)
    expect(signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)

    expect(await pending).toBeNull()
    expect(signal?.aborted).toBe(true)
    expect(STORE_TIMEOUT_MS).toBe(300)
  })

  it('returns null, logging no key, on an error, a throw or an unexpected shape', async () => {
    const key = 'route:203.0.113.9'
    rpcResolves({ data: null, error: { message: 'function does not exist' } })
    expect(await takeFromStore(key, WINDOW)).toBeNull()
    rpcResolves({ data: [], error: null })
    expect(await takeFromStore(key, WINDOW)).toBeNull()
    h.rpc.mockImplementation(() => {
      throw new Error('no env')
    })
    expect(await takeFromStore(key, WINDOW)).toBeNull()

    const logged = JSON.stringify(vi.mocked(console.error).mock.calls)
    expect(logged).not.toContain('203.0.113.9')
  })

  it('logs each kind of failure once a minute, so an outage cannot flood the logs', async () => {
    vi.useFakeTimers({ now: Date.now() + 20 * DAY_MS })
    rpcResolves({ data: null, error: { message: 'down' } })
    await takeFromStore('k', WINDOW)
    await takeFromStore('k', WINDOW)
    expect(console.error).toHaveBeenCalledOnce()

    vi.advanceTimersByTime(60_000)
    await takeFromStore('k', WINDOW)
    expect(console.error).toHaveBeenCalledTimes(2)
  })

  it('builds one client, however many takes there are', async () => {
    vi.resetModules()
    const fresh = await import('./rate-limit-store')
    rpcResolves({ data: [{ allowed: true, retry_after: 0 }], error: null })
    await fresh.takeFromStore('k', WINDOW)
    await fresh.takeFromStore('k', WINDOW)
    expect(h.server).toHaveBeenCalledOnce()
  })
})

describe('app_errors rows for store problems', () => {
  // Each test takes a fresh module, so the once-a-minute state starts empty.
  // Its two lazy imports are registered again, so the test sees whether they load.
  async function freshStore() {
    vi.resetModules()
    vi.doMock('@/lib/app-errors', () => rows.appErrors())
    vi.doMock('@/lib/after-response', () => rows.afterResponse())
    rows.loaded.clear()
    return import('./rate-limit-store')
  }
  const written = () => rows.record.mock.calls.map(([route, message]) => `${route} | ${message}`)

  it('writes a missing secret, a timeout and a failure as fixed text, the failure by its SQLSTATE alone', async () => {
    const store = await freshStore()
    vi.stubEnv('RATE_LIMIT_KEY_SECRET', 'short')
    await store.takeFromStore('k', WINDOW)
    vi.stubEnv('RATE_LIMIT_KEY_SECRET', SECRET)

    rpcResolves({ data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } })
    await store.takeFromStore('k', WINDOW)

    vi.useFakeTimers()
    h.rpc.mockReturnValue({ abortSignal: () => new Promise(() => {}) })
    const pending = store.takeFromStore('k', WINDOW)
    await vi.advanceTimersByTimeAsync(STORE_TIMEOUT_MS)
    await pending
    await rows.settle()

    expect(written()).toEqual([
      'RATELIMIT store | store_skipped_no_secret',
      'RATELIMIT store | store_failed code=23505',
      'RATELIMIT store | store_timeout',
    ])
    expect(rows.scheduled.map((s) => s.label)).toEqual(['rate-limit', 'rate-limit', 'rate-limit'])
  })

  it('keeps a PostgREST code, and nothing that is not shaped like a code', async () => {
    vi.useFakeTimers({ now: Date.now() + 30 * DAY_MS })
    const store = await freshStore()
    for (const code of ['PGRST202', '203.0.113.9', undefined, 'abc12']) {
      rpcResolves({ data: null, error: { message: 'm', code } })
      await store.takeFromStore('k', WINDOW)
      vi.advanceTimersByTime(60_000)
    }
    h.rpc.mockImplementation(() => {
      throw new Error('no env')
    })
    await store.takeFromStore('k', WINDOW)
    vi.advanceTimersByTime(60_000)
    rpcResolves({ data: [], error: null })
    await store.takeFromStore('k', WINDOW)
    await rows.settle()

    expect(written()).toEqual([
      'RATELIMIT store | store_failed code=PGRST202',
      'RATELIMIT store | store_failed code=unknown',
      'RATELIMIT store | store_failed code=unknown',
      'RATELIMIT store | store_failed code=unknown',
      'RATELIMIT store | store_failed code=threw',
      'RATELIMIT store | store_failed code=unexpected_shape',
    ])
  })

  it('writes each kind at most once a minute per instance', async () => {
    vi.useFakeTimers({ now: Date.now() + 40 * DAY_MS })
    const store = await freshStore()
    rpcResolves({ data: null, error: { message: 'down', code: '57P01' } })
    await store.takeFromStore('k', WINDOW)
    await store.takeFromStore('k', WINDOW)
    rpcResolves({ data: null, error: { message: 'down', code: '08006' } })
    await store.takeFromStore('k', WINDOW)
    vi.stubEnv('RATE_LIMIT_KEY_SECRET', '')
    await store.takeFromStore('k', WINDOW)
    await store.takeFromStore('k', WINDOW)
    await rows.settle()
    expect(written()).toEqual(['RATELIMIT store | store_failed code=57P01', 'RATELIMIT store | store_skipped_no_secret'])

    vi.advanceTimersByTime(60_000)
    vi.stubEnv('RATE_LIMIT_KEY_SECRET', SECRET)
    await store.takeFromStore('k', WINDOW)
    await rows.settle()
    expect(written()).toHaveLength(3)
    expect(written()[2]).toBe('RATELIMIT store | store_failed code=08006')
  })

  it('gives each error code a row of its own, though the digest flattens digits', async () => {
    vi.useFakeTimers({ now: Date.now() + 45 * DAY_MS })
    const store = await freshStore()
    const codes = ['23505', '57014', '57P01', '08006', 'PGRST202', 'PGRST301']
    for (const code of codes) {
      rpcResolves({ data: null, error: { message: 'down', code } })
      await store.takeFromStore('k', WINDOW)
      vi.advanceTimersByTime(60_000)
    }
    await rows.settle()

    expect(written()).toEqual(codes.map((code) => `RATELIMIT store | store_failed code=${code}`))
    const digests = rows.record.mock.calls.map((call) => call[2])
    expect(new Set(digests).size).toBe(codes.length)
    // The flattening this guards against: by the message alone, these codes are one row.
    expect(appErrors.errorDigest('RATELIMIT store', 'store_failed code=23505')).toBe(
      appErrors.errorDigest('RATELIMIT store', 'store_failed code=57014'),
    )
  })

  it('takes at most a sixth of the app_errors write budget', () => {
    expect(RATE_LIMIT_ROWS_PER_MINUTE * 6).toBeLessThanOrEqual(appErrors.MAX_WRITES_PER_MINUTE)
  })

  it('never writes a key, an IP, the HMAC, the secret or the error message', async () => {
    vi.useFakeTimers({ now: Date.now() + 50 * DAY_MS })
    const store = await freshStore()
    const key = 'check-in-name:event:Ada:Lovelace:203.0.113.9'
    const hmac = hashRateLimitKey(key, SECRET).slice(2)
    const message = 'value 203.0.113.9 for Ada Lovelace rejected'
    const take = async () => {
      await store.takeFromStore(key, WINDOW)
      vi.advanceTimersByTime(60_000)
    }

    rpcResolves({ data: null, error: { message, code: '23505', details: message, hint: key } })
    await take()
    rpcResolves({ data: null, error: { message, code: key } })
    await take()
    h.rpc.mockImplementation(() => {
      throw new Error(message)
    })
    await take()
    rpcResolves({ data: [{ allowed: 'yes', retry_after: key }], error: null })
    await take()
    h.rpc.mockReturnValue({ abortSignal: () => new Promise(() => {}) })
    const pending = store.takeFromStore(key, WINDOW)
    await vi.advanceTimersByTimeAsync(STORE_TIMEOUT_MS)
    await pending
    vi.advanceTimersByTime(60_000)
    vi.stubEnv('RATE_LIMIT_KEY_SECRET', '')
    await take()
    await rows.settle()

    expect(rows.record).toHaveBeenCalledTimes(6)
    const payloads = JSON.stringify(rows.record.mock.calls)
    for (const raw of [key, '203.0.113.9', 'Ada', 'Lovelace', 'check-in', hmac, SECRET, message, 'rejected']) {
      expect(payloads).not.toContain(raw)
    }
  })

  it('writes nothing and loads neither module while the store answers', async () => {
    const store = await freshStore()
    rpcResolves({ data: [{ allowed: false, retry_after: 4 }], error: null })
    await store.takeFromStore('k', WINDOW)
    await store.takeFromStore('k', WINDOW)
    expect(rows.scheduled).toHaveLength(0)
    expect(rows.record).not.toHaveBeenCalled()
    expect([...rows.loaded]).toEqual([])
  })

  it('loads lib/app-errors only once there is a row to write', async () => {
    const store = await freshStore()
    vi.stubEnv('RATE_LIMIT_KEY_SECRET', '')
    await store.takeFromStore('k', WINDOW)
    await rows.settle()
    expect([...rows.loaded].sort()).toEqual(['after-response', 'app-errors'])
  })

  it('does not throw, or change the answer, when the write fails', async () => {
    const store = await freshStore()
    rows.record.mockResolvedValueOnce(false)
    rpcResolves({ data: null, error: { message: 'down', code: '57P01' } })
    expect(await store.takeFromStore('k', WINDOW)).toBeNull()
    await rows.settle()
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).toContain('app_errors record failed')
  })
})

describe('gcRateLimitStore', () => {
  const db = { rpc: h.rpc } as unknown as SupabaseClient

  it('makes no call and writes no ledger row in memory mode', async () => {
    expect(await gcRateLimitStore(db)).toBeNull()
    expect(h.rpc).not.toHaveBeenCalled()
    expect(h.cronStart).not.toHaveBeenCalled()
  })

  it('collects and records the count once the store is in use', async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'shadow')
    rpcResolves({ data: 7, error: null })

    expect(await gcRateLimitStore(db)).toEqual({ deleted: 7 })

    expect(h.rpc).toHaveBeenCalledWith('rate_limit_gc')
    expect(h.cronStart).toHaveBeenCalledWith(db, 'rate-limit-gc')
    expect(h.cronFinish).toHaveBeenCalledWith({ deleted: 7 })
    expect(h.cronFail).not.toHaveBeenCalled()
  })

  it('records a failure and does not throw when the function is missing', async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'postgres')
    rpcResolves({ data: null, error: { message: 'function does not exist' } })

    expect(await gcRateLimitStore(db)).toEqual({ failed: true })

    expect(h.cronFail).toHaveBeenCalledWith('gc', expect.any(Error))
    expect(h.cronFinish).toHaveBeenCalledWith({})
  })

  it('records a failure when the call never answers', async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'postgres')
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    h.rpc.mockReturnValue({
      abortSignal: (s: AbortSignal) => {
        signal = s
        return new Promise(() => {})
      },
    })

    const pending = gcRateLimitStore(db)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(await pending).toEqual({ failed: true })
    expect(signal?.aborted).toBe(true)
    expect(h.cronFail).toHaveBeenCalledWith('gc', expect.any(Error))
    expect(h.cronFinish).toHaveBeenCalledWith({})
  })

  it('does not throw when the call itself throws', async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'postgres')
    h.rpc.mockImplementation(() => {
      throw new Error('boom')
    })
    expect(await gcRateLimitStore(db)).toEqual({ failed: true })
  })
})
