// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
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
function fakeDriver(opts: { broken?: 'role' | 'tenant'; rows?: Record<string, unknown>[] } = {}) {
  const log: { calls: Call[]; outcome: 'commit' | 'rollback' }[] = []
  const driver: TenantSqlDriver = {
    async transaction(fn) {
      const calls: Call[] = []
      let role = 'session_user'
      let tenant: string | null = null
      const tx: TenantSqlTx = {
        async query(text, values) {
          calls.push({ text, values })
          if (/^SET LOCAL ROLE /.test(text)) role = opts.broken === 'role' ? 'postgres' : text.slice('SET LOCAL ROLE '.length)
          else if (/set_config\('stellr\.tenant_id', \$1, true\)/.test(text)) tenant = opts.broken === 'tenant' ? null : String(values?.[0])
          else if (/current_user AS role/.test(text)) return { rows: [{ role, tenant } as never], rowCount: 1 }
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
      'UPDATE public.event_settings SET company_count = $1 WHERE event_slug = $2',
    ])
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
  ])('refuses %j', async (sql) => {
    expect(refusedSql(sql)).not.toBeNull()
    const strings = Object.assign([sql], { raw: [sql] }) as unknown as TemplateStringsArray
    expect(() => tenantSql(strings)).toThrow(TenantContextError)
    const { driver, log } = fakeDriver()
    await expect(tenantDb(CANARY, { driver }).transaction((q) => q.run({ text: sql, values: [] }))).rejects.toThrow(/refused the SQL/)
    expect(log[0].outcome).toBe('rollback')
  })

  it.each([
    'SELECT id FROM public.registrations WHERE id = $1',
    'select 1',
    '  WITH x AS (SELECT 1) SELECT * FROM x',
    'INSERT INTO public.event_settings (event_slug) VALUES ($1)',
    "UPDATE public.tenant_memberships SET role = 'staff' WHERE id = $1",
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

  it('refuses to run with the flag on but no driver registered (nothing in the app registers one yet)', async () => {
    await expect(tenantDb(CANARY, { env: { [TENANT_DB_FLAG]: 'true' } }).sql`SELECT 1`).rejects.toThrow(/no database driver/)
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

  it('is imported only by the files in lib/tenancy/db-callers.ts', () => {
    const roots = ['app', 'components', 'lib', 'packages', 'scripts', 'proxy.ts', 'instrumentation.ts']
    const files: string[] = []
    const walk = (p: string) => {
      let st
      try {
        st = statSync(p)
      } catch {
        return
      }
      if (st.isDirectory()) {
        if (p.endsWith('node_modules') || p.endsWith('.next')) return
        for (const f of readdirSync(p)) walk(join(p, f))
      } else if (/\.(?:ts|tsx|mts|js|mjs|cjs)$/.test(p)) files.push(p)
    }
    for (const r of roots) walk(r)
    const importers = files
      .filter((f) => !f.endsWith(join('lib', 'tenancy', 'db.ts')))
      .filter((f) => /from\s+['"](?:@\/lib\/tenancy\/db|\.{1,2}\/(?:[\w.-]+\/)*db)['"]|import\(\s*['"]@\/lib\/tenancy\/db['"]\s*\)/.test(readFileSync(f, 'utf8')))
      .filter((f) => {
        const src = readFileSync(f, 'utf8')
        // A relative "./db" only counts inside lib/tenancy.
        return /@\/lib\/tenancy\/db['"]/.test(src) || relative('lib/tenancy', f).split('/').length === 1
      })
      .map((f) => relative('.', f))
      .sort()
    expect(importers).toEqual([...TENANT_DB_CALLERS].sort())
  })
})
