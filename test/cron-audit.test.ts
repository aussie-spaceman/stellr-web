// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CRON_SCOPES } from '@/lib/cron-scope'
import { auditHandlers } from '@/lib/security/audit-coverage'

// The cron audit hook (docs/TENANCY-S5.md, B12, lib/cron-audit.ts): one event per
// authorised run, none on a refused one, and nothing an audit does can stop a cron.
// The behaviour runs through a real route, with the real guardCron and withCronAudit, down
// to the rpc the database would receive.

const after = vi.fn()
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => unknown) => after(task),
}))
const capture = vi.fn()
vi.mock('@/lib/app-errors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/app-errors')>()),
  captureRequestError: (...a: unknown[]) => capture(...a),
}))
const rpc = vi.fn()
const serverClient = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => serverClient() }))
const dispatch = vi.fn()
vi.mock('@/lib/team-profile/store', () => ({ dispatchTeamProfiles: (...a: unknown[]) => dispatch(...a) }))
const finish = vi.fn()
vi.mock('@/lib/cron-runs', () => ({ startCronRun: async () => ({ fail: () => {}, finish }) }))

const SECRET = 'test-cron-secret'
const JOB = 'team-profiles'
const url = `https://example.test/api/cron/${JOB}`
const authed = () => new Request(url, { headers: { authorization: `Bearer ${SECRET}` } }) as never

/** APP_ENV is read once at module load, so each case imports the route afresh. */
async function loadRoute(env: { appEnv?: string; audit?: boolean } = {}) {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_APP_ENV', env.appEnv ?? 'prod')
  vi.stubEnv('CRON_SECRET', SECRET)
  vi.stubEnv('PLATFORM_AUDIT_ENABLED', env.audit === false ? '' : 'true')
  return import('@/app/api/cron/team-profiles/route')
}

/** Run what after() was given, as Next does once the response has gone. */
const settle = () => Promise.all(after.mock.calls.map(([task]) => (task as () => Promise<unknown>)()))

beforeEach(() => {
  vi.clearAllMocks()
  after.mockReset()
  rpc.mockReset()
  rpc.mockResolvedValue({ data: { id: 1, chain_seq: 1 }, error: null })
  serverClient.mockReset()
  serverClient.mockReturnValue({ rpc })
  dispatch.mockReset()
  dispatch.mockResolvedValue({ sent: 2 })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('an authorised run', () => {
  it('writes exactly one event, once the response has gone, naming the job and the status', async () => {
    const { GET } = await loadRoute()
    const res = await GET(authed())
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ sent: 2 })
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(rpc).not.toHaveBeenCalled()
    expect(after).toHaveBeenCalledTimes(1)
    await settle()
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('platform_audit_append', {
      p_tenant: null,
      p_actor: `cron:${JOB}`,
      p_actor_kind: 'cron',
      p_action: 'cron.run.finish',
      p_target_table: null,
      p_target_id: null,
      p_reason: null,
      p_metadata: { status: 200 },
    })
  })

  it('records a run that failed, with its status', async () => {
    dispatch.mockRejectedValue(new Error('broke'))
    const { GET } = await loadRoute()
    expect((await GET(authed())).status).toBe(500)
    await settle()
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_action: 'cron.run.finish', p_metadata: { status: 500 } })
  })

  it('never reads the response: what a cron answers with stays out of the event', async () => {
    dispatch.mockResolvedValue({ stampedNow: ['someone@example.test'], name: 'Someone Example' })
    const { GET } = await loadRoute()
    await GET(authed())
    await settle()
    const written = JSON.stringify(rpc.mock.calls[0][1])
    expect(written).not.toContain('@')
    expect(written).not.toContain('Someone')
    expect(Object.keys(rpc.mock.calls[0][1].p_metadata)).toEqual(['status'])
  })

  it('a handler that throws still throws, and is recorded', async () => {
    await loadRoute()
    const { withCronAudit } = await import('@/lib/cron-audit')
    const boom = new Error('boom')
    await expect(withCronAudit(JOB, async () => { throw boom })()).rejects.toBe(boom)
    await settle()
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_actor: `cron:${JOB}`, p_metadata: { status: 500 } })
  })
})

describe('a refused run writes nothing', () => {
  it('a wrong secret: 401, and the job does not run', async () => {
    const { GET } = await loadRoute()
    const res = await GET(new Request(url, { headers: { authorization: 'Bearer wrong' } }) as never)
    expect(res.status).toBe(401)
    expect(dispatch).not.toHaveBeenCalled()
    expect(after).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it("the guard's decline outside production: 200, and the job does not run", async () => {
    const { GET } = await loadRoute({ appEnv: 'dev' })
    const res = await GET(authed())
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ skipped: true, reason: 'APP_ENV=dev' })
    expect(dispatch).not.toHaveBeenCalled()
    expect(after).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
    // Declining is not a failed audit either.
    expect(capture).not.toHaveBeenCalled()
  })
})

