import { describe, it, expect, vi, beforeEach } from 'vitest'

const { rows, sendEventEmail, reclaimStuckSending, statusWrites, today, runCatchUps } = vi.hoisted(() => ({
  runCatchUps: vi.fn(async (..._a: unknown[]) => ({ checked: 1, emailed: 4, deferred: 0, errors: [] as { id: string; error: string }[] })),
  // S5 B14: the cron selects tenant_id to run per tenant. NULL is Stellr's.
  rows: [] as { id: string; event_slug: string; schedule_days_before: number; tenant_id: string | null }[],
  sendEventEmail: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  // deep review INT-1: the cron now re-drives stale 'sending' rows.
  reclaimStuckSending: vi.fn(async (..._a: unknown[]) => ({ reclaimed: 0, errors: [] as { id: string; error: string }[] })),
  statusWrites: [] as { id: string; status: string }[],
  today: { value: '2026-09-28' },
}))

vi.mock('@/lib/cron', () => ({ guardCron: () => null }))
vi.mock('@/lib/cron-runs', () => ({ startCronRun: async () => ({ fail: () => {}, finish: async () => {} }) }))
vi.mock('@/lib/sanity', () => ({ getEventBySlug: async (slug: string) => ({ date: slug === 'past' ? '2026-09-20' : '2026-10-03' }) }))
vi.mock('@/lib/event-emails/send', () => ({ sendEventEmail, reclaimStuckSending }))
vi.mock('@/lib/event-emails/render', () => ({ todayInMountain: () => today.value }))
vi.mock('@/lib/event-emails/catch-up', () => ({ runCatchUps }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: () => {
      let id = ''
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, v: string) => { if (col === 'id') id = v; return chain },
        not: () => chain,
        in: () => chain,
        order: async () => ({ data: rows, error: null }),
        update: (values: { status: string }) => {
          const upd = { eq: (col: string, v: string) => { if (col === 'id') statusWrites.push({ id: v, status: values.status }); return upd } }
          return upd
        },
      }
      void id
      return chain
    },
  }),
}))

const { GET } = await import('./route')
const run = async () => (await GET(new Request('https://x/api/cron/event-emails') as never)).json()

beforeEach(() => {
  vi.clearAllMocks()
  rows.length = 0
  statusWrites.length = 0
})

describe('GET /api/cron/event-emails', () => {
  it('sends what is due, waits on the rest, skips a passed event', async () => {
    rows.push(
      { id: 'due', event_slug: 'co', schedule_days_before: 5, tenant_id: null },    // Oct 3 − 5 = Sep 28 → today
      { id: 'later', event_slug: 'co', schedule_days_before: 2, tenant_id: null },  // Oct 1
      { id: 'stale', event_slug: 'past', schedule_days_before: 3, tenant_id: null },
    )
    expect(await run()).toMatchObject({ due: 1, sent: 1, skipped: 1, deferred: 0 })
    expect(sendEventEmail).toHaveBeenCalledTimes(1)
    expect(sendEventEmail).toHaveBeenCalledWith(expect.anything(), 'due', { trigger: 'schedule', triggeredBy: 'schedule' })
    expect(statusWrites).toEqual([{ id: 'stale', status: 'skipped' }])
  })

  it('leaves a due email for the next slot once the time budget is spent', async () => {
    rows.push({ id: 'a', event_slug: 'co', schedule_days_before: 7, tenant_id: null }, { id: 'b', event_slug: 'co', schedule_days_before: 7, tenant_id: null })
    // The clock stands at the start until the first send, which takes 40 s.
    // (S5 B14: the per-tenant runner reads the clock too, so a fixed sequence
    // of readings no longer says which one is "before b".)
    let clock = 0
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    sendEventEmail.mockImplementationOnce(async () => { clock = 40_000; return { ok: true } })
    expect(await run()).toMatchObject({ due: 2, sent: 1, deferred: 1 })
    expect(sendEventEmail).toHaveBeenCalledTimes(1)
    now.mockRestore()
  })

  it('re-drives stale sends abandoned in "sending" and reports the count', async () => {
    reclaimStuckSending.mockResolvedValueOnce({ reclaimed: 2, errors: [] })
    expect(await run()).toMatchObject({ resumed: 2 })
    expect(reclaimStuckSending).toHaveBeenCalledTimes(1)
  })

  it('catches up late registrants after the scheduled sends, sharing the event-date lookup', async () => {
    expect(await run()).toMatchObject({ catchUpEmailed: 4, catchUpDeferred: 0 })
    expect(runCatchUps).toHaveBeenCalledTimes(1)
    const [, eventDate, budgetLeft, day] = runCatchUps.mock.calls[0] as [unknown, (s: string) => Promise<string | null>, () => boolean, string]
    expect(await eventDate('co')).toBe('2026-10-03')
    expect(budgetLeft()).toBe(true)
    expect(day).toBe('2026-09-28')
  })
})
