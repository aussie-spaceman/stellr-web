// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest'

// A refused TENANT_DATABASE_URL writes one 'TENANTDB config' row (O3), through
// these two. Stood in for, so a refusal here never reaches app_errors.
vi.mock('@/lib/after-response', () => ({ runAfterResponse: () => {} }))
vi.mock('@/lib/app-errors', () => ({ recordBuiltAppError: async () => true, routeLabel: () => '', errorDigest: () => '' }))
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, normalize } from 'node:path'
import {
  tenantDb,
  tenantSql,
  stellrDb,
  assertTenantId,
  refusedSql,
  setTenantDbDriver,
  isTenantDbEnabled,
  TenantContextError,
  TENANT_ROLE,
  TENANT_SETTING,
  TENANT_DB_FLAG,
  PIN_CHECK_SQL,
  READ_ONLY_SQL,
  READ_ONLY_CHECK_SQL,
  isWriteShaped,
  type TenantSqlDriver,
  type TenantSqlTx,
} from './db'
import { TENANT_DB_CALLERS } from './db-callers'
import { STELLR_TENANT_ID } from './constants'
import { TENANT_ROLE as PGTAP_ROLE, TENANT_SETTING as PGTAP_SETTING } from '../../scripts/gen-tenant-isolation-pgtap.mjs'

const CANARY = 'c0ffee00-0000-4000-8000-0000000000b2'

type Call = { text: string; values?: readonly unknown[] }

/**
 * A stand-in for Postgres that behaves like the S4 migration: SET LOCAL ROLE
 * and set_config(…, true) last for the transaction only; the read-back
 * reports them. `broken` simulates a connection where the pin does not stick.
 */
function fakeDriver(
  opts: {
    broken?: 'role' | 'tenant'
    rows?: Record<string, unknown>[]
    /** A caller statement containing this text moves the pin, the way an unknown in-statement path would. */
    moveOn?: { text: string; to: { role?: string; tenant?: string } }
    /** SET TRANSACTION READ ONLY does not take (a connection or driver that drops it). */
    ignoreReadOnly?: boolean
  } = {},
) {
  const log: { calls: Call[]; outcome: 'commit' | 'rollback' }[] = []
  const driver: TenantSqlDriver = {
    async transaction(fn) {
      const calls: Call[] = []
      let role = 'session_user'
      let tenant: string | null = null
      let readOnly = false
      const tx: TenantSqlTx = {
        async query(text, values) {
          calls.push({ text, values })
          if (text === READ_ONLY_SQL) {
            readOnly = !opts.ignoreReadOnly
            return { rows: [], rowCount: 0 }
          }
          if (text === READ_ONLY_CHECK_SQL) return { rows: [{ read_only: readOnly ? 'on' : 'off' } as never], rowCount: 1 }
          if (/^SET LOCAL ROLE /.test(text)) role = opts.broken === 'role' ? 'postgres' : text.slice('SET LOCAL ROLE '.length)
          else if (/set_config\('stellr\.tenant_id', \$1, true\)/.test(text)) tenant = opts.broken === 'tenant' ? null : String(values?.[0])
          else if (/current_user AS role/.test(text)) return { rows: [{ role, tenant } as never], rowCount: 1 }
          else if (opts.moveOn && text.includes(opts.moveOn.text)) {
            role = opts.moveOn.to.role ?? role
            tenant = opts.moveOn.to.tenant ?? tenant
          }
          return { rows: (opts.rows ?? []) as never[], rowCount: opts.rows?.length ?? 0 }
        },
      }
      try {
        const out = await fn(tx)
        log.push({ calls, outcome: 'commit' })
        return out
      } catch (e) {
        log.push({ calls, outcome: 'rollback' })
        throw e
      }
    },
  }
  return { driver, log }
}

beforeEach(() => setTenantDbDriver(null))