describe('with PLATFORM_AUDIT_ENABLED off, the default', () => {
  it('the run is the same and the audit does nothing: no client, no rpc, nothing scheduled', async () => {
    const { GET } = await loadRoute({ audit: false })
    const res = await GET(authed())
    await expect(res.json()).resolves.toEqual({ sent: 2 })
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(after).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
    // Only the route's own client.
    expect(serverClient).toHaveBeenCalledTimes(1)
  })
})

describe('an audit failure never fails or stops a cron', () => {
  it.each([
    ['the rpc rejects', () => rpc.mockRejectedValue(new Error('connection refused'))],
    ['the rpc answers an error', () => rpc.mockResolvedValue({ data: null, error: { message: 'check failed' } })],
    ['the rpc throws', () => rpc.mockImplementation(() => { throw new Error('thrown') })],
    ['no client can be built', () => serverClient.mockReturnValueOnce({ rpc }).mockImplementation(() => { throw new Error('no client') })],
  ])('%s', async (_name, arrange) => {
    arrange()
    const { GET } = await loadRoute()
    const res = await GET(authed())
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ sent: 2 })
    expect(finish).toHaveBeenCalledTimes(1)
    await expect(settle()).resolves.toBeDefined()
    expect(capture).toHaveBeenCalledTimes(1)
  })

  it('a database that hangs costs the bound and nothing more, after the response', async () => {
    rpc.mockImplementation(() => new Promise(() => {}))
    const { GET } = await loadRoute()
    const res = await GET(authed())
    expect(res.status).toBe(200)
    vi.useFakeTimers()
    const done = settle()
    await vi.advanceTimersByTimeAsync(3_100)
    await expect(done).resolves.toBeDefined()
    expect(capture).toHaveBeenCalledTimes(1)
  })

  it('after() itself refusing does not reach the cron, and the event is still tried', async () => {
    after.mockImplementation(() => { throw new Error('outside a request') })
    const { GET } = await loadRoute()
    const res = await GET(authed())
    expect(res.status).toBe(200)
    await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(1))
  })
})

describe('every cron is covered, once', () => {
  const jobs = readdirSync('app/api/cron', { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
  const schedules = (JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons: { path: string }[] }).crons
  const fileOf = (job: string) => `app/api/cron/${job}/route.ts`

  it('accounts for all 24: the routes, the schedules and the classification agree', () => {
    expect(jobs).toHaveLength(24)
    expect([...new Set(schedules.map((c) => c.path.replace('/api/cron/', '')))].sort()).toEqual(jobs)
    expect(Object.keys(CRON_SCOPES).sort()).toEqual(jobs)
  })

  it.each(readdirSync('app/api/cron'))('%s audits under its own name, with the guard still first', (job) => {
    const src = readFileSync(fileOf(job), 'utf8')
    expect(src.match(/withCronAudit\(/g), 'one wrapper').toHaveLength(1)
    expect(src, 'withAudit directly would skip the decline outside production').not.toMatch(/withAudit\(/)
    expect(src).toMatch(new RegExp(`^export const GET = withCronAudit\\('${job}', async \\(req: (Next)?Request\\) => \\{\\n  const blocked = guardCron\\(req\\)\\n  if \\(blocked\\) return blocked\\n`, 'm'))
    expect(src, 'a second writer would be a second event').not.toMatch(/auditMutation|lib\/audit\/platform/)
    expect(auditHandlers(fileOf(job), src)).toEqual([{ key: `${fileOf(job)}#GET`, file: fileOf(job), method: 'GET', kind: 'cron', audited: true, coverage: 'mandatory' }])
  })

  it('every job name fits the actor shape the table accepts, so none is stored as unresolved', async () => {
    const { resolveActor } = await import('@/lib/audit/route')
    for (const job of jobs) expect(await resolveActor({ cron: job })).toEqual({ actor: `cron:${job}`, metadata: {} })
  })

  it('the baseline owes no cron', () => {
    const baseline = JSON.parse(readFileSync('test/baselines/unaudited-mutations.json', 'utf8'))
    expect(baseline.crons).toEqual([])
    expect(baseline.totals).toMatchObject({ cronHandlers: 24, unauditedCrons: 0 })
  })
})
