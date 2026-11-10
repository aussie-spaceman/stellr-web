// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const appErrors = vi.hoisted(() => ({
  recordBuiltAppError: vi.fn(async (..._args: unknown[]) => true),
}))
vi.mock('@/lib/app-errors', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  recordBuiltAppError: appErrors.recordBuiltAppError,
}))

/** runAfterResponse, held: a test runs the post-response tasks when it chooses. */
const afterResponse = vi.hoisted(() => ({
  labels: [] as string[],
  tasks: [] as (() => Promise<unknown>)[],
  async flush() {
    for (const t of this.tasks.splice(0)) await t()
  },
}))
vi.mock('@/lib/after-response', () => ({
  runAfterResponse: (label: string, task: () => Promise<unknown>) => {
    afterResponse.labels.push(label)
    afterResponse.tasks.push(task)
  },
}))

import {
  compareRows,
  dataPath,
  DATA_AREAS,
  MAX_SHADOW_IN_FLIGHT,
  mismatchMessage,
  normaliseValue,
  parseAreas,
  readArea,
  readAreaWithSeams,
  resetAreaSwitchState,
  showableId,
  TENANT_DB_AREAS_ENV,
  writeArea,
  writeAreaWithSeams,
  type ShadowMismatch,
} from './area-switch'
import {
  READ_ONLY_CHECK_SQL,
  READ_ONLY_SQL,
  setTenantDbDriver,
  tenantDb,
  TENANT_DB_FLAG,
  type TenantDb,
  type TenantSqlDriver,
} from './db'
import { STELLR_TENANT_ID } from './constants'
import { TenantContextError } from './tenant-id'

const CANARY = 'c0ffee00-0000-4000-8000-0000000000b2'
const ID1 = '11111111-1111-4111-8111-111111111111'
const ID2 = '22222222-2222-4222-8222-222222222222'
const ID3 = '33333333-3333-4333-8333-333333333333'

const on = (areas: string) => ({ [TENANT_DB_FLAG]: 'true', [TENANT_DB_AREAS_ENV]: areas })

/** A TenantDb whose reads answer `rows`, recording the tenant it was built for. */
function fakeTenantDb(rows: unknown[] | (() => Promise<unknown[]>)) {
  const built: string[] = []
  const readOnly: boolean[] = []
  const factory = (tenantId: string, o: { readOnly: boolean }): TenantDb => {
    built.push(tenantId)
    readOnly.push(o.readOnly)
    return {
      tenantId,
      sql: (async () => (typeof rows === 'function' ? rows() : rows)) as TenantDb['sql'],
      transaction: (async () => {
        throw new Error('not used')
      }) as TenantDb['transaction'],
    }
  }
  return { factory, built, readOnly }
}

/**
 * A driver that behaves as Postgres does for what tenantDb sends: the pin, the
 * read-back, SET TRANSACTION READ ONLY (and a write refused with 25006 once
 * it is set). `sent` is every caller statement that reached it.
 */
