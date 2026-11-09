import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { sendEmail, loadMemberDigest, tables, inserted, seededClient } = vi.hoisted(() => ({
  /** When set, supabaseServer() returns this seeded client instead of the stand-in below. */
  seededClient: { current: null as unknown },
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

vi.mock('@/lib/supabase', () => ({ supabaseServer: () => seededClient.current ?? { from: (t: string) => builder(t) } }))
vi.mock('@/lib/email', () => ({ sendEmail, staffAlertEmail: () => 'staff-inbox@example.org' }))
vi.mock('@/lib/admin-digest', () => ({ loadMemberDigest, outstandingCount: () => 4 }))
vi.mock('@/lib/admin-digest-email', () => ({ renderDigestEmail: () => ({ subject: 'Digest', html: '<p/>', text: 'Digest' }) }))

const { GET } = await import('./route')
const { fakeSupabase } = await import('@/test/fake-supabase')
const { STELLR_TENANT_ID } = await import('@/lib/tenancy/constants')
type SupabaseClient = import('@supabase/supabase-js').SupabaseClient

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
  seededClient.current = null
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

// S5 B17: recipients come from lib/authz/audiences (not mocked), on seeded rows
// where every filter runs.
describe('weekly digest recipients (S5 B17)', () => {
  const seed = () => ({
    staff_roles: [
      { member_id: 'm-all', scopes: ['all'] },
      { member_id: 'm-both', scopes: ['all', 'events'] },
      { member_id: 'm-events', scopes: ['events'] },
      // A community-only holder gets admin alerts but not the digest, so a
      // widened digest scope fails the comparison below.
      { member_id: 'm-community', scopes: ['community'] },
      { member_id: 'm-gone', scopes: ['all'] },
      { member_id: 'm-shared', scopes: ['all'] },
      { member_id: null, scopes: ['all'] },
    ],
    members: [
      { id: 'm-all', email: ' Admin@Example.org ', is_active: true },
      { id: 'm-both', email: 'coadmin@example.org', is_active: true },
      { id: 'm-events', email: 'events@example.org', is_active: true },
      { id: 'm-community', email: 'community@example.org', is_active: true },
      { id: 'm-gone', email: 'gone@example.org', is_active: false },
      { id: 'm-shared', email: 'ADMIN@example.org', is_active: true },
      { id: 'm-tenant', email: 'tenant-admin@example.org', is_active: true },
    ],
    tenant_memberships: [
      { tenant_id: STELLR_TENANT_ID, member_id: 'm-tenant', clerk_user_id: null, role: 'tenant_admin' },
      { tenant_id: '11111111-1111-4111-8111-111111111111', member_id: 'm-tenant', clerk_user_id: null, role: 'tenant_admin' },
    ],
  })

  /** The recipient query the route ran before B17, on the same rows. */
  async function before(db: SupabaseClient): Promise<string[]> {
    const { data: roles } = await db.from('staff_roles').select('member_id').overlaps('scopes', ['all'])
    const ids = [...new Set((roles ?? []).map((r) => r.member_id as string).filter(Boolean))]
    const { data: members } = await db.from('members').select('email').in('id', ids).eq('is_active', true)
    return [...new Set((members ?? []).map((m) => (m.email as string | null)?.trim().toLowerCase()).filter((e): e is string => !!e))].sort()
  }

  it("sends to the same addresses as before, under the default AUTHZ_SOURCE", async () => {
    vi.stubEnv('AUTHZ_SOURCE', '')
    const fake = fakeSupabase(seed())
    seededClient.current = fake.client
    const expected = await before(fake.client as unknown as SupabaseClient)
    const body = await (await call()).json()
    expect(expected).toEqual(['admin@example.org', 'coadmin@example.org'])
    expect(sendEmail.mock.calls.map(([o]) => o.to).sort()).toEqual(expected)
    expect(body).toMatchObject({ sent: true, recipients: 2, delivered: 2, fallback: false })
  })

  it('falls back to the staff inbox, and records the failure, when staff_roles cannot be read', async () => {
    const fake = fakeSupabase(seed(), { failOn: (t) => (t === 'staff_roles' ? 'boom' : null) })
    seededClient.current = fake.client
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const body = await (await call()).json()
    errorSpy.mockRestore()
    expect(body).toMatchObject({ sent: true, recipients: 1, fallback: true })
    expect(sendEmail.mock.calls.map(([o]) => o.to)).toEqual(['staff-inbox@example.org'])
    const run = fake.table('cron_runs')[0] as { errors: { step: string }[] }
    expect(JSON.stringify(run.errors)).toContain('recipients')
  })
})
