// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

const h = vi.hoisted(() => ({ rpc: vi.fn(), server: vi.fn(), cronStart: vi.fn(), cronFail: vi.fn(), cronFinish: vi.fn() }))

vi.mock('@/lib/supabase', () => ({ supabaseServer: h.server }))
vi.mock('@/lib/cron-runs', () => ({ startCronRun: h.cronStart }))

import { STORE_TIMEOUT_MS, gcRateLimitStore, hashRateLimitKey, rateLimitStoreMode, takeFromStore } from './rate-limit-store'

const SECRET = 'k'.repeat(32)
const WINDOW = { limit: 5, windowMs: 60_000 }
const DAY_MS = 24 * 60 * 60 * 1000

/** What db.rpc(...).abortSignal(signal) resolves to. */
function rpcResolves(result: unknown) {
  h.rpc.mockReturnValue({ abortSignal: () => Promise.resolve(result) })
}

beforeEach(() => {
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
