import { describe, it, expect, vi, beforeEach } from 'vitest'

// The daily reconciliation must fit inside the cron's 60 s. From 13 to 21 Oct
// 2026 every run was killed part-way (110 prospects at ~1.3 s each), so none
// finished, nothing alerted and most prospects were never reached. These pin
// the fix's wiring: a deadline inside the budget, a cursor read from the last
// finished run, and that cursor carried forward whatever happens.

const { lastCronResult, finish, fail, fetchEngagedProspects, reconcileProspects, sendEmail } = vi.hoisted(() => ({
  lastCronResult: vi.fn(),
  finish: vi.fn(async () => {}),
  fail: vi.fn(),
  fetchEngagedProspects: vi.fn(),
  reconcileProspects: vi.fn(),
  sendEmail: vi.fn(async () => ({ ok: true })),
}))

vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({}) }))
vi.mock('@/lib/cron-runs', () => ({
  lastCronResult,
  startCronRun: async () => ({ fail, finish }),
}))
vi.mock('@/lib/email', () => ({ sendEmail, staffAlertEmail: () => 'alerts@example.org' }))
vi.mock('@/lib/apollo-reconcile', () => ({ fetchEngagedProspects, reconcileProspects }))

const { GET } = await import('./route')

const call = () =>
  GET(
    new Request('https://www.stellreducation.org/api/cron/apollo-reconcile', {
      headers: { authorization: 'Bearer test-secret' },
    }) as never,
  )

function result(overrides: Record<string, unknown> = {}) {
  return {
    considered: 30,
    total: 110,
    truncated: false,
    stoppedEarly: true,
    windowOffset: 40,
    nextOffset: 70,
    created: 0,
    advanced: 0,
    skipped: 30,
    companiesCreated: 0,
    failed: 0,
    changes: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'prod')
  vi.stubEnv('CRON_SECRET', 'test-secret')
  vi.stubEnv('APOLLO_API_KEY', 'apollo-key')
  vi.clearAllMocks()
  lastCronResult.mockResolvedValue({ nextOffset: 40 })
  fetchEngagedProspects.mockResolvedValue([])
  reconcileProspects.mockResolvedValue(result())
})

describe('GET /api/cron/apollo-reconcile', () => {
  it('resumes at the last finished run’s nextOffset, under a deadline inside the 60 s', async () => {
    const before = Date.now()
    const res = await call()
    expect(res.status).toBe(200)

    const opts = reconcileProspects.mock.calls[0][1] as { offset: number; deadline: number; apply: boolean }
    expect(opts.apply).toBe(true)
    expect(opts.offset).toBe(40)
    // Leaves room for the prospect in flight, the alert and the ledger write.
    expect(opts.deadline - before).toBeLessThanOrEqual(45_000)
    expect(opts.deadline - before).toBeGreaterThan(0)
  })

  it('records the run as finished with the cursor for the next one', async () => {
    await call()
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ nextOffset: 70, stoppedEarly: true }))
    // An early stop at today's size is normal: recorded, not mailed daily.
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('starts at 0 when no run has finished yet', async () => {
    lastCronResult.mockResolvedValue(null)
    await call()
    expect((reconcileProspects.mock.calls[0][1] as { offset: number }).offset).toBe(0)
  })

  it('names the resume point in the alert when a run repairs deals', async () => {
    reconcileProspects.mockResolvedValue(
      result({ created: 1, changes: [{ email: 'alex@school.org', engagement: 'replied', action: 'create', dealId: 'd1' }] }),
    )
    await call()
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const [mail] = sendEmail.mock.calls[0] as unknown as [{ text: string }]
    expect(mail.text).toContain('resumes at index 70')
  })

  it('keeps the cursor when the run fails, instead of resetting it to 0', async () => {
    fetchEngagedProspects.mockRejectedValue(new Error('Apollo rate-limited (429) after 3 attempts'))
    const res = await call()
    expect(res.status).toBe(500)
    expect(fail).toHaveBeenCalledWith('run', expect.any(Error))
    expect(finish).toHaveBeenCalledWith({ nextOffset: 40 })
  })
})
