// @vitest-environment node
//
// The 'events-config' area (S5 C18) on its three paths, through the real lib/tenancy/area-switch
// and lib/tenancy/db with a driver that answers as Postgres does for the pin. The supabase-js
// client is a recording stand-in: "service keeps today's query" is a claim about the query.
// test/integration/two-tenant/events-config.int.test.ts runs the same functions on a real
// database in CI's tenant-db job.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const appErrors = vi.hoisted(() => ({ recordBuiltAppError: vi.fn(async (..._a: unknown[]) => true) }))
vi.mock('@/lib/app-errors', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  recordBuiltAppError: appErrors.recordBuiltAppError,
}))
const afterResponse = vi.hoisted(() => ({
  tasks: [] as (() => Promise<unknown>)[],
  async flush() {
    for (const t of this.tasks.splice(0)) await t()
  },
}))
vi.mock('@/lib/after-response', () => ({
  runAfterResponse: (_label: string, task: () => Promise<unknown>) => {
    afterResponse.tasks.push(task)
  },
}))

import type { SupabaseClient } from '@supabase/supabase-js'
import { resetAreaSwitchState, TENANT_DB_AREAS_ENV } from '@/lib/tenancy/area-switch'
import { READ_ONLY_CHECK_SQL, READ_ONLY_SQL, setTenantDbDriver, TENANT_DB_FLAG, type TenantSqlDriver } from '@/lib/tenancy/db'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { EventConfigReadError, loadEventCompanies, renameEventCompany, setEventCompanyCount } from './admin-config'

const SLUG = 'nevada-sdc'
const C1 = '11111111-1111-4111-8111-111111111111'
const C2 = '22222222-2222-4222-8222-222222222222'
const TENANT = 'c0ffee00-0000-4000-8000-0000000000b2'

// ── The service-role client ─────────────────────────────────────────────────

interface Call {
  table: string
  op: string
  select?: string
  payload?: unknown
  options?: unknown
  filters: [string, string, unknown][]
  order?: string
}

function fakeSupabase(opts: { rows?: unknown[]; error?: unknown; failOp?: string } = {}) {
  const calls: Call[] = []
  const client = {
    from(table: string) {
      const c: Call = { table, op: 'select', filters: [] }
      calls.push(c)
      const result = () =>
        c.op === 'select'
          ? { data: opts.error ? null : (opts.rows ?? []), error: opts.error ?? null }
          : { data: null, error: opts.failOp === `${table}.${c.op}` ? { code: 'XX000', message: 'down' } : null }
      const chain: Record<string, unknown> = {
        select: (s: string) => ((c.select = s), chain),
        eq: (k: string, v: unknown) => (c.filters.push(['eq', k, v]), chain),
        gt: (k: string, v: unknown) => (c.filters.push(['gt', k, v]), chain),
        order: (k: string) => ((c.order = k), chain),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      }
      for (const op of ['upsert', 'update', 'delete', 'insert']) {
        chain[op] = (payload?: unknown, options?: unknown) => {
          c.op = op
          c.payload = payload
          c.options = options
          return chain
        }
      }
      return chain
    },
  }
  return { db: client as unknown as SupabaseClient, calls }
}

// ── The tenant driver ───────────────────────────────────────────────────────

/** Behaves as Postgres does for the pin and READ ONLY; `answer` gives the caller statements' rows or throws. */
function pgLikeDriver(answer: (text: string, values: readonly unknown[]) => unknown[] = () => []) {
  const sent: { text: string; values: readonly unknown[]; tenant: unknown; readOnly: boolean }[] = []
  let transactions = 0
  const driver: TenantSqlDriver = {
    async transaction(fn) {
      transactions++
      let tenant: unknown = null
      let readOnly = false
      return fn({
        async query(text, values = []) {
          if (text === READ_ONLY_SQL) {
            readOnly = true
            return { rows: [], rowCount: 0 }
          }
          if (text === READ_ONLY_CHECK_SQL) return { rows: [{ read_only: readOnly ? 'on' : 'off' } as never], rowCount: 1 }
          if (text.includes('set_config')) {
            tenant = values[0]
            return { rows: [], rowCount: 0 }
          }
          if (text.startsWith('SET LOCAL ROLE')) return { rows: [], rowCount: 0 }
          if (text.includes('current_user AS role')) return { rows: [{ role: 'tenant_app', tenant } as never], rowCount: 1 }
          sent.push({ text, values, tenant, readOnly })
          if (readOnly && /^\s*(?:insert|update|delete)\b/i.test(text)) {
            throw Object.assign(new Error('read-only'), { code: '25006' })
          }
          const rows = answer(text, values)
          return { rows: rows as never[], rowCount: rows.length }
        },
      })
    },
  }
  return { driver, sent, transactions: () => transactions }
}