describe('tenantDb: no tenant, no query', () => {
  it.each([undefined, null, '', '   ', 'stellr', '123', `${STELLR_TENANT_ID}x`, '00000000-0000-0000-0000-000000000000', 42, {}])(
    'throws for %j before touching the database',
    (bad) => {
      const { driver, log } = fakeDriver()
      expect(() => tenantDb(bad as string, { driver })).toThrow(TenantContextError)
      expect(log).toEqual([])
    },
  )

  it('never echoes the rejected value', () => {
    expect(() => assertTenantId('secret-looking-value')).toThrow(/not a tenant uuid/)
    expect(() => assertTenantId('secret-looking-value')).not.toThrow(/secret-looking-value/)
  })

  it('normalises to the canonical lower-case id (app_tenant_id() matches only that)', () => {
    expect(assertTenantId(` ${CANARY.toUpperCase()} `)).toBe(CANARY)
    expect(tenantDb(CANARY.toUpperCase(), { driver: fakeDriver().driver }).tenantId).toBe(CANARY)
  })

  it('stellrDb is tenant #1', () => {
    expect(stellrDb({ driver: fakeDriver().driver }).tenantId).toBe(STELLR_TENANT_ID)
  })
})

describe('tenantDb: the transaction it runs', () => {
  it('pins role and tenant, reads them back, then runs the bound statement', async () => {
    const { driver, log } = fakeDriver({ rows: [{ id: 'r1' }] })
    const id = 'reg-1'
    const rows = await tenantDb(CANARY, { driver }).sql`SELECT id FROM public.registrations WHERE id = ${id} AND event_slug = ${'ev'}`
    expect(rows).toEqual([{ id: 'r1' }])
    expect(log).toHaveLength(1)
    expect(log[0].outcome).toBe('commit')
    expect(log[0].calls).toEqual([
      { text: 'SET LOCAL ROLE tenant_app', values: undefined },
      { text: "SELECT set_config('stellr.tenant_id', $1, true)", values: [CANARY] },
      { text: 'SELECT current_user AS role, public.app_tenant_id()::text AS tenant', values: undefined },
      { text: 'SELECT id FROM public.registrations WHERE id = $1 AND event_slug = $2', values: ['reg-1', 'ev'] },
      { text: PIN_CHECK_SQL, values: undefined },
    ])
  })

  it('binds every value — a hostile value never becomes SQL', async () => {
    const { driver, log } = fakeDriver()
    const evil = "x'; SELECT set_config('stellr.tenant_id', '00000000-0000-4000-8000-000000000001', true); --"
    await tenantDb(CANARY, { driver }).sql`SELECT 1 FROM public.events WHERE slug = ${evil}`
    expect(log[0].calls[3]).toEqual({ text: 'SELECT 1 FROM public.events WHERE slug = $1', values: [evil] })
  })

  it('pins once per transaction and runs every statement inside it', async () => {
    const { driver, log } = fakeDriver()
    await tenantDb(CANARY, { driver }).transaction(async (q) => {
      await q.sql`INSERT INTO public.event_settings (event_slug) VALUES (${'ev'})`
      await q.run(tenantSql`UPDATE public.event_settings SET company_count = ${2} WHERE event_slug = ${'ev'}`)
    })
    expect(log).toHaveLength(1)
    expect(log[0].calls.map((c) => c.text)).toEqual([
      'SET LOCAL ROLE tenant_app',
      "SELECT set_config('stellr.tenant_id', $1, true)",
      'SELECT current_user AS role, public.app_tenant_id()::text AS tenant',
      'INSERT INTO public.event_settings (event_slug) VALUES ($1)',
      PIN_CHECK_SQL,
      'UPDATE public.event_settings SET company_count = $1 WHERE event_slug = $2',
      PIN_CHECK_SQL,
    ])
  })

  it.each([
    ['re-pins the tenant', { tenant: STELLR_TENANT_ID }],
    ['drops the role back to the login', { role: 'tenant_app_login' }],
  ])('rolls back, and returns no rows, when a statement %s by a path refusedSql does not know', async (_label, to) => {
    const { driver, log } = fakeDriver({ rows: [{ id: 'other-tenant-row' }], moveOn: { text: 'unknown_path', to } })
    await expect(
      tenantDb(CANARY, { driver }).sql`SELECT unknown_path(), id FROM public.registrations`,
    ).rejects.toThrow(/changed the tenant pin or the role; tenantDb rolled the transaction back/)
    expect(log[0].outcome).toBe('rollback')
    expect(log[0].calls.at(-1)?.text).toBe(PIN_CHECK_SQL)
  })

  it('stops at the first statement that moved the pin: later statements never run', async () => {
    const { driver, log } = fakeDriver({ moveOn: { text: 'unknown_path', to: { tenant: STELLR_TENANT_ID } } })
    await expect(
      tenantDb(CANARY, { driver }).transaction(async (q) => {
        await q.sql`UPDATE public.event_settings SET company_count = unknown_path() WHERE event_slug = ${'ev'}`
        await q.sql`DELETE FROM public.event_settings WHERE event_slug = ${'ev'}`
      }),
    ).rejects.toThrow(/changed the tenant pin/)
    expect(log[0].outcome).toBe('rollback')
    expect(log[0].calls.map((c) => c.text)).not.toContain('DELETE FROM public.event_settings WHERE event_slug = $1')
  })

  it('a separate call is a separate transaction with its own pin', async () => {
    const { driver, log } = fakeDriver()
    await tenantDb(CANARY, { driver }).sql`SELECT 1`
    await tenantDb(STELLR_TENANT_ID, { driver }).sql`SELECT 1`
    expect(log.map((t) => t.calls[1].values)).toEqual([[CANARY], [STELLR_TENANT_ID]])
  })

  it.each(['role', 'tenant'] as const)('rolls back and throws when the %s does not stick', async (broken) => {
    const { driver, log } = fakeDriver({ broken })
    await expect(tenantDb(CANARY, { driver }).sql`SELECT 1 FROM public.registrations`).rejects.toThrow(/could not pin the tenant/)
    expect(log[0].outcome).toBe('rollback')
    expect(log[0].calls.map((c) => c.text)).not.toContain('SELECT 1 FROM public.registrations')
  })

  it('rolls back when the caller throws', async () => {
    const { driver, log } = fakeDriver()
    await expect(
      tenantDb(CANARY, { driver }).transaction(async (q) => {
        await q.sql`DELETE FROM public.event_settings WHERE event_slug = ${'ev'}`
        throw new Error('caller failed')
      }),
    ).rejects.toThrow('caller failed')
    expect(log[0].outcome).toBe('rollback')
  })
})