function pgLikeDriver(answer: (text: string) => unknown[] = () => []) {
  const sent: string[] = []
  const pinned: unknown[] = []
  const driver: TenantSqlDriver = {
    async transaction(fn) {
      let tenant: unknown = null
      let readOnly = false
      return fn({
        async query(text, values) {
          if (text === READ_ONLY_SQL) {
            readOnly = true
            return { rows: [], rowCount: 0 }
          }
          if (text === READ_ONLY_CHECK_SQL) return { rows: [{ read_only: readOnly ? 'on' : 'off' } as never], rowCount: 1 }
          if (text.includes('set_config')) {
            tenant = values?.[0]
            pinned.push(tenant)
            return { rows: [], rowCount: 0 }
          }
          if (text.startsWith('SET LOCAL ROLE')) return { rows: [], rowCount: 0 }
          if (text.includes('current_user AS role')) return { rows: [{ role: 'tenant_app', tenant } as never], rowCount: 1 }
          sent.push(text)
          // A write statement, or a SELECT of a function that writes (stamp_write stands in for one).
          if (readOnly && (/^\s*(?:insert|update|delete|merge)\b/i.test(text) || /stamp_write\(/.test(text))) {
            throw Object.assign(new Error('cannot execute in a read-only transaction'), { code: '25006' })
          }
          const rows = answer(text)
          return { rows: rows as never[], rowCount: rows.length }
        },
      })
    },
  }
  return { driver, sent, pinned }
}

/** Runs scheduled shadow tasks only when told to, so a test can look between the return and the comparison. */
function scheduler() {
  const tasks: (() => Promise<void>)[] = []
  return {
    schedule: (t: () => Promise<void>) => void tasks.push(t),
    tasks,
    async runAll() {
      for (const t of tasks.splice(0)) await t()
    },
  }
}

beforeEach(() => {
  resetAreaSwitchState()
  setTenantDbDriver(null)
  appErrors.recordBuiltAppError.mockClear()
  afterResponse.labels.length = 0
  afterResponse.tasks.length = 0
})

describe('parseAreas', () => {
  it('is empty for an unset or blank value', () => {
    expect(parseAreas(undefined).areas.size).toBe(0)
    expect(parseAreas('').areas.size).toBe(0)
    expect(parseAreas(' , ,').ignored).toBe(0)
  })

  it('reads shadow (default rate 1), shadow with a rate, and tenant', () => {
    const known = ['a-area', 'b-area', 'c-area']
    const { areas, ignored } = parseAreas(' a-area:shadow , b-area:shadow:0.25,c-area:tenant ', known)
    expect(ignored).toBe(0)
    expect(areas.get('a-area')).toEqual({ path: 'shadow', sample: 1 })
    expect(areas.get('b-area')).toEqual({ path: 'shadow', sample: 0.25 })
    expect(areas.get('c-area')).toEqual({ path: 'tenant', sample: 1 })
  })

  it.each([
    ['unknown-area:tenant', 'an area outside the list'],
    ['events-config', 'no path'],
    ['events-config:service', 'service is the default, not an entry'],
    ['events-config:Tenant', 'wrong case'],
    ['events-config:tenant:0.5', 'a rate on tenant'],
    ['events-config:shadow:1.5', 'a rate above 1'],
    ['events-config:shadow:-1', 'a negative rate'],
    ['events-config:shadow:.5', 'a rate without its leading digit'],
    ['events-config = tenant', 'another syntax'],
  ])('ignores %s (%s), leaving the area on service', (raw) => {
    const { areas, ignored } = parseAreas(raw)
    expect(areas.size).toBe(0)
    expect(ignored).toBe(1)
  })

  it('drops an area named twice, so a conflicting list leaves it on service', () => {
    const { areas, ignored } = parseAreas('events-config:tenant,events-config:shadow')
    expect(areas.has('events-config')).toBe(false)
    expect(ignored).toBe(2)
    expect(parseAreas('events-config:tenant,events-config:tenant,events-config:tenant').ignored).toBe(3)
  })

  it('knows only the declared areas', () => {
    expect(DATA_AREAS).toEqual(['events-config'])
  })
})

describe('dataPath', () => {
  it('is service by default', () => {
    expect(dataPath('events-config', {})).toBe('service')
    expect(dataPath('events-config', { [TENANT_DB_FLAG]: 'true' })).toBe('service')
  })

  it.each([undefined, 'false', 'TRUE', '1', 'yes', ' true'])('is service while TENANT_DB_ENABLED is %j, whatever the list says', (flag) => {
    expect(dataPath('events-config', { [TENANT_DB_FLAG]: flag, [TENANT_DB_AREAS_ENV]: 'events-config:tenant' })).toBe('service')
  })

  it('follows the list once the flag is exactly true', () => {
    expect(dataPath('events-config', on('events-config:shadow'))).toBe('shadow')
    expect(dataPath('events-config', on('events-config:tenant'))).toBe('tenant')
    expect(dataPath('events-config', on('events-config:tenat'))).toBe('service')
  })

  it('reads the environment on every call (a redeploy is not needed to see a change in tests)', () => {
    const env: Record<string, string> = on('events-config:shadow')
    expect(dataPath('events-config', env)).toBe('shadow')
    env[TENANT_DB_AREAS_ENV] = ''
    expect(dataPath('events-config', env)).toBe('service')
  })
})

describe('readArea: service', () => {
  it('runs only the service read, and builds no tenant database', async () => {
    const rows = [{ id: ID1 }]
    const service = vi.fn(async () => rows)
    const tenant = vi.fn(async () => [])
    const { factory, built } = fakeTenantDb([])
    for (const env of [{}, { [TENANT_DB_FLAG]: 'true' }, { [TENANT_DB_AREAS_ENV]: 'events-config:tenant' }]) {
      const got = await readAreaWithSeams('events-config', { tenantId: STELLR_TENANT_ID, service, tenant, env, db: factory })
      expect(got).toBe(rows)
    }
    expect(service).toHaveBeenCalledTimes(3)
    expect(tenant).not.toHaveBeenCalled()
    expect(built).toEqual([])
  })

  it("passes the service read's throw through unchanged", async () => {
    const boom = new Error('service failed')
    await expect(
      readAreaWithSeams('events-config', { tenantId: STELLR_TENANT_ID, env: {}, service: async () => Promise.reject(boom), tenant: async () => [] }),
    ).rejects.toBe(boom)
  })

  it('does not check the tenant id on the service path (today has none to check)', async () => {
    await expect(readAreaWithSeams('events-config', { tenantId: '', env: {}, service: async () => 'x', tenant: async () => 'y' })).resolves.toBe('x')
  })
})

describe('readArea: tenant', () => {
  it('answers from tenantDb for the tenant given, and never runs the service read', async () => {
    const service = vi.fn(async () => [{ id: ID1 }])
    const { factory, built } = fakeTenantDb([{ id: ID2 }])
    const got = await readAreaWithSeams('events-config', {
      tenantId: CANARY,
      env: on('events-config:tenant'),
      db: factory,
      service,
      tenant: (db) => db.sql`SELECT id FROM public.event_settings`,
    })
    expect(got).toEqual([{ id: ID2 }])
    expect(built).toEqual([CANARY])
    expect(service).not.toHaveBeenCalled()
  })

  it('refuses a missing or malformed tenant id before either read runs', async () => {
    const service = vi.fn(async () => [])
    const tenant = vi.fn(async () => [])
    for (const tenantId of ['', 'stellr', '00000000-0000-0000-0000-000000000000']) {
      await expect(readAreaWithSeams('events-config', { tenantId, env: on('events-config:tenant'), service, tenant })).rejects.toBeInstanceOf(
        TenantContextError,
      )
    }
    expect(service).not.toHaveBeenCalled()
    expect(tenant).not.toHaveBeenCalled()
  })

  it('has no service fallback: a tenantDb refusal is the caller’s failure', async () => {
    const refusal = Object.assign(new Error('permission denied'), { code: '42501' })
    const service = vi.fn(async () => [{ id: ID1 }])
    await expect(
      readAreaWithSeams('events-config', {
        tenantId: CANARY,
        env: on('events-config:tenant'),
        db: fakeTenantDb(() => Promise.reject(refusal)).factory,
        service,
        tenant: (db) => db.sql`SELECT 1`,
      }),
    ).rejects.toBe(refusal)
    expect(service).not.toHaveBeenCalled()
  })

  it('without TENANT_DATABASE_URL the default tenantDb fails closed, without a service fallback', async () => {
    const service = vi.fn(async () => [])
    await expect(
      readAreaWithSeams('events-config', { tenantId: CANARY, env: on('events-config:tenant'), service, tenant: (db) => db.sql`SELECT 1` }),
    ).rejects.toThrow(/TENANT_DATABASE_URL/)
    expect(service).not.toHaveBeenCalled()
  })
})

describe('readArea: shadow', () => {
  const env = on('events-config:shadow')

  async function shadow(serviceRows: unknown, tenantRows: unknown[] | (() => Promise<unknown[]>), extra: Record<string, unknown> = {}) {
    const s = scheduler()
    const mismatches: ShadowMismatch[] = []
    const { factory, built } = fakeTenantDb(tenantRows)
    const tenant = vi.fn((db: TenantDb) => db.sql`SELECT id FROM public.event_settings`)
    const got = await readAreaWithSeams('events-config', {
      tenantId: STELLR_TENANT_ID,
      env,
      db: factory,
      schedule: s.schedule,
      onMismatch: (m) => void mismatches.push(m),
      random: () => 0,
      service: async () => serviceRows,
      tenant,
      ...extra,
    })
    return { got, s, mismatches, built, tenant }
  }

  it('returns the service result before the tenant read has even started', async () => {
    const rows = [{ id: ID1 }]
    const { got, s, tenant, built } = await shadow(rows, [{ id: ID1 }])
    expect(got).toBe(rows)
    expect(tenant).not.toHaveBeenCalled()
    expect(built).toEqual([])
    expect(s.tasks).toHaveLength(1)
    await s.runAll()
    expect(tenant).toHaveBeenCalledTimes(1)
  })

  it('records nothing when the two reads hold the same rows, in any order', async () => {
    const { s, mismatches } = await shadow([{ id: ID1, n: 1 }, { id: ID2, n: 2 }], [{ id: ID2, n: 2 }, { id: ID1, n: 1 }])
    await s.runAll()
    expect(mismatches).toEqual([])
  })

  it('treats the two drivers’ spellings of one value as equal', async () => {
    const { s, mismatches } = await shadow(
      [{ id: ID1, at: '2026-11-09T12:00:00+00:00', amount: 12.5, big: '9007199254740993', count: 3, j: { b: 1, a: 2 } }],
      [{ id: ID1, at: new Date('2026-11-09T12:00:00Z'), amount: '12.50', big: BigInt('9007199254740993'), count: '3', j: { a: 2, b: 1 } }],
    )
    await s.runAll()
    expect(mismatches).toEqual([])
  })

  it('records a missing row by id and count, and still answers with the service rows', async () => {
    const rows = [{ id: ID1, title: 'Ada Lovelace private note' }, { id: ID2, title: 'x' }]
    const { got, s, mismatches } = await shadow(rows, [{ id: ID1, title: 'Ada Lovelace private note' }])
    expect(got).toBe(rows)
    await s.runAll()
    expect(mismatches).toEqual([
      {
        area: 'events-config',
        label: 'events-config',
        reason: 'count',
        serviceCount: 2,
        tenantCount: 1,
        onlyService: [ID2],
        onlyTenant: [],
        differ: [],
        errorCode: null,
      },
    ])
    expect(JSON.stringify(mismatches)).not.toContain('Ada')
  })

  it('records a different row set of the same size as ids, and a changed row as content', async () => {
    const a = await shadow([{ id: ID1 }, { id: ID2 }], [{ id: ID1 }, { id: ID3 }])
    await a.s.runAll()
    expect(a.mismatches[0]).toMatchObject({ reason: 'ids', onlyService: [ID2], onlyTenant: [ID3], differ: [] })

    const b = await shadow([{ id: ID1, email: 'parent@example.com' }], [{ id: ID1, email: 'other@example.com' }])
    await b.s.runAll()
    expect(b.mismatches[0]).toMatchObject({ reason: 'content', differ: [ID1], serviceCount: 1, tenantCount: 1 })
    expect(JSON.stringify(b.mismatches)).not.toContain('example.com')
  })

  it('never shows an id that could be personal data; such rows are compared by content', async () => {
    const { s, mismatches } = await shadow(
      [{ id: 'parent@example.com' }, { id: 'Alice' }],
      [{ id: 'parent@example.com' }],
      { key: (r: { id: string }) => r.id },
    )
    await s.runAll()
    expect(mismatches[0]).toMatchObject({ reason: 'count', onlyService: [], onlyTenant: [] })
    expect(JSON.stringify(mismatches)).not.toMatch(/example|Alice/)
  })

  it('a single row or null is compared as zero or one row', async () => {
    const a = await shadow({ id: ID1 }, [{ id: ID1 }])
    await a.s.runAll()
    expect(a.mismatches).toEqual([])
    const b = await shadow(null, [{ id: ID1 }])
    await b.s.runAll()
    expect(b.mismatches[0]).toMatchObject({ reason: 'count', serviceCount: 0, tenantCount: 1, onlyTenant: [ID1] })
  })

  it('hashes the service rows at once, so a route changing them afterwards does not move the comparison', async () => {
    const rows = [{ id: ID1, n: 1 }]
    const { s, mismatches } = await shadow(rows, [{ id: ID1, n: 1 }])
    rows[0].n = 99
    rows.push({ id: ID2, n: 2 })
    await s.runAll()
    expect(mismatches).toEqual([])
  })

  it('records a tenant failure by its code only, and the request is untouched', async () => {
    const refusal = Object.assign(new Error('new row violates policy for tenant parent@example.com'), { code: '42501' })
    const rows = [{ id: ID1 }]
    const { got, s, mismatches } = await shadow(rows, () => Promise.reject(refusal))
    expect(got).toBe(rows)
    await s.runAll()
    expect(mismatches).toEqual([expect.objectContaining({ reason: 'tenant_error', errorCode: '42501', serviceCount: 1, tenantCount: null })])
    expect(JSON.stringify(mismatches)).not.toContain('example.com')
  })

  it('records a tenant read that throws synchronously, without throwing', async () => {
    const s = scheduler()
    const mismatches: ShadowMismatch[] = []
    await readAreaWithSeams('events-config', {
      tenantId: STELLR_TENANT_ID,
      env,
      schedule: s.schedule,
      random: () => 0,
      onMismatch: (m) => void mismatches.push(m),
      service: async () => [],
      tenant: () => {
        throw new TenantContextError('tenantDb refused the SQL')
      },
    })
    await s.runAll()
    expect(mismatches[0]).toMatchObject({ reason: 'tenant_error', errorCode: 'TenantContextError' })
  })

  it('records a slow tenant read as a timeout', async () => {
    const { s, mismatches } = await shadow([{ id: ID1 }], () => new Promise<unknown[]>(() => {}), { timeoutMs: 5 })
    await s.runAll()
    expect(mismatches[0]).toMatchObject({ reason: 'timeout', serviceCount: 1, tenantCount: null })
  })

  it('records a missing tenant id as no_tenant and builds no tenant database', async () => {
    const { got, s, mismatches, built } = await shadow([{ id: ID1 }], [], { tenantId: 'stellr' })
    expect(got).toEqual([{ id: ID1 }])
    await s.runAll()
    expect(mismatches[0]).toMatchObject({ reason: 'no_tenant' })
    expect(built).toEqual([])
  })

  it('a failing mismatch sink and a failing scheduler never reach the request', async () => {
    const rows = [{ id: ID1 }]
    const a = await shadow(rows, [], { onMismatch: () => Promise.reject(new Error('sink down')) })
    await expect(a.s.runAll()).resolves.toBeUndefined()
    const b = await shadow(rows, [], {
      schedule: () => {
        throw new Error('no request context')
      },
    })
    expect(b.got).toBe(rows)
  })

  it('a service failure is passed through and starts no shadow read', async () => {
    const s = scheduler()
    const boom = new Error('service failed')
    await expect(
      readAreaWithSeams('events-config', {
        tenantId: STELLR_TENANT_ID,
        env,
        schedule: s.schedule,
        random: () => 0,
        service: async () => Promise.reject(boom),
        tenant: async () => [],
      }),
    ).rejects.toBe(boom)
    expect(s.tasks).toHaveLength(0)
  })

  it('honours the sample rate', async () => {
    const run = async (areas: string, random: number) => {
      const s = scheduler()
      await readAreaWithSeams('events-config', {
        tenantId: STELLR_TENANT_ID,
        env: on(areas),
        schedule: s.schedule,
        random: () => random,
        service: async () => [],
        tenant: async () => [],
      })
      return s.tasks.length
    }
    expect(await run('events-config:shadow:0.25', 0.2)).toBe(1)
    expect(await run('events-config:shadow:0.25', 0.25)).toBe(0)
    expect(await run('events-config:shadow:0.25', 0.9)).toBe(0)
    expect(await run('events-config:shadow:0', 0)).toBe(0)
    expect(await run('events-config:shadow', 0.999)).toBe(1)
  })

  it(`runs at most ${MAX_SHADOW_IN_FLIGHT} shadow reads at once per instance, and frees the slot afterwards`, async () => {
    const s = scheduler()
    const opts = {
      tenantId: STELLR_TENANT_ID,
      env,
      schedule: s.schedule,
      random: () => 0,
      service: async () => [],
      tenant: async () => [],
    }
    for (let i = 0; i < MAX_SHADOW_IN_FLIGHT + 2; i++) await readAreaWithSeams('events-config', opts)
    expect(s.tasks).toHaveLength(MAX_SHADOW_IN_FLIGHT)
    await s.runAll()
    await readAreaWithSeams('events-config', opts)
    expect(s.tasks).toHaveLength(1)
  })

  it('keeps a slot taken until a timed-out tenant read actually settles (a slow database cannot pass the cap)', async () => {
    const s = scheduler()
    const pending: ((rows: unknown[]) => void)[] = []
    const mismatches: ShadowMismatch[] = []
    const opts = {
      tenantId: STELLR_TENANT_ID,
      env,
      schedule: s.schedule,
      random: () => 0,
      timeoutMs: 1,
      onMismatch: (m: ShadowMismatch) => void mismatches.push(m),
      service: async () => [],
      tenant: () => new Promise<unknown[]>((resolve) => pending.push(resolve)),
    }
    for (let i = 0; i < MAX_SHADOW_IN_FLIGHT; i++) await readAreaWithSeams('events-config', opts)
    await s.runAll()
    expect(mismatches.map((m) => m.reason)).toEqual(Array(MAX_SHADOW_IN_FLIGHT).fill('timeout'))
    // Both reads timed out but are still running: no new shadow read starts.
    await readAreaWithSeams('events-config', opts)
    expect(s.tasks).toHaveLength(0)
    // Once one settles, its slot is free again.
    pending[0]([])
    await new Promise((r) => setTimeout(r, 0))
    await readAreaWithSeams('events-config', opts)
    expect(s.tasks).toHaveLength(1)
  })

  it('builds the shadow tenantDb read-only, and the tenant-mode one read-write', async () => {
    const a = fakeTenantDb([])
    const s = scheduler()
    await readAreaWithSeams('events-config', {
      tenantId: STELLR_TENANT_ID,
      env,
      db: a.factory,
      schedule: s.schedule,
      random: () => 0,
      service: async () => [],
      tenant: (db) => db.sql`SELECT 1`,
    })
    await s.runAll()
    expect(a.readOnly).toEqual([true])
    const b = fakeTenantDb([])
    await readAreaWithSeams('events-config', {
      tenantId: STELLR_TENANT_ID,
      env: on('events-config:tenant'),
      db: b.factory,
      service: async () => [],
      tenant: (db) => db.sql`SELECT 1`,
    })
    expect(b.readOnly).toEqual([false])
  })

  it('runs through the real tenantDb on the tenant it was given, in a read-only transaction', async () => {
    const pg = pgLikeDriver((text) => (text.startsWith('SELECT id') ? [{ id: ID1 }] : []))
    setTenantDbDriver(pg.driver)
    const s = scheduler()
    const mismatches: ShadowMismatch[] = []
    await readAreaWithSeams('events-config', {
      tenantId: CANARY,
      env,
      schedule: s.schedule,
      random: () => 0,
      onMismatch: (m) => void mismatches.push(m),
      service: async () => [{ id: ID1 }],
      tenant: (db) => db.sql`SELECT id FROM public.event_settings`,
    })
    await s.runAll()
    expect(pg.pinned).toEqual([CANARY])
    expect(mismatches).toEqual([])
    // The same database the module builds by default, so the seam is not hiding a different path.
    expect(tenantDb(CANARY, { env }).tenantId).toBe(CANARY)
  })

  it('refuses a write in a shadow callback, never applies it, and records it as tenant_error', async () => {
    const pg = pgLikeDriver()
    setTenantDbDriver(pg.driver)
    const run = async (tenant: (db: TenantDb) => Promise<unknown>) => {
      const s = scheduler()
      const mismatches: ShadowMismatch[] = []
      const service = vi.fn(async () => [{ id: ID1 }])
      const got = await readAreaWithSeams('events-config', {
        tenantId: CANARY,
        env,
        schedule: s.schedule,
        random: () => 0,
        onMismatch: (m) => void mismatches.push(m),
        service,
        tenant: tenant as (db: TenantDb) => Promise<{ id: string }[]>,
      })
      await s.runAll()
      expect(got).toEqual([{ id: ID1 }])
      expect(service).toHaveBeenCalledTimes(1)
      return mismatches
    }
    // A plain write, through sql and through a transaction: refused by tenantDb before it is sent.
    const plain = await run((db) => db.sql`UPDATE public.event_settings SET company_count = ${1} WHERE id = ${ID1}`)
    expect(plain).toEqual([expect.objectContaining({ reason: 'tenant_error', errorCode: 'TenantContextError' })])
    const inTx = await run((db) =>
      db.transaction(async (q) => {
        await q.sql`SELECT id FROM public.event_settings`
        return q.sql`WITH x AS (DELETE FROM public.event_settings WHERE id = ${ID1} RETURNING id) SELECT id FROM x`
      }),
    )
    expect(inTx).toEqual([expect.objectContaining({ reason: 'tenant_error', errorCode: 'TenantContextError' })])
    expect(pg.sent.filter((t) => /update|delete/i.test(t))).toEqual([])
    // A read that calls a function that writes: refused by the database, because the transaction is READ ONLY.
    const viaFunction = await run((db) => db.sql`SELECT stamp_write(${ID1}) AS id`)
    expect(viaFunction).toEqual([expect.objectContaining({ reason: 'tenant_error', errorCode: '25006' })])
  })
})

describe('readArea: the production entry points take no seams', () => {
  const ENV_KEYS = [TENANT_DB_FLAG, TENANT_DB_AREAS_ENV] as const
  let saved: Record<string, string | undefined>
  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
    for (const k of ENV_KEYS) delete process.env[k]
  })
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('readArea ignores env, db, schedule and onMismatch smuggled into its options, and follows process.env', async () => {
    const { factory, built } = fakeTenantDb([{ id: ID2 }])
    const onMismatch = vi.fn()
    const service = vi.fn(async () => [{ id: ID1 }])
    const smuggled = { env: on('events-config:tenant'), db: factory, onMismatch, schedule: () => {}, random: () => 0 }
    const got = await readArea('events-config', {
      tenantId: CANARY,
      service,
      tenant: (db) => db.sql`SELECT id FROM public.event_settings`,
      ...(smuggled as object),
    })
    // process.env has the flag off: service, whatever the options said.
    expect(got).toEqual([{ id: ID1 }])
    expect(built).toEqual([])
    expect(onMismatch).not.toHaveBeenCalled()
  })

  it('writeArea ignores env and db smuggled into its options', async () => {
    const { factory, built } = fakeTenantDb([])
    const service = vi.fn(async () => 'svc')
    const got = await writeArea('events-config', {
      tenantId: CANARY,
      service,
      tenant: async () => 'tenant',
      ...({ env: on('events-config:tenant'), db: factory } as object),
    })
    expect(got).toBe('svc')
    expect(built).toEqual([])
  })

  it('readArea follows process.env when it does turn the area on', async () => {
    process.env[TENANT_DB_FLAG] = 'true'
    process.env[TENANT_DB_AREAS_ENV] = 'events-config:tenant'
    const pg = pgLikeDriver((text) => (text.startsWith('SELECT id') ? [{ id: ID2 }] : []))
    setTenantDbDriver(pg.driver)
    const service = vi.fn(async () => [{ id: ID1 }])
    const got = await readArea('events-config', { tenantId: CANARY, service, tenant: (db) => db.sql`SELECT id FROM public.event_settings` })
    expect(got).toEqual([{ id: ID2 }])
    expect(service).not.toHaveBeenCalled()
    expect(pg.pinned).toEqual([CANARY])
  })

  it('shadow without a schedule seam defers the tenant read to runAfterResponse, after readArea has returned', async () => {
    process.env[TENANT_DB_FLAG] = 'true'
    process.env[TENANT_DB_AREAS_ENV] = 'events-config:shadow'
    const pg = pgLikeDriver((text) => (text.startsWith('SELECT id') ? [{ id: ID1 }] : []))
    setTenantDbDriver(pg.driver)
    const tenant = vi.fn((db: TenantDb) => db.sql`SELECT id FROM public.event_settings`)
    const rows = [{ id: ID1 }]
    const got = await readArea('events-config', { tenantId: CANARY, service: async () => rows, tenant })
    expect(got).toBe(rows)
    expect(tenant).not.toHaveBeenCalled()
    expect(afterResponse.labels).toEqual(['area-switch'])
    await afterResponse.flush()
    expect(tenant).toHaveBeenCalledTimes(1)
    expect(pg.pinned).toEqual([CANARY])
  })
})

