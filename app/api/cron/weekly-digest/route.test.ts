import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { sendEmail, loadMemberDigest, tables, inserted } = vi.hoisted(() => ({
  sendEmail: vi.fn(),
  loadMemberDigest: vi.fn(),
  /** Rows each table returns, keyed by table name. */
  tables: {} as Record<string, unknown[]>,
  inserted: [] as Array<{ table: string; row: unknown }>,
}))

// A chainable, awaitable stand-in for the supabase-js builder: every filter
// returns the builder, and awaiting it yields the table's configured rows.
function builder(table: string) {
  const result = () => ({ data: tables[table] ?? [], error: null })
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'gte', 'overlaps', 'limit', 'order', 'update']) b[m] = () => b
  b.insert = (row: unknown) => {
    inserted.push({ table, row })
    return { select: () => ({ single: async () => ({ data: { id: 'run1' }, error: null }) }) }
  }
  b.then = (resolve: (v: unknown) => unknown) => resolve(result())
  return b
}

vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ from: (t: string) => builder(t) }) }))
vi.mock('@/lib/email', () => ({ sendEmail, staffAlertEmail: () => 'staff-inbox@example.org' }))
vi.mock('@/lib/admin-digest', () => ({ loadMemberDigest, outstandingCount: () => 4 }))
vi.mock('@/lib/admin-digest-email', () => ({ renderDigestEmail: () => ({ subject: 'Digest', html: '<p/>', text: 'Digest' }) }))

const { GET } = await import('./route')

const call = () => GET(new Request('https://app.example.org/api/cron/weekly-digest', {
  headers: { authorization: 'Bearer test-secret' },
}) as never)

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'prod')
  vi.stubEnv('CRON_SECRET', 'test-secret')
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-30T18:20:00Z')) // Friday, 12:20 MDT
  sendEmail.mockReset().mockResolvedValue({ id: 'e1' })
  loadMemberDigest.mockReset().mockResolvedValue({ growth: { newMembers: { current: 2 } }, outstanding: {}, errors: [] })
  for (const k of Object.keys(tables)) delete tables[k]
  inserted.length = 0
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('GET /api/cron/weekly-digest', () => {
  it('sends to every active member holding the all scope, and records the run', async () => {
    tables.staff_roles = [{ member_id: 'a' }, { member_id: 'b' }]
    tables.members = [{ email: 'Admin@Example.org' }, { email: 'coadmin@example.org' }]
    const res = await call()
    const body = await res.json()
    expect(body).toMatchObject({ sent: true, recipients: 2, delivered: 2, fallback: false, outstanding: 4 })
    expect(sendEmail.mock.calls.map(([o]) => o.to)).toEqual(['admin@example.org', 'coadmin@example.org'])
    expect(loadMemberDigest).toHaveBeenCalledWith(7, expect.objectContaining({ now: expect.any(Date) }))
    expect(inserted).toEqual([{ table: 'cron_runs', row: { job: 'weekly-digest' } }])
  })

  it('falls back to the staff inbox when nobody holds the all scope', async () => {
    tables.staff_roles = []
    const body = await (await call()).json()
    expect(body).toMatchObject({ sent: true, fallback: true })
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'staff-inbox@example.org' }))
  })

  it('does nothing, and records nothing, from the run outside Denver’s noon hour', async () => {
    vi.setSystemTime(new Date('2026-10-30T19:20:00Z')) // 13:20 MDT
    const body = await (await call()).json()
    expect(body).toEqual({ skipped: true, reason: 'not Friday midday in Denver' })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(inserted).toEqual([])
  })

  it('does not send twice when a run already sent today', async () => {
    tables.cron_runs = [{ id: 'earlier' }]
    const body = await (await call()).json()
    expect(body).toEqual({ skipped: true, reason: 'already sent today' })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('refuses a caller without the cron secret', async () => {
    const res = await GET(new Request('https://app.example.org/api/cron/weekly-digest') as never)
    expect(res.status).toBe(401)
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
