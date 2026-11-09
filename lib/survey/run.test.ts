import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CronRun } from '@/lib/cron-runs'
import { STELLR_TENANT_ID as STELLR } from '@/lib/tenancy/constants'
import { fakeChainDb, runnerAnswer, type ChainCall, type Row } from '@/test/helpers/fake-chain-db'

// The surveys cron per tenant (S5 B13). The survey machinery below the loop is
// mocked: these tests are about which distributions are processed, in what
// order, and what the run records.

const TENANT_B = 'bbbbbbbb-0000-4000-8000-00000000000b'

const sweep = vi.fn()
const loadDefinition = vi.fn()
const sendQueued = vi.fn()
const sendReminders = vi.fn()
vi.mock('./events', () => ({ loadAllSurveyEvents: () => sweep() }))
vi.mock('./distributions', () => ({
  applyClock: async () => ({ opened: ['x'], closed: [] }),
  ensureDistribution: async () => ({ action: 'created' }),
  getDistribution: async () => null,
  loadDefinition: (...a: unknown[]) => loadDefinition(...a),
  planFor: async () => ({ invitable: [{ recipientKey: 'k' }], awaitingConsent: [], unreachable: [] }),
  materialiseInvitations: async () => 1,
}))
vi.mock('./send', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./send')>()),
  sendQueued: (...a: unknown[]) => sendQueued(...a),
  sendReminders: (...a: unknown[]) => sendReminders(...a),
}))

const { runSurveys } = await import('./run')

function dist(id: string, slug: string, tenant: string | null): Row {
  return { id, event_slug: slug, definition_id: 'def', status: 'open', tenant_id: tenant }
}

function setup(open: Row[], opts: { openError?: boolean; tenants?: Row[] } = {}) {
  const tenants = opts.tenants ?? [
    { id: STELLR, status: 'active', time_zone: 'America/Denver', is_platform_owner: true },
    { id: TENANT_B, status: 'active', time_zone: 'UTC', is_platform_owner: false },
  ]
  return fakeChainDb((call: ChainCall) => {
    const runner = runnerAnswer(call, tenants)
    if (runner) return runner
    if (call.table === 'survey_distributions' && call.op === 'select') {
      return opts.openError ? { data: null, error: { message: 'read failed' } } : { data: open, error: null }
    }
    return { data: null, error: null }
  })
}

function fakeRun() {
  const fails: { where: string; message: string }[] = []
  const run: CronRun = {
    id: 'parent-1',
    fail: (where, err) => fails.push({ where, message: err instanceof Error ? err.message : String(err) }),
    finish: async () => {},
  }
  return { run, fails }
}

const processedSlugs = () => sendQueued.mock.calls.map((c) => (c[1] as Row).event_slug)

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  sweep.mockReset().mockResolvedValue([])
  loadDefinition.mockReset().mockResolvedValue({ def: {} })
  sendQueued.mockReset().mockImplementation(async (_db, _d, _def, _still, tally: Row) => {
    tally.invited = (tally.invited as number) + 1
  })
  sendReminders.mockReset().mockResolvedValue(undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('a run that only reaches Stellr', () => {
  it('processes every open survey in order, records failures as before, and adds no ledger or child row', async () => {
    const { db, calls } = setup([dist('d1', 'a', null), dist('d2', 'b', STELLR), dist('d3', 'c', null)])
    loadDefinition.mockImplementation(async (_db, id) => {
      if (id === 'def' && loadDefinition.mock.calls.length === 2) throw new Error('definition gone')
      return { def: {} }
    })
    sweep.mockRejectedValue(new Error('cms down'))
    const { run, fails } = fakeRun()

    const out = await runSurveys(db, run, { budgetMs: 45_000 })

    expect(processedSlugs()).toEqual(['a', 'c'])
    expect(out.distributions.map((d) => d.slug)).toEqual(['a', 'c'])
    // Same labels and order the route used to record from result.errors.
    expect(fails).toEqual([
      { where: 'sweep', message: 'cms down' },
      { where: 'distribution:b', message: 'definition gone' },
    ])
    expect(out.errors).toEqual(fails)
    expect(out.tenantLedger).toEqual({})
    expect(out.tally.invited).toBe(2)
    expect(calls.filter((c) => c.table === 'cron_runs')).toEqual([])
  })

  it('records nothing from the sweep when the open-surveys read throws, so the route records run alone', async () => {
    const { db } = setup([], { openError: true })
    sweep.mockRejectedValue(new Error('cms down'))
    const { run, fails } = fakeRun()
    await expect(runSurveys(db, run)).rejects.toThrow('Reading open surveys failed: read failed')
    expect(fails).toEqual([])
  })

  it('reads no tenants when no survey is open', async () => {
    const { db, calls } = setup([])
    const { run } = fakeRun()
    const out = await runSurveys(db, run)
    expect(out.tenantLedger).toEqual({})
    expect(calls.some((c) => c.table === 'tenants')).toBe(false)
  })
})

describe('a run with two tenants', () => {
  it("keeps opening, inviting and reminding for one tenant when the other tenant's survey fails", async () => {
    const { db, calls } = setup([dist('d1', 'b-event', TENANT_B), dist('d2', 'a-event', null), dist('d3', 'a-late', STELLR)])
    loadDefinition.mockImplementation(async (_db, _id) => {
      if (loadDefinition.mock.calls.length === 3) throw new Error('tenant b definition unreadable')
      return { def: {} }
    })
    const { run, fails } = fakeRun()

    const out = await runSurveys(db, run)

    // Stellr goes first by default (stellr_first, an open owner decision).
    expect(processedSlugs()).toEqual(['a-event', 'a-late'])
    expect(sendReminders).toHaveBeenCalledTimes(2)
    expect(fails).toEqual([{ where: `t:${TENANT_B}:distribution:b-event`, message: 'tenant b definition unreadable' }])
    const ledger = out.tenantLedger as { tenants: Record<string, Row> }
    expect(ledger.tenants[STELLR]).toMatchObject({ processed: 2, invited: 2, ok: true })
    expect(ledger.tenants[TENANT_B]).toMatchObject({ processed: 0, ok: false })
    const children = calls.filter((c) => c.table === 'cron_runs' && c.op === 'insert').map((c) => (c.payload as Row).tenant_id)
    expect(children).toEqual([STELLR, TENANT_B])
  })

  it('stops a tenant that overran its slice from starting its next survey', async () => {
    const { db } = setup([dist('d1', 'a-slow', null), dist('d2', 'a-next', null), dist('d3', 'b-event', TENANT_B)])
    sendQueued.mockImplementation(async (_db, d: Row) => {
      if (d.event_slug === 'a-slow') await new Promise((r) => setTimeout(r, 250))
    })
    const { run, fails } = fakeRun()
    // The clock reads as standing still, so no deadline check can stop the loop:
    // only the abort signal can. Timers still run in real time.
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 10, 8, 12))

    // Stellr's slice is half of 200 ms, plus 10 ms of overrun; a-slow takes 250.
    const out = await runSurveys(db, run, { budgetMs: 200, slice: { floorMs: 10, overrunMs: 10 } })
    expect(processedSlugs()).toEqual(['a-slow', 'b-event'])
    expect(fails.map((f) => f.where)).toEqual([`t:${STELLR}:slice`])

    // Let a-slow finish in the background: its tenant was aborted, so it does not go on.
    await new Promise((r) => setTimeout(r, 400))
    expect(processedSlugs()).toEqual(['a-slow', 'b-event'])
    expect(out.distributions.map((d) => d.slug)).not.toContain('a-next')
  }, 15_000)
})
