import { describe, it, expect, vi, beforeEach } from 'vitest'

const { rows, sendEventEmail, statusWrites, today, runCatchUps } = vi.hoisted(() => ({
  runCatchUps: vi.fn(async (..._a: unknown[]) => ({ checked: 1, emailed: 4, deferred: 0, errors: [] as { id: string; error: string }[] })),
  rows: [] as { id: string; event_slug: string; schedule_days_before: number }[],
  sendEventEmail: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  statusWrites: [] as { id: string; status: string }[],
  today: { value: '2026-09-28' },
}))

vi.mock('@/lib/cron', () => ({ guardCron: () => null }))
vi.mock('@/lib/cron-runs', () => ({ startCronRun: async () => ({ fail: () => {}, finish: async () => {} }) }))
vi.mock('@/lib/sanity', () => ({ getEventBySlug: async (slug: string) => ({ date: slug === 'past' ? '2026-09-20' : '2026-10-03' }) }))
vi.mock('@/lib/event-emails/send', () => ({ sendEventEmail }))
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
      { id: 'due', event_slug: 'co', schedule_days_before: 5 },    // Oct 3 − 5 = Sep 28 → today
      { id: 'later', event_slug: 'co', schedule_days_before: 2 },  // Oct 1
      { id: 'stale', event_slug: 'past', schedule_days_before: 3 },
    )
    expect(await run()).toMatchObject({ due: 1, sent: 1, skipped: 1, deferred: 0 })
    expect(sendEventEmail).toHaveBeenCalledTimes(1)
    expect(sendEventEmail).toHaveBeenCalledWith(expect.anything(), 'due', { trigger: 'schedule', triggeredBy: 'schedule' })
    expect(statusWrites).toEqual([{ id: 'stale', status: 'skipped' }])
  })

  it('leaves a due email for the next slot once the time budget is spent', async () => {
    rows.push({ id: 'a', event_slug: 'co', schedule_days_before: 7 }, { id: 'b', event_slug: 'co', schedule_days_before: 7 })
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValueOnce(0)          // start
    now.mockReturnValueOnce(1_000)      // before a
    now.mockReturnValue(40_000)         // before b
    expect(await run()).toMatchObject({ due: 2, sent: 1, deferred: 1 })
    now.mockRestore()
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