const COMPANY_ROWS = [
  { id: C1, number: 1, name: 'Apollo', participants: [{ count: 4 }] },
  { id: C2, number: 2, name: null, participants: [{ count: 0 }] },
]

const flags = (areas?: string) => {
  vi.stubEnv(TENANT_DB_FLAG, 'true')
  if (areas !== undefined) vi.stubEnv(TENANT_DB_AREAS_ENV, areas)
}

beforeEach(() => {
  resetAreaSwitchState()
  setTenantDbDriver(null)
  appErrors.recordBuiltAppError.mockClear()
  afterResponse.tasks.length = 0
  vi.stubEnv(TENANT_DB_FLAG, '')
  vi.stubEnv(TENANT_DB_AREAS_ENV, '')
  vi.stubEnv('TENANT_DATABASE_URL', '')
})
afterEach(() => {
  setTenantDbDriver(null)
  vi.unstubAllEnvs()
})

describe('service: the default', () => {
  it("with no flags, today's query answers and no tenant transaction is opened", async () => {
    const pg = pgLikeDriver()
    setTenantDbDriver(pg.driver)
    const { db, calls } = fakeSupabase({ rows: COMPANY_ROWS })
    expect(await loadEventCompanies(db, STELLR_TENANT_ID, SLUG)).toEqual(COMPANY_ROWS)
    expect(calls).toEqual([
      { table: 'event_companies', op: 'select', select: 'id, number, name, participants(count)', filters: [['eq', 'event_slug', SLUG]], order: 'number' },
    ])
    expect(pg.transactions()).toBe(0)
    expect(afterResponse.tasks).toEqual([])
  })

  it('with the flag on but the area not listed, still service, and nothing connects', async () => {
    flags('')
    const pg = pgLikeDriver()
    setTenantDbDriver(pg.driver)
    const { db } = fakeSupabase({ rows: COMPANY_ROWS })
    expect(await loadEventCompanies(db, STELLR_TENANT_ID, SLUG)).toEqual(COMPANY_ROWS)
    expect(pg.transactions()).toBe(0)
  })

  it('with the area listed but the flag off, still service', async () => {
    vi.stubEnv(TENANT_DB_AREAS_ENV, 'events-config:tenant')
    const pg = pgLikeDriver()
    setTenantDbDriver(pg.driver)
    const { db } = fakeSupabase({ rows: COMPANY_ROWS })
    expect(await loadEventCompanies(db, STELLR_TENANT_ID, SLUG)).toEqual(COMPANY_ROWS)
    expect(pg.transactions()).toBe(0)
  })

  it('a failed read throws EventConfigReadError, which the route answers as its 500', async () => {
    const { db } = fakeSupabase({ error: { code: 'XX000', message: 'down' } })
    await expect(loadEventCompanies(db, STELLR_TENANT_ID, SLUG)).rejects.toBeInstanceOf(EventConfigReadError)
  })

  it("PUT's count: today's three statements, in order, and nothing through tenantDb", async () => {
    const pg = pgLikeDriver()
    setTenantDbDriver(pg.driver)
    const { db, calls } = fakeSupabase()
    expect(await setEventCompanyCount(db, STELLR_TENANT_ID, SLUG, 2)).toBe(true)
    expect(calls).toEqual([
      {
        table: 'event_companies',
        op: 'upsert',
        payload: [
          { event_slug: SLUG, number: 1 },
          { event_slug: SLUG, number: 2 },
        ],
        options: { onConflict: 'event_slug,number', ignoreDuplicates: true },
        filters: [],
      },
      { table: 'event_companies', op: 'delete', filters: [['eq', 'event_slug', SLUG], ['gt', 'number', 2]] },
      { table: 'event_settings', op: 'upsert', payload: { event_slug: SLUG, company_count: 2 }, options: { onConflict: 'event_slug' }, filters: [] },
    ])
    expect(pg.transactions()).toBe(0)
  })

  it("PUT's count: a failed company write is false; a failed settings write is ignored, as today", async () => {
    expect(await setEventCompanyCount(fakeSupabase({ failOp: 'event_companies.upsert' }).db, STELLR_TENANT_ID, SLUG, 2)).toBe(false)
    expect(await setEventCompanyCount(fakeSupabase({ failOp: 'event_companies.delete' }).db, STELLR_TENANT_ID, SLUG, 2)).toBe(false)
    expect(await setEventCompanyCount(fakeSupabase({ failOp: 'event_settings.upsert' }).db, STELLR_TENANT_ID, SLUG, 2)).toBe(true)
  })

  it("rename: today's update, by id inside the event", async () => {
    const { db, calls } = fakeSupabase()
    expect(await renameEventCompany(db, STELLR_TENANT_ID, SLUG, C1, 'Apollo')).toBe(true)
    expect(calls).toEqual([{ table: 'event_companies', op: 'update', payload: { name: 'Apollo' }, filters: [['eq', 'id', C1], ['eq', 'event_slug', SLUG]] }])
    expect(await renameEventCompany(fakeSupabase({ failOp: 'event_companies.update' }).db, STELLR_TENANT_ID, SLUG, C1, 'A')).toBe(false)
  })
})