describe('tenantDb: caller SQL cannot change the role or the tenant', () => {
  it.each([
    'SET ROLE service_role',
    'SET LOCAL ROLE postgres',
    'RESET ROLE',
    'SET SESSION AUTHORIZATION postgres',
    "SET stellr.tenant_id = 'x'",
    "SELECT set_config('stellr.tenant_id', 'x', true)",
    "SELECT pg_catalog.set_config ('stellr.tenant_id', 'x', true)",
    'SELECT 1; RESET ROLE',
    "DO $$ BEGIN PERFORM 1; END $$",
    'CALL something()',
    'COMMIT',
    'DROP TABLE public.registrations',
    'GRANT tenant_app TO anon',
    // Review findings, S4: spellings of set_config the first guard missed.
    `SELECT "set_config"('stellr.tenant_id', $1, true)`,
    `SELECT set_config/**/('stellr.tenant_id', $1, true)`,
    `SELECT pg_catalog."set_config"('role','none',true)`,
    `SELECT U&"set\\005fconfig"('stellr.tenant_id', $1, true)`,
    `SELECT u&'x'`,
    `SELECT "SET_CONFIG"('role', 'none', true)`,
    `SELECT 1 FROM public.events -- trailing comment`,
    // pg_settings is updatable by PUBLIC and is set_config by another name.
    `UPDATE pg_settings SET setting = $1 WHERE name = 'stellr.tenant_id'`,
    `UPDATE pg_catalog."pg_settings" SET setting = 'none' WHERE name = 'role'`,
    // Core functions that run SQL text (which could arrive as a bound value).
    `SELECT query_to_xml($1, true, false, '')`,
    `SELECT pg_catalog.cursor_to_xml($1, 1, true, false, '')`,
    `SELECT * FROM ts_stat($1)`,
    `SELECT ts_rewrite('a'::tsquery, $1)`,
  ])('refuses %j', async (sql) => {
    expect(refusedSql(sql)).not.toBeNull()
    // A frozen hand-made template (shaped like the real thing) still meets refusedSql.
    const strings = Object.freeze(Object.assign([sql], { raw: Object.freeze([sql]) })) as unknown as TemplateStringsArray
    expect(() => tenantSql(strings)).toThrow(/refused the SQL/)
    // And a hand-made statement object never reaches the driver at all.
    const { driver, log } = fakeDriver()
    await expect(tenantDb(CANARY, { driver }).transaction((q) => q.run({ text: sql, values: [] }))).rejects.toThrow(
      /only statements built with tenantSql/,
    )
    expect(log[0].outcome).toBe('rollback')
    expect(log[0].calls.map((c) => c.text)).not.toContain(sql)
  })

  it('run() refuses a hand-made {text, values} even when the SQL itself is harmless (review finding, S4)', async () => {
    const { driver, log } = fakeDriver()
    await expect(
      tenantDb(CANARY, { driver }).transaction((q) => q.run({ text: 'SELECT 1 FROM public.events', values: [] })),
    ).rejects.toThrow(/only statements built with tenantSql/)
    expect(log[0].calls.map((c) => c.text)).not.toContain('SELECT 1 FROM public.events')
  })

  it('a statement tenantSql built is frozen, so it cannot be edited after the check', () => {
    const s = tenantSql`SELECT 1 FROM public.events WHERE slug = ${'ev'}`
    expect(Object.isFrozen(s)).toBe(true)
    expect(Object.isFrozen(s.values)).toBe(true)
    expect(() => {
      ;(s as { text: string }).text = "SELECT set_config('role', 'none', true)"
    }).toThrow(TypeError)
  })

  it('refuses a forged, unfrozen template strings array (review finding, S4)', () => {
    const forged = Object.assign(['SELECT 1 FROM public.events'], { raw: ['SELECT 1 FROM public.events'] })
    expect(() => tenantSql(forged as unknown as TemplateStringsArray)).toThrow(/tagged template/)
    const mismatched = Object.freeze(Object.assign(['SELECT ', ''], { raw: Object.freeze(['SELECT ', '']) }))
    expect(() => tenantSql(mismatched as unknown as TemplateStringsArray)).toThrow(/tagged template/)
  })

  it.each([
    'SELECT id FROM public.registrations WHERE id = $1',
    'select 1',
    '  WITH x AS (SELECT 1) SELECT * FROM x',
    'INSERT INTO public.event_settings (event_slug) VALUES ($1)',
    "UPDATE public.tenant_memberships SET role = 'duty_holder' WHERE id = $1",
    'DELETE FROM public.event_settings WHERE event_slug = $1;',
    'SELECT reset_token, password_reset_at FROM public.members_view',
  ])('allows %j', (sql) => {
    expect(refusedSql(sql)).toBeNull()
  })

  it('refuses a statement object not built by tenantSql', async () => {
    const { driver } = fakeDriver()
    await expect(
      tenantDb(CANARY, { driver }).transaction((q) => q.run('SELECT 1' as never)),
    ).rejects.toThrow(/only statements built with tenantSql/)
  })

  it('refuses tenantSql called as a plain function', () => {
    expect(() => (tenantSql as unknown as (s: string) => unknown)('SELECT 1')).toThrow(/tagged template/)
  })
})

