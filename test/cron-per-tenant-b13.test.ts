// @vitest-environment node
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CRON_SCOPES } from '@/lib/cron-scope'
import { TABLE_REGISTRY } from '@/lib/tenancy/registry'
import { fakeChainDb, runnerAnswer, type ChainCall, type Row } from '@/test/helpers/fake-chain-db'

// S5 B13: the surveys, team-profiles and survey-retention crons run per tenant.
// These check the contract around them: retention deletes nothing without its
// switch, a Stellr-only run writes the same result as before, and each cron's
// code matches its lib/cron-scope.ts entry.

const h = vi.hoisted(() => ({ db: null as unknown, finished: [] as Row[], fails: [] as Row[] }))
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: () => {},
}))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => h.db }))
vi.mock('@/lib/cron-runs', () => ({
  startCronRun: async () => ({
    id: 'parent-1',
    fail: (where: string, err: unknown) => h.fails.push({ where, message: err instanceof Error ? err.message : String(err) }),
    finish: async (result: Row) => {
      h.finished.push(result)
    },
  }),
  startTenantRun: async () => ({ id: 'child', fail: () => {}, finish: async () => {} }),
}))

const SECRET = 'test-cron-secret'
const authed = () => new Request('https://example.test/api/cron/survey-retention', { headers: { authorization: `Bearer ${SECRET}` } }) as never

async function loadRetentionRoute(apply: boolean) {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'prod')
  vi.stubEnv('CRON_SECRET', SECRET)
  vi.stubEnv('PLATFORM_AUDIT_ENABLED', '')
  vi.stubEnv('SURVEY_RETENTION_APPLY', apply ? 'true' : '')
  return import('@/app/api/cron/survey-retention/route')
}

/** One participant surveyed in 2010, with no account: due since 2018. */
function retentionDb() {
  const tables: Record<string, Row[]> = {
    survey_invitations: [{ id: 'i1', distribution_id: 'd1', member_id: null, participant_id: 'p1', email: 'parent@example.org', send_via: 'guardian' }],
    survey_responses: [],
    survey_distributions: [{ id: 'd1', event_date: '2010-05-01', tenant_id: null }],
    participants: [{ id: 'p1', member_id: null }],
    members: [],
  }
  return fakeChainDb(
    (call: ChainCall) => runnerAnswer(call, []) ?? { data: tables[call.table] ?? [], error: null },
    () => ({ data: { responses: 0, invitations: 1 }, error: null }),
  )
}

beforeEach(() => {
  h.finished = []
  h.fails = []
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('survey-retention', () => {
  it('deletes nothing without SURVEY_RETENTION_APPLY, and writes the report alone', async () => {
    const fake = retentionDb()
    h.db = fake.db
    const { GET } = await loadRetentionRoute(false)
    const res = await GET(authed())
    expect(res.status).toBe(200)
    expect(fake.rpcCalls).toEqual([])
    expect(fake.calls.some((c) => c.table === 'tenants')).toBe(false)
    expect(Object.keys(h.finished[0]).sort()).toEqual(['apply', 'due', 'dueList', 'emailsHeld', 'inactiveWithoutDate', 'waiting'])
    expect(h.finished[0].due).toEqual({ subjects: 1, invitations: 1, responses: 0 })
  })

  it('with the switch on and only Stellr due, writes the same result keys as before: no ledger, no notApplied', async () => {
    const fake = retentionDb()
    h.db = fake.db
    const { GET } = await loadRetentionRoute(true)
    const res = await GET(authed())
    expect(res.status).toBe(200)
    expect(fake.rpcCalls.map((c) => c.fn)).toEqual(['survey_purge_person'])
    expect(Object.keys(h.finished[0]).sort()).toEqual(['apply', 'deleted', 'due', 'dueList', 'emailsHeld', 'inactiveWithoutDate', 'waiting'])
    expect(h.finished[0].deleted).toEqual({ people: 1, responses: 0, invitations: 1 })
    expect(h.fails).toEqual([])
  })
})

describe('the B13 crons match lib/cron-scope.ts', () => {
  const read = (path: string) => readFileSync(path, 'utf8')
  const B13 = {
    surveys: 'lib/survey/run.ts',
    'team-profiles': 'lib/team-profile/store.ts',
    'survey-retention': 'lib/survey/retention.ts',
  } as const

  it.each(Object.entries(B13))('%s is per_tenant and runs through runPerTenant', (job, lib) => {
    expect(CRON_SCOPES[job].scope).toBe('per_tenant')
    expect(read(lib)).toMatch(/runPerTenant[<(]/)
    expect(read(lib)).toContain(`job: '${job}'`)
    // Fairness stays the runner's default (stellr_first) until the owner decides.
    expect(read(lib)).not.toMatch(/fairness:/)
  })

  it.each(Object.entries(B13))('%s passes includeInactive exactly when cron-scope says inactive tenants run', (job, lib) => {
    expect(read(lib).includes('includeInactive: true')).toBe(CRON_SCOPES[job].inactiveTenants === 'run')
  })

  it('partitions only on tables that carry their own tenant_id on production (S4), not via a parent', () => {
    for (const table of ['registrations', 'survey_distributions', 'survey_responses']) {
      expect(TABLE_REGISTRY[`public.${table}`].tenantColumn).toBe('derived')
    }
    // participants and survey_invitations gain their own column only with C0b.
    expect(read('lib/team-profile/store.ts')).toContain('registrations!inner(event_slug, status, tenant_id)')
    expect(read('lib/survey/retention.ts')).not.toMatch(/survey_invitations'\)\.select\('[^']*tenant_id/)
  })
})