describe('tenant: events-config:tenant', () => {
  const tenantRows = () => [
    { id: C1, number: 1, name: 'Apollo', participants: [{ count: 4 }] },
    // A driver that hands json back as text still reads the same.
    { id: C2, number: 2, name: null, participants: '[{"count":0}]' },
  ]

  it('reads through tenantDb pinned to the caller’s tenant, with the slug bound, and never calls the service client', async () => {
    flags('events-config:tenant')
    const pg = pgLikeDriver((text) => (/FROM public\.event_companies/.test(text) ? tenantRows() : []))
    setTenantDbDriver(pg.driver)
    const { db, calls } = fakeSupabase({ rows: [] })
    expect(await loadEventCompanies(db, TENANT, SLUG)).toEqual(COMPANY_ROWS)
    expect(calls).toEqual([])
    expect(pg.sent).toHaveLength(1)
    expect(pg.sent[0]).toMatchObject({ values: [SLUG], tenant: TENANT, readOnly: false })
    expect(pg.sent[0].text).toMatch(/WHERE c\.event_slug = \$1\s+ORDER BY c\.number/)
  })

  it('fails closed without a tenant: no read on either path', async () => {
    flags('events-config:tenant')
    const pg = pgLikeDriver()
    setTenantDbDriver(pg.driver)
    const { db, calls } = fakeSupabase()
    await expect(loadEventCompanies(db, '', SLUG)).rejects.toThrow(/tenant id/)
    await expect(setEventCompanyCount(db, 'not-a-uuid', SLUG, 2)).rejects.toThrow(/tenant id/)
    expect(calls).toEqual([])
    expect(pg.transactions()).toBe(0)
  })

  it('a read the database refuses is the request’s failure: no fallback to the service read', async () => {
    flags('events-config:tenant')
    setTenantDbDriver(
      pgLikeDriver(() => {
        throw Object.assign(new Error('permission denied'), { code: '42501' })
      }).driver,
    )
    const { db, calls } = fakeSupabase({ rows: COMPANY_ROWS })
    await expect(loadEventCompanies(db, TENANT, SLUG)).rejects.toMatchObject({ code: '42501' })
    expect(calls).toEqual([])
  })

  it('PUT’s count: one transaction for the companies, then the settings row, all bound', async () => {
    flags('events-config:tenant')
    const pg = pgLikeDriver()
    setTenantDbDriver(pg.driver)
    const { db, calls } = fakeSupabase()
    expect(await setEventCompanyCount(db, TENANT, SLUG, 3)).toBe(true)
    expect(calls).toEqual([])
    expect(pg.transactions()).toBe(2)
    expect(pg.sent.map((s) => s.text.trim().split(/\s+/).slice(0, 3).join(' '))).toEqual([
      'INSERT INTO public.event_companies',
      'DELETE FROM public.event_companies',
      'INSERT INTO public.event_settings',
    ])
    expect(pg.sent.map((s) => s.values)).toEqual([[SLUG, 3], [SLUG, 3], [SLUG, 3]])
    expect(pg.sent.every((s) => s.tenant === TENANT)).toBe(true)
  })

  it('PUT’s count: a refused company write is false, and the settings row is not attempted', async () => {
    flags('events-config:tenant')
    const pg = pgLikeDriver((text) => {
      if (/INSERT INTO public\.event_companies/.test(text)) throw Object.assign(new Error('new row violates row-level security policy'), { code: '42501' })
      return []
    })
    setTenantDbDriver(pg.driver)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await setEventCompanyCount(fakeSupabase().db, TENANT, SLUG, 3)).toBe(false)
    expect(pg.sent.map((s) => s.text)).toHaveLength(1)
    // The log names the SQLSTATE, never the message.
    expect(error.mock.calls.flat().join(' ')).not.toMatch(/row-level security/)
    error.mockRestore()
  })

  it('PUT’s count: a failed settings write is ignored, as on the service path', async () => {
    flags('events-config:tenant')
    setTenantDbDriver(
      pgLikeDriver((text) => {
        if (/event_settings/.test(text)) throw Object.assign(new Error('x'), { code: '23514' })
        return []
      }).driver,
    )
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await setEventCompanyCount(fakeSupabase().db, TENANT, SLUG, 3)).toBe(true)
    error.mockRestore()
  })

  it('rename: one bound UPDATE by id and slug; a refusal is false', async () => {
    flags('events-config:tenant')
    const pg = pgLikeDriver()
    setTenantDbDriver(pg.driver)
    expect(await renameEventCompany(fakeSupabase().db, TENANT, SLUG, C1, 'Apollo')).toBe(true)
    expect(pg.sent).toHaveLength(1)
    expect(pg.sent[0].values).toEqual(['Apollo', C1, SLUG])
    expect(pg.sent[0].text).toMatch(/^\s*UPDATE public\.event_companies SET name = \$1\s+WHERE id = \$2::uuid AND event_slug = \$3$/)

    setTenantDbDriver(
      pgLikeDriver(() => {
        throw Object.assign(new Error('x'), { code: '22P02' })
      }).driver,
    )
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await renameEventCompany(fakeSupabase().db, TENANT, SLUG, 'junk', 'A')).toBe(false)
    error.mockRestore()
  })
})

