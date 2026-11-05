// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  lifecycle: vi.fn(),
  digest: vi.fn(),
  jobs: [] as string[],
}))

vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ rpc: h.rpc }) }))
vi.mock('@/lib/entitlements', () => ({ runEntitlementsLifecycle: h.lifecycle }))
vi.mock('@/lib/app-errors', () => ({ sendDailyErrorDigest: h.digest }))
vi.mock('@/lib/cron', () => ({ guardCron: () => null }))
vi.mock('@/lib/cron-runs', () => ({
  startCronRun: async (_db: unknown, job: string) => {
    h.jobs.push(job)
    return { id: job, fail: vi.fn(), finish: vi.fn() }
  },
}))

import { GET } from './route'

const call = () => GET(new NextRequest('https://example.test/api/cron/entitlements'))

beforeEach(() => {
  h.jobs.length = 0
  h.rpc.mockReset()
  h.lifecycle.mockReset().mockResolvedValue({ granted: 1 })
  h.digest.mockReset().mockResolvedValue({ sent: false })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('GET /api/cron/entitlements: rate limit gc', () => {
  it('in memory mode, the default, makes no call and leaves the response as it was', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ granted: 1, errorDigest: { sent: false } })
    expect(h.rpc).not.toHaveBeenCalled()
    expect(h.jobs).toEqual(['entitlements'])
  })

  it('leaves a failed lifecycle response as it was in memory mode', async () => {
    h.lifecycle.mockRejectedValue(new Error('boom'))
    const res = await call()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'lifecycle failed', errorDigest: { sent: false } })
    expect(h.rpc).not.toHaveBeenCalled()
  })

  it('collects once the store is in use, under its own ledger row', async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'shadow')
    h.rpc.mockReturnValue({ abortSignal: async () => ({ data: 3, error: null }) })
    const res = await call()
    expect(await res.json()).toEqual({ granted: 1, errorDigest: { sent: false }, rateLimitGc: { deleted: 3 } })
    expect(h.jobs).toEqual(['entitlements', 'rate-limit-gc'])
  })

  it('still reports the lifecycle when gc errors or throws', async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'postgres')
    h.rpc.mockReturnValue({ abortSignal: async () => ({ data: null, error: { message: 'function does not exist' } }) })
    const errored = await call()
    expect(errored.status).toBe(200)
    expect(await errored.json()).toMatchObject({ granted: 1, rateLimitGc: { failed: true } })

    h.rpc.mockImplementation(() => {
      throw new Error('boom')
    })
    const thrown = await call()
    expect(thrown.status).toBe(200)
    expect(await thrown.json()).toMatchObject({ granted: 1, rateLimitGc: { failed: true } })
  })

  it('still runs after a failed lifecycle', async () => {
    vi.stubEnv('RATE_LIMIT_STORE', 'postgres')
    h.lifecycle.mockRejectedValue(new Error('boom'))
    h.rpc.mockReturnValue({ abortSignal: async () => ({ data: 2, error: null }) })
    const res = await call()
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: 'lifecycle failed', rateLimitGc: { deleted: 2 } })
  })
})
