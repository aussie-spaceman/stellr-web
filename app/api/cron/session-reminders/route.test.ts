// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review QUAL-6: a transient read error must FAIL the cron run (recorded,
// retried; sends are idempotent) rather than silently reporting `sent: 0` and
// leaving cron_runs looking healthy while nobody was reminded.

const h = vi.hoisted(() => ({ fail: false, sessions: [] as unknown[] }))

vi.mock('@/lib/cron', () => ({ guardCron: () => null }))
vi.mock('@/lib/notify', () => ({ notifyMember: vi.fn(async () => {}) }))
vi.mock('@/lib/utils', () => ({ formatDateTime: () => 'soon' }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        gte: () => chain,
        lte: () => chain,
        insert: async () => ({ error: null }),
        then: (res: (v: unknown) => unknown) => {
          if (table === 'sessions' && h.fail) {
            return Promise.resolve({ data: null, error: { message: 'timeout' } }).then(res)
          }
          if (table === 'sessions') return Promise.resolve({ data: h.sessions, error: null }).then(res)
          return Promise.resolve({ data: [], error: null }).then(res)
        },
      }
      return chain
    },
  }),
}))

const { GET } = await import('./route')
const req = () => new Request('https://app.test/api/cron/session-reminders') as unknown as Parameters<typeof GET>[0]

beforeEach(() => { h.fail = false; h.sessions = [] })

describe('GET /api/cron/session-reminders', () => {
  it('reports sent:0 when there is nothing to do', async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sent: 0 })
  })

  it('fails closed (500, not sent:0) when the sessions read errors', async () => {
    // QUAL-6 + INT-9 merged: the throwing read is caught so the cron run is
    // recorded as failed (run.fail) and a 500 is returned — NOT a silent sent:0.
    h.fail = true
    const res = await GET(req())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).not.toEqual({ sent: 0 })
    expect(body.error).toMatch(/timeout/)
  })
})