describe('shadow: events-config:shadow', () => {
  it('the service read answers; the tenantDb read runs after the response, read-only, and a match records nothing', async () => {
    flags('events-config:shadow')
    const pg = pgLikeDriver((text) => (/FROM public\.event_companies/.test(text) ? COMPANY_ROWS : []))
    setTenantDbDriver(pg.driver)
    const { db, calls } = fakeSupabase({ rows: COMPANY_ROWS })
    expect(await loadEventCompanies(db, STELLR_TENANT_ID, SLUG)).toEqual(COMPANY_ROWS)
    expect(calls).toHaveLength(1)
    expect(pg.transactions()).toBe(0)
    await afterResponse.flush()
    expect(pg.sent).toHaveLength(1)
    expect(pg.sent[0]).toMatchObject({ readOnly: true, tenant: STELLR_TENANT_ID })
    expect(appErrors.recordBuiltAppError).not.toHaveBeenCalled()
  })

  it('a difference is recorded by uuid and count only, never a company name', async () => {
    flags('events-config:shadow')
    setTenantDbDriver(pgLikeDriver((text) => (/FROM public\.event_companies/.test(text) ? [COMPANY_ROWS[0]] : [])).driver)
    const { db } = fakeSupabase({ rows: COMPANY_ROWS })
    await loadEventCompanies(db, STELLR_TENANT_ID, SLUG)
    await afterResponse.flush()
    expect(appErrors.recordBuiltAppError).toHaveBeenCalledTimes(1)
    const [route, message] = appErrors.recordBuiltAppError.mock.calls[0] as [string, string]
    expect(route).toContain('GET /api/admin/events/[slug]/companies')
    expect(message).toContain('area=events-config reason=count service=2 tenant=1')
    expect(message).toContain(C2)
    expect(message).not.toMatch(/Apollo/)
  })

  it('writes take the service path alone: a change is never applied twice', async () => {
    flags('events-config:shadow')
    const pg = pgLikeDriver()
    setTenantDbDriver(pg.driver)
    const { db, calls } = fakeSupabase()
    expect(await setEventCompanyCount(db, STELLR_TENANT_ID, SLUG, 1)).toBe(true)
    expect(await renameEventCompany(db, STELLR_TENANT_ID, SLUG, C1, 'A')).toBe(true)
    expect(calls.map((c) => `${c.table}.${c.op}`)).toEqual([
      'event_companies.upsert',
      'event_companies.delete',
      'event_settings.upsert',
      'event_companies.update',
    ])
    await afterResponse.flush()
    expect(pg.transactions()).toBe(0)
  })
})