describe('tenantDb: readOnly (the area switch’s shadow read, C12)', () => {
  it('sets the transaction read-only before the pin and reads it back before the caller’s statement', async () => {
    const { driver, log } = fakeDriver()
    await tenantDb(CANARY, { driver, readOnly: true }).sql`SELECT id FROM public.event_settings`
    const texts = log[0].calls.map((c) => c.text)
    expect(texts[0]).toBe(READ_ONLY_SQL)
    expect(texts.indexOf(READ_ONLY_CHECK_SQL)).toBeGreaterThan(texts.findIndex((t) => t.includes('set_config')))
    expect(texts.indexOf(READ_ONLY_CHECK_SQL)).toBeLessThan(texts.indexOf('SELECT id FROM public.event_settings'))
    expect(log[0].outcome).toBe('commit')
  })

  it('without readOnly sends neither', async () => {
    const { driver, log } = fakeDriver()
    await tenantDb(CANARY, { driver }).sql`SELECT 1`
    expect(log[0].calls.map((c) => c.text)).not.toContain(READ_ONLY_SQL)
    expect(log[0].calls.map((c) => c.text)).not.toContain(READ_ONLY_CHECK_SQL)
  })

  it('rolls back, before any caller statement, when the transaction did not become read-only', async () => {
    const { driver, log } = fakeDriver({ ignoreReadOnly: true })
    await expect(tenantDb(CANARY, { driver, readOnly: true }).sql`SELECT id FROM public.event_settings`).rejects.toThrow(/read-only/)
    expect(log[0].outcome).toBe('rollback')
    expect(log[0].calls.map((c) => c.text)).not.toContain('SELECT id FROM public.event_settings')
  })

  it('refuses a write-shaped statement before it is sent, through sql and inside a transaction', async () => {
    const { driver, log } = fakeDriver()
    const db = tenantDb(CANARY, { driver, readOnly: true })
    await expect(db.sql`UPDATE public.event_settings SET company_count = ${1}`).rejects.toThrow(/read-only/)
    await expect(
      db.transaction(async (q) => {
        await q.sql`SELECT 1`
        return q.sql`WITH d AS (DELETE FROM public.event_settings RETURNING id) SELECT id FROM d`
      }),
    ).rejects.toThrow(/read-only/)
    const sent = log.flatMap((l) => l.calls.map((c) => c.text))
    expect(sent.filter((t) => /UPDATE|DELETE/.test(t))).toEqual([])
    expect(log.at(-1)?.outcome).toBe('rollback')
  })

  it('isWriteShaped reads writes at the start or inside a WITH, and leaves reads alone', () => {
    for (const w of [
      'INSERT INTO t (a) VALUES ($1)',
      ' update t set a = 1',
      'DELETE FROM t',
      'MERGE INTO t USING s ON true WHEN MATCHED THEN DELETE',
      'WITH x AS (UPDATE t SET a = 1 RETURNING id) SELECT * FROM x',
      'WITH x AS (INSERT INTO t (a) VALUES (1) RETURNING id) SELECT * FROM x',
    ]) {
      expect(isWriteShaped(w), w).toBe(true)
    }
    for (const r of ['SELECT id, updated_at FROM t', 'WITH x AS (SELECT 1) SELECT * FROM x', 'VALUES (1)', 'SELECT deleted_at FROM t']) {
      expect(isWriteShaped(r), r).toBe(false)
    }
  })
})

