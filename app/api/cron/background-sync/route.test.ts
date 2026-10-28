import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review BG-8: this daily sweep is the only thing that re-checks a stuck
// background-check row, yet it recorded nothing and alerted nobody — a revoked
// CHECKR_API_KEY would error every row every day in silence. Every run now lands
// in cron_runs, and a whole-sweep failure raises an admin alert instead of a 200.

const { syncStaleChecks, notify, runs, remindUnclearedAdults, provider } = vi.hoisted(() => ({
  syncStaleChecks: vi.fn(),
  notify: vi.fn(async (_input: { type: string; body: string; referenceType?: string; referenceId?: string }) => {}),
  runs: { fails: [] as string[], finished: [] as Record<string, unknown>[] },
  remindUnclearedAdults: vi.fn(),
  provider: { configured: true },
}))

vi.mock('@/lib/cron', () => ({ guardCron: () => null }))
vi.mock('@/lib/cron-runs', () => ({
  startCronRun: async () => ({
    fail: (where: string) => { runs.fails.push(where) },
    finish: async (r: Record<string, unknown>) => { runs.finished.push(r) },
  }),
}))
vi.mock('@/lib/notify', () => ({ notifyCommunityAdmins: notify }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({}) }))
vi.mock('@/lib/background-provider', () => ({
  getBackgroundProvider: () => ({ name: 'checkr', configured: () => provider.configured }),
}))
vi.mock('@/lib/background-sync', () => ({ syncStaleChecks }))
vi.mock('@/lib/compliance-notify', () => ({ remindUnclearedAdults }))

const reminderResult = (over: Record<string, unknown> = {}) => ({
  dryRun: false, events: 1, eventsUndated: 0, eventsInWindow: 1, uncleared: 1, withStellr: 0,
  alreadySent: 0, due: 1, sent: 1, skipped: 0, failed: 0, deferred: 0, errors: [], ...over,
})

const { GET } = await import('./route')
const call = () => GET(new Request('https://x/api/cron/background-sync') as never)

beforeEach(() => {
  vi.clearAllMocks()
  runs.fails.length = 0
  runs.finished.length = 0
  provider.configured = true
  remindUnclearedAdults.mockResolvedValue(reminderResult())
})

describe('GET /api/cron/background-sync', () => {
  it('alerts admins and records every error when the whole sweep fails', async () => {
    syncStaleChecks.mockResolvedValueOnce({ scanned: 2, updated: 0, unchanged: 0, errors: [{ id: 'a', error: '401' }, { id: 'b', error: '401' }] })
    const res = await call()
    expect(res.status).toBe(200)
    expect(notify).toHaveBeenCalledTimes(1)
    expect((notify.mock.calls[0][0] as { referenceId: string }).referenceId).toBe('background-sync')
    expect(runs.fails).toEqual(['a', 'b'])
    expect(runs.finished[0]).toMatchObject({ scanned: 2, updated: 0, errors: 2 })
  })

  it('does NOT alert when at least one row advanced, but still records the per-row error', async () => {
    syncStaleChecks.mockResolvedValueOnce({ scanned: 2, updated: 1, unchanged: 0, errors: [{ id: 'a', error: '401' }] })
    await call()
    expect(notify).not.toHaveBeenCalled()
    expect(runs.fails).toEqual(['a'])
  })

  it('records a clean run with no alert', async () => {
    syncStaleChecks.mockResolvedValueOnce({ scanned: 1, updated: 1, unchanged: 0, errors: [] })
    await call()
    expect(notify).not.toHaveBeenCalled()
    expect(runs.fails).toEqual([])
    expect(runs.finished[0]).toMatchObject({ updated: 1, errors: 0 })
  })

  it('surfaces a throw as a 500 and a failed run, rather than an opaque crash', async () => {
    syncStaleChecks.mockRejectedValueOnce(new Error('load failed'))
    const res = await call()
    expect(res.status).toBe(500)
    expect(runs.fails).toEqual(['sync'])
    expect(runs.finished).toHaveLength(1)
  })

  // The 14-days-out clearance reminder rides on this daily cron. A teaching
  // license clears someone with no provider involved, so the reminder must not
  // depend on the sync step.
  it('runs the clearance reminders and records their counts', async () => {
    syncStaleChecks.mockResolvedValueOnce({ scanned: 0, updated: 0, unchanged: 0, errors: [] })
    const res = await call()
    expect(remindUnclearedAdults).toHaveBeenCalledTimes(1)
    expect(runs.finished[0]).toMatchObject({ reminders: { sent: 1, due: 1, errors: 0 } })
    expect(await res.json()).toMatchObject({ reminders: { sent: 1 } })
  })

  it('still sends reminders when the background-check provider is not configured', async () => {
    provider.configured = false
    const res = await call()
    expect(res.status).toBe(200)
    expect(syncStaleChecks).not.toHaveBeenCalled()
    expect(remindUnclearedAdults).toHaveBeenCalledTimes(1)
    expect(runs.finished[0]).toMatchObject({ skipped: true, reminders: { sent: 1 } })
  })

  it('still sends reminders when the sync throws', async () => {
    syncStaleChecks.mockRejectedValueOnce(new Error('load failed'))
    const res = await call()
    expect(res.status).toBe(500)
    expect(remindUnclearedAdults).toHaveBeenCalledTimes(1)
  })

  it('records per-notice reminder errors on the run', async () => {
    syncStaleChecks.mockResolvedValueOnce({ scanned: 0, updated: 0, unchanged: 0, errors: [] })
    remindUnclearedAdults.mockResolvedValueOnce(
      reminderResult({ sent: 0, failed: 1, errors: [{ where: 'notice:ev:m1', error: 'resend down' }] }),
    )
    await call()
    expect(runs.fails).toEqual(['reminder:notice:ev:m1'])
  })

  it('records a reminder step that throws without failing the response', async () => {
    syncStaleChecks.mockResolvedValueOnce({ scanned: 0, updated: 0, unchanged: 0, errors: [] })
    remindUnclearedAdults.mockRejectedValueOnce(new Error('registrations: timeout'))
    const res = await call()
    expect(res.status).toBe(200)
    expect(runs.fails).toEqual(['reminders'])
    expect(runs.finished[0]).toMatchObject({ reminders: { error: 'registrations: timeout' } })
  })
})
