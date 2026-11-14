// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  lifecycle: vi.fn(),
  digest: vi.fn(),
  sweep: vi.fn(),
  jobs: [] as string[],
  runs: [] as { job: string; fail: ReturnType<typeof vi.fn>; finish: ReturnType<typeof vi.fn> }[],
}))

vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ rpc: h.rpc }) }))
vi.mock('@/lib/entitlements', () => ({ runEntitlementsLifecycle: h.lifecycle }))
vi.mock('@/lib/app-errors', () => ({ sendDailyErrorDigest: h.digest }))
vi.mock('@/lib/cron', () => ({ guardCron: () => null }))
vi.mock('@/lib/credential-minor-sweep', () => ({ sweepMinorCredentialPages: h.sweep }))
vi.mock('@/lib/cron-runs', () => ({
  startCronRun: async (_db: unknown, job: string) => {
    h.jobs.push(job)
    const run = { id: job, job, fail: vi.fn(), finish: vi.fn() }
    h.runs.push(run)
    return run
  },
}))

import { GET } from './route'

const call = () => GET(new NextRequest('https://example.test/api/cron/entitlements'))

const SWEEP = { scanned: 4, checked: 3, holdersUnpublished: 1, unpublished: 2, errors: 0, truncated: false }

beforeEach(() => {
  h.jobs.length = 0
  h.runs.length = 0
  h.sweep.mockReset().mockResolvedValue(SWEEP)
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

describe('GET /api/cron/entitlements: credential minor sweep (legal-credential-family-link.4)', () => {
  const entitlementsRun = () => h.runs.find((r) => r.job === 'entitlements')!

  it('runs as a step of the run, records its counts in the run result, and leaves the response as it was', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ granted: 1, errorDigest: { sent: false } })
    expect(h.sweep).toHaveBeenCalledTimes(1)
    expect(entitlementsRun().finish).toHaveBeenCalledWith({ granted: 1, credentialMinorSweep: SWEEP })
    expect(entitlementsRun().fail).not.toHaveBeenCalled()
    // No ledger row or cron of its own.
    expect(h.jobs).toEqual(['entitlements'])
  })

  it('records a thrown sweep as a run error, and the lifecycle still reports', async () => {
    h.sweep.mockRejectedValue(new Error('listing failed'))
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ granted: 1, errorDigest: { sent: false } })
    expect(entitlementsRun().fail).toHaveBeenCalledWith('credential-minor-sweep', expect.any(Error))
    expect(entitlementsRun().finish).toHaveBeenCalledWith({ granted: 1, credentialMinorSweep: { failed: true } })
    expect(h.digest).toHaveBeenCalled()
  })

  it('records holders it could not check, and a run that stopped at its limit, as run errors', async () => {
    h.sweep.mockResolvedValue({ ...SWEEP, errors: 2, truncated: true })
    await call()
    const fails = entitlementsRun().fail.mock.calls
    expect(fails.map((c) => c[0])).toEqual(['credential-minor-sweep', 'credential-minor-sweep'])
    expect(String(fails[0][1])).toMatch(/2 holder/)
    expect(String(fails[1][1])).toMatch(/per-run limit/)
  })

  it('still runs after a failed lifecycle, and the run records both', async () => {
    h.lifecycle.mockRejectedValue(new Error('boom'))
    const res = await call()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'lifecycle failed', errorDigest: { sent: false } })
    expect(h.sweep).toHaveBeenCalledTimes(1)
    expect(entitlementsRun().fail).toHaveBeenCalledWith('run', expect.any(Error))
    expect(entitlementsRun().finish).toHaveBeenCalledWith({ credentialMinorSweep: SWEEP })
  })
})