describe('tenantDb: off by default', () => {
  it('is off unless the flag is exactly "true"', () => {
    expect(isTenantDbEnabled({})).toBe(false)
    expect(isTenantDbEnabled({ [TENANT_DB_FLAG]: '1' })).toBe(false)
    expect(isTenantDbEnabled({ [TENANT_DB_FLAG]: 'TRUE' })).toBe(false)
    expect(isTenantDbEnabled({ [TENANT_DB_FLAG]: 'true' })).toBe(true)
  })

  it('refuses to run with the flag off, even with a driver registered', async () => {
    setTenantDbDriver(fakeDriver().driver)
    await expect(tenantDb(CANARY, { env: {} }).sql`SELECT 1`).rejects.toThrow(/is off/)
  })

  it('with the flag on, no driver registered and no TENANT_DATABASE_URL, refuses: no fallback to the service-role keys', async () => {
    const env = {
      [TENANT_DB_FLAG]: 'true',
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SECRET_KEY: 'sb_secret_placeholder',
    }
    await expect(tenantDb(CANARY, { env }).sql`SELECT 1`).rejects.toThrow(/TENANT_DATABASE_URL is not set/)
    await expect(tenantDb(CANARY, { env: { ...env, TENANT_DATABASE_URL: '  ' } }).sql`SELECT 1`).rejects.toThrow(
      /TENANT_DATABASE_URL is not set/,
    )
  })

  it('runs through the registered driver when the flag is on', async () => {
    const { driver, log } = fakeDriver()
    setTenantDbDriver(driver)
    await tenantDb(CANARY, { env: { [TENANT_DB_FLAG]: 'true' } }).sql`SELECT 1`
    expect(log).toHaveLength(1)
  })
})