describe('readArea: the default mismatch record', () => {
  it('writes one app_errors row with the area, reason, counts and ids, and nothing else', async () => {
    let task: (() => Promise<void>) | undefined
    await readAreaWithSeams('events-config', {
      tenantId: STELLR_TENANT_ID,
      env: on('events-config:shadow'),
      label: 'GET /api/admin/events/[slug]/settings',
      db: fakeTenantDb([{ id: ID1, name: 'Ada' }]).factory,
      schedule: (t) => void (task = t),
      random: () => 0,
      service: async () => [{ id: ID1, name: 'Ada' }, { id: ID2, name: 'Grace' }],
      tenant: (db) => db.sql`SELECT 1`,
    })
    await task?.()
    expect(appErrors.recordBuiltAppError).toHaveBeenCalledTimes(1)
    const [route, message] = appErrors.recordBuiltAppError.mock.calls[0] as [string, string, string]
    expect(route).toBe('TENANTDB GET /api/admin/events/[slug]/settings')
    expect(message).toBe(
      `tenantdb_shadow_mismatch area=events-config reason=count service=2 tenant=1 only_service=${ID2} only_tenant=- differ=-`,
    )
    expect(message).not.toMatch(/Ada|Grace/)
  })

  it('reports ignored TENANT_DB_AREAS entries once per value, by count, never echoing them', async () => {
    const env = on('events-config:tenat,secret-looking-value')
    for (let i = 0; i < 3; i++) {
      await readAreaWithSeams('events-config', { tenantId: STELLR_TENANT_ID, env, service: async () => [], tenant: async () => [] })
    }
    // Registered with after(), once, and not written before the response.
    expect(afterResponse.labels).toEqual(['area-switch'])
    expect(appErrors.recordBuiltAppError).not.toHaveBeenCalled()
    await afterResponse.flush()
    expect(appErrors.recordBuiltAppError).toHaveBeenCalledTimes(1)
    const [route, message] = appErrors.recordBuiltAppError.mock.calls[0] as [string, string, string]
    expect(route).toBe('CONFIG TENANT_DB_AREAS')
    expect(message).toBe('TENANT_DB_AREAS has 2 ignored entries; their areas read through the service path')
    expect(message).not.toMatch(/tenat|secret/)
  })

  it('writes nothing while the flag is off, however the list looks', async () => {
    await readAreaWithSeams('events-config', {
      tenantId: STELLR_TENANT_ID,
      env: { [TENANT_DB_AREAS_ENV]: 'nonsense' },
      service: async () => [],
      tenant: async () => [],
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(appErrors.recordBuiltAppError).not.toHaveBeenCalled()
  })
})

describe('writeArea', () => {
  it('writes through the service path alone in service and shadow mode, so nothing is written twice', async () => {
    for (const env of [{}, on('events-config:shadow')]) {
      const service = vi.fn(async () => 'svc')
      const tenant = vi.fn(async () => 'tenant')
      await expect(writeAreaWithSeams('events-config', { tenantId: STELLR_TENANT_ID, env, service, tenant })).resolves.toBe('svc')
      expect(service).toHaveBeenCalledTimes(1)
      expect(tenant).not.toHaveBeenCalled()
    }
  })

  it('writes through tenantDb alone in tenant mode, and refuses a missing tenant', async () => {
    const service = vi.fn(async () => 'svc')
    const { factory, built } = fakeTenantDb([])
    await expect(
      writeAreaWithSeams('events-config', { tenantId: CANARY, env: on('events-config:tenant'), db: factory, service, tenant: async () => 'tenant' }),
    ).resolves.toBe('tenant')
    expect(built).toEqual([CANARY])
    await expect(
      writeAreaWithSeams('events-config', { tenantId: '', env: on('events-config:tenant'), service, tenant: async () => 'tenant' }),
    ).rejects.toBeInstanceOf(TenantContextError)
    expect(service).not.toHaveBeenCalled()
  })
})

describe('comparison helpers', () => {
  it('showableId shows only uuids unless the area opts in to integers or slugs', () => {
    expect(showableId(ID1.toUpperCase())).toBe(ID1)
    // A member-number-shaped integer and a name-shaped slug are not shown by default.
    for (const hidden of [42, '1234567', BigInt(7), 'iso-a-event', 'jane-doe-2027']) expect(showableId(hidden)).toBeNull()
    expect(showableId(42, ['integer'])).toBe('42')
    expect(showableId('42', ['integer'])).toBe('42')
    expect(showableId(BigInt(7), ['integer'])).toBe('7')
    expect(showableId('iso-a-event', ['integer'])).toBeNull()
    expect(showableId('iso-a-event', ['slug'])).toBe('iso-a-event')
    expect(showableId('42', ['slug'])).toBeNull()
    for (const bad of ['parent@example.com', 'Alice', 'alice', 'Mary Jane', -1, 1.5, null, undefined, {}, 'x'.repeat(65)]) {
      expect(showableId(bad, ['integer', 'slug'])).toBeNull()
    }
  })

  it('a mismatch keyed by a non-uuid id records counts but no ids unless the area opted in', () => {
    const a = compareRows([{ id: 'iso-a-event' }, { id: 'iso-b-event' }], [{ id: 'iso-a-event' }])
    expect(a).toMatchObject({ reason: 'count', onlyService: [], onlyTenant: [] })
    const b = compareRows([{ id: 'iso-a-event' }, { id: 'iso-b-event' }], [{ id: 'iso-a-event' }], { showIds: ['slug'] })
    expect(b).toMatchObject({ reason: 'count', onlyService: ['iso-b-event'] })
  })

  it('normaliseValue sorts keys and drops undefined', () => {
    expect(JSON.stringify(normaliseValue({ b: 1, a: undefined, c: [undefined, 2] }))).toBe('{"b":"1","c":[null,"2"]}')
  })

  it('compareRows is order-insensitive and counts duplicates of unkeyed rows', () => {
    expect(compareRows([{ v: 'a' }, { v: 'b' }], [{ v: 'b' }, { v: 'a' }])).toBeNull()
    expect(compareRows([{ v: 'a' }, { v: 'a' }], [{ v: 'a' }, { v: 'b' }])).toMatchObject({ reason: 'content' })
  })

  it('mismatchMessage lists at most the ids it was given and dashes for none', () => {
    const m: ShadowMismatch = {
      area: 'events-config',
      label: 'x',
      reason: 'tenant_error',
      serviceCount: 3,
      tenantCount: null,
      onlyService: [],
      onlyTenant: [],
      differ: [],
      errorCode: '42501',
    }
    expect(mismatchMessage(m)).toBe(
      'tenantdb_shadow_mismatch area=events-config reason=tenant_error service=3 tenant=- only_service=- only_tenant=- differ=- error=42501',
    )
  })
})