describe('tenantDb: matches the database and stays allow-listed', () => {
  it('uses the role and setting the migration and the pgTAP matrix use', () => {
    expect(TENANT_ROLE).toBe(PGTAP_ROLE)
    expect(TENANT_SETTING).toBe(PGTAP_SETTING)
    const migration = readFileSync('supabase/migrations/20261104200000_tenant_isolation_policies.sql', 'utf8')
    expect(migration).toContain(`CREATE ROLE ${TENANT_ROLE} NOLOGIN NOINHERIT NOBYPASSRLS`)
    expect(migration).toContain(`current_setting('${TENANT_SETTING}', true)`)
  })

  it('finds every way of reaching lib/tenancy/db, from anywhere in the repo (review finding, S4)', () => {
    // The reviewer's probes, plus the other spellings: none may slip past.
    const probes: Record<string, string> = {
      'lib/zzprobe/evil.ts': "import { tenantDb } from '../tenancy/db'",
      'lib/zzprobe/evil2.ts': "import { tenantDb } from '@/lib/tenancy/db.ts'",
      'lib/zzprobe/evil3.ts': "const { tenantDb } = require('../tenancy/db.js')",
      'lib/zzprobe/evil4.ts': "export * from '../tenancy/db'",
      'lib/zzprobe/evil5.ts': "const m = await import('@/lib/tenancy/db')",
      'lib/zzprobe/evil6.ts': "import '../../lib/tenancy/db'",
      'lib/tenancy/sub/evil7.ts': "import { stellrDb } from '../db'",
      'e2e/evil8.spec.ts': "import { tenantDb } from '../lib/tenancy/db'",
      'test/evil9.test.ts': "vi.mock('@/lib/tenancy/db', () => ({}))",
      'app/api/evil10/route.ts': "import * as t from '@/lib/tenancy/db/index'",
      'lib/zzprobe/evil11.ts': "const { tenantDb: run } = await import(`@/lib/tenancy/${'db'}`)",
      'lib/zzprobe/evil12.ts': "const sql = tenantSql`SELECT 1`",
    }
    const found = tenantDbImporters(Object.entries(probes).map(([path, src]) => ({ path, src })))
    expect(found).toEqual(Object.keys(probes).sort())
    // Things that are not importers.
    const clean = [
      { path: 'lib/tenancy/db-callers.ts', src: "// Every file that imports lib/tenancy/db is named here\nexport const X = ['lib/tenancy/db.test.ts']" },
      { path: 'lib/other/db.ts', src: 'export const x = 1' },
      { path: 'lib/other/use.ts', src: "import { x } from './db'" },
      { path: 'lib/tenancy/tenant-id.ts', src: "throw new Error('tenantDb needs a tenant id')" },
      { path: 'lib/tenancy/x.ts', src: "import { y } from './db-callers'" },
    ]
    expect(tenantDbImporters(clean)).toEqual([])
  })

  it('is imported only by the files in lib/tenancy/db-callers.ts (whole repo: app, lib, test, e2e, scripts, …)', () => {
    const skip = new Set(['node_modules', '.next', '.git', 'coverage', 'storybook-static', 'dist', 'out', '.vercel', 'playwright-report', 'test-results', '.stryker-tmp', 'reports'])
    const files: { path: string; src: string }[] = []
    const walk = (p: string) => {
      let st
      try {
        st = statSync(p)
      } catch {
        return
      }
      if (st.isDirectory()) {
        if (skip.has(p.split('/').pop() as string)) return
        for (const f of readdirSync(p)) walk(p === '.' ? f : join(p, f))
      } else if (/\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(p)) files.push({ path: p, src: readFileSync(p, 'utf8') })
    }
    walk('.')
    expect(files.length).toBeGreaterThan(500)
    expect(tenantDbImporters(files)).toEqual([...TENANT_DB_CALLERS].sort())
    // The area switch (C12) hands out a tenantDb, so whoever reaches it is listed too.
    const viaSwitch = areaSwitchImporters(files)
    expect(viaSwitch).toContain('lib/tenancy/area-switch.test.ts')
    expect(viaSwitch.filter((f) => !TENANT_DB_CALLERS.includes(f))).toEqual([])
    // Its test seams (environment, tenant database, mismatch sink) are for tests alone.
    expect(seamCallersOutsideTests(files)).toEqual([])
  })

  it('finds a non-test caller of the area switch’s test seams (C12 review)', () => {
    const probes = [
      { path: 'app/api/x/route.ts', src: "import { readAreaWithSeams } from '@/lib/tenancy/area-switch'" },
      { path: 'lib/x/a.ts', src: 'return writeAreaWithSeams(area, opts)' },
      { path: 'lib/x/b.ts', src: "const { readAreaWithSeams: r } = await import('@/lib/tenancy/area-switch')" },
    ]
    expect(seamCallersOutsideTests(probes)).toEqual(['app/api/x/route.ts', 'lib/x/a.ts', 'lib/x/b.ts'])
    const tests = [
      { path: 'lib/tenancy/area-switch.test.ts', src: 'readAreaWithSeams(' },
      { path: 'test/integration/two-tenant/kit.int.test.ts', src: 'readAreaWithSeams(' },
      { path: 'lib/tenancy/area-switch.ts', src: 'export async function readAreaWithSeams(' },
    ]
    expect(seamCallersOutsideTests(tests)).toEqual([])
  })

  it('finds every way of reaching lib/tenancy/area-switch (C12)', () => {
    const probes: Record<string, string> = {
      'app/api/x/route.ts': "import { readArea } from '@/lib/tenancy/area-switch'",
      'lib/x/a.ts': "import { writeArea } from '../tenancy/area-switch.ts'",
      'lib/tenancy/b.ts': "export * from './area-switch'",
      'lib/x/c.ts': "const m = await import('@/lib/tenancy/area-switch')",
      'test/d.test.ts': "vi.mock('@/lib/tenancy/area-switch', () => ({}))",
      'lib/x/e.ts': "const { readArea } = await import(`@/lib/tenancy/${name}`)",
      'lib/x/f.ts': 'return readArea<Row[]>(area, opts)',
    }
    expect(areaSwitchImporters(Object.entries(probes).map(([path, src]) => ({ path, src })))).toEqual(Object.keys(probes).sort())
    expect(areaSwitchImporters([{ path: 'lib/x/g.ts', src: "import { dataPath } from './area-switch-docs'" }])).toEqual([])
  })
})

/**
 * Files that reach lib/tenancy/db: any import / export-from / import() /
 * require() / vi.mock() specifier that resolves to it (relative from the
 * file's own folder, or through the "@/" alias, with or without an extension
 * or /index), plus — as a backstop for specifiers built at run time — any
 * file outside lib/tenancy/db.ts that calls its API by name.
 */
function tenantDbImporters(files: { path: string; src: string }[]): string[] {
  const api = /\b(?:tenantDb|stellrDb|setTenantDbDriver)\s*\(|\btenantSql\s*`|\{[^}]*\b(?:tenantDb|stellrDb|setTenantDbDriver|tenantSql)\b[^}]*\}\s*=\s*(?:await\s+)?(?:import|require)\b|tenancy\/\$\{/
  return importersOf(files, 'lib/tenancy/db', api)
}

/**
 * Files that reach lib/tenancy/area-switch (C12), the same way. It hands its
 * callers a tenantDb for any tenant id, so its importers are held to the same
 * allow-list: otherwise a file could reach tenantDb through it unlisted.
 */
function areaSwitchImporters(files: { path: string; src: string }[]): string[] {
  const api =
    /\b(?:readArea|writeArea)(?:WithSeams)?\s*(?:<[^>]*>)?\s*\(|\{[^}]*\b(?:readArea|writeArea)(?:WithSeams)?\b[^}]*\}\s*=\s*(?:await\s+)?(?:import|require)\b/
  return importersOf(files, 'lib/tenancy/area-switch', api)
}

/**
 * Files outside the tests that name readAreaWithSeams or writeAreaWithSeams.
 * Those take the environment, the tenant database and the mismatch sink as
 * options; a production caller must use readArea / writeArea, which follow
 * the server's own TENANT_DB_* flags.
 */
function seamCallersOutsideTests(files: { path: string; src: string }[]): string[] {
  const isTest = (p: string) => /\.test\.tsx?$/.test(p) || p.startsWith('test/')
  return files
    .map((f) => ({ ...f, path: f.path.replace(/\\/g, '/') }))
    .filter((f) => f.path !== 'lib/tenancy/area-switch.ts' && !isTest(f.path) && /\b(?:readArea|writeArea)WithSeams\b/.test(f.src))
    .map((f) => f.path)
    .sort()
}

function importersOf(files: { path: string; src: string }[], TARGET: string, api: RegExp): string[] {
  const spec = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*|\bvi\.(?:mock|doMock|importActual)\s*\(\s*)['"`]([^'"`]+)['"`]/g
  const resolveSpec = (from: string, s: string): string | null => {
    let p: string
    if (s.startsWith('@/')) p = s.slice(2)
    else if (s.startsWith('./') || s.startsWith('../')) p = join(dirname(from), s)
    else return null
    return normalize(p)
      .replace(/\\/g, '/')
      .replace(/\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/, '')
      .replace(/\/index$/, '')
  }
  const out = new Set<string>()
  for (const f of files) {
    const path = f.path.replace(/\\/g, '/')
    if (path === `${TARGET}.ts`) continue
    for (const m of f.src.matchAll(spec)) if (resolveSpec(path, m[1]) === TARGET) out.add(path)
    if (api.test(f.src)) out.add(path)
  }
  return [...out].sort()
}
