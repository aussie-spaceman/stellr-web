// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// postgres.js stood in for: it records what the driver asks of it and behaves
// like Postgres for the pin (SET LOCAL ROLE and set_config(..., true) last for
// the transaction; the read-back reports them). The real thing runs in CI's
// tenant-db job (test/integration/tenant-db.int.test.ts).
const pg = vi.hoisted(() => {
  const state = {
    pools: [] as {
      url: unknown
      options: Record<string, unknown>
      log: string[]
      unsafeOptions: unknown[]
      ended: boolean
    }[],
    rows: [] as Record<string, unknown>[],
  }
  // The driver is expected to call postgres(options) with no URL string, so
  // the host postgres.js dials is the host the driver checked.
  const factory = (a: unknown, b?: Record<string, unknown>) => {
    const options = (typeof a === 'string' ? b : (a as Record<string, unknown>)) ?? {}
    const pool = { url: a, options, log: [] as string[], unsafeOptions: [] as unknown[], ended: false }
    state.pools.push(pool)
    return {
      async begin(cb: (t: unknown) => unknown) {
        pool.log.push('BEGIN')
        let role = 'tenant_app_login'
        let tenant: string | null = null
        const t = {
          async unsafe(text: string, values: unknown[] = [], unsafeOptions?: unknown) {
            pool.log.push(values.length ? `${text} ${JSON.stringify(values)}` : text)
            pool.unsafeOptions.push(unsafeOptions)
            let rows: Record<string, unknown>[] = state.rows
            if (/^SET LOCAL ROLE /.test(text)) {
              role = text.slice('SET LOCAL ROLE '.length)
              rows = []
            } else if (/set_config\('stellr\.tenant_id', \$1, true\)/.test(text)) {
              tenant = String(values[0])
              rows = []
            } else if (/current_user AS role/.test(text)) rows = [{ role, tenant }]
            return Object.assign([...rows], { count: rows.length })
          },
        }
        try {
          const out = await cb(t)
          pool.log.push('COMMIT')
          return out
        } catch (e) {
          pool.log.push('ROLLBACK')
          throw e
        }
      },
      async end() {
        pool.ended = true
      },
    }
  }
  return { state, factory: vi.fn(factory) }
})
vi.mock('postgres', () => ({ default: pg.factory }))

import {
  createPostgresTenantDriver,
  endTenantDrivers,
  parsePostgresUrl,
  parseTenantDatabaseUrl,
  tenantDriverFromEnv,
  TENANT_POOL_DEFAULTS,
} from './driver'
import { setTenantDbDriver, tenantDb, TenantContextError, TENANT_DB_FLAG } from './db'

const CANARY = 'c0ffee00-0000-4000-8000-0000000000b2'
const POOLER = 'postgres://tenant_app_login.abcdefghijklmnop:pw-not-real@aws-0-us-east-1.pooler.supabase.com:6543/postgres'
const LOCAL = 'postgres://tenant_app_login:pw-not-real@127.0.0.1:54322/postgres'

beforeEach(() => {
  pg.state.pools.length = 0
  pg.state.rows = []
  pg.factory.mockClear()
  setTenantDbDriver(null)
})
afterEach(async () => {
  await endTenantDrivers()
})

describe('parseTenantDatabaseUrl: fails closed, never echoes the URL', () => {
  it.each([undefined, '', '   '])('refuses a missing URL (%j)', (raw) => {
    expect(() => parseTenantDatabaseUrl(raw)).toThrow(/TENANT_DATABASE_URL is not set/)
  })

  it.each([
    ['not a URL', 'not a url at all', /not a valid connection URL/],
    ['another scheme', 'https://tenant_app_login:pw@example.com/db', /must be a postgres:\/\/ URL/],
    ['the owner login', 'postgres://postgres:pw-not-real@db.example.supabase.co:5432/postgres', /must connect as tenant_app_login/],
    ['the pooler owner login', 'postgres://postgres.abcdefghijklmnop:pw-not-real@pooler.example.com:6543/postgres', /must connect as tenant_app_login/],
    ['a service login', 'postgres://service_role:pw-not-real@db.example.com:5432/postgres', /must connect as tenant_app_login/],
    ['a lookalike login', 'postgres://tenant_app_login_admin:pw-not-real@db.example.com:5432/postgres', /must connect as tenant_app_login/],
    ['no user', 'postgres://db.example.com:5432/postgres', /must connect as tenant_app_login/],
  ])('refuses %s', (_label, raw, why) => {
    let err: unknown
    try {
      parseTenantDatabaseUrl(raw)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(TenantContextError)
    expect(String((err as Error).message)).toMatch(why)
    expect(String((err as Error).message)).not.toContain('pw-not-real')
    expect(String((err as Error).message)).not.toContain('example')
  })

  it.each([
    // WHATWG reads the user and host from one side of the authority; a
    // postgres.js-style parse reads them from the other. Neither reading is
    // trusted: the authority must be unambiguous.
    ['two @ signs', 'postgres://tenant_app_login:a@db.remote.example,x@localhost:5432/postgres'],
    ['two @ signs, no comma', 'postgres://tenant_app_login:a@db.remote.example@127.0.0.1:5432/postgres'],
    ['a host list', 'postgres://tenant_app_login:pw-not-real@db.remote.example,127.0.0.1:5432/postgres'],
    ['an encoded host', 'postgres://tenant_app_login:pw-not-real@local%68ost:5432/postgres'],
  ])('refuses an ambiguous authority: %s', (_label, raw) => {
    let err: unknown
    try {
      parseTenantDatabaseUrl(raw)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(TenantContextError)
    expect(String((err as Error).message)).toMatch(/one user and one host/)
    expect(String((err as Error).message)).not.toContain('pw-not-real')
    expect(String((err as Error).message)).not.toContain('remote')
  })

  it.each([
    ['a startup parameter', `?options=-c%20search_path%3Dx`],
    ['an ssl override', `?ssl=disable`],
    ['a host override', `?host=db.remote.example`],
  ])('refuses query parameters other than sslmode: %s', (_label, query) => {
    expect(() =>
      parseTenantDatabaseUrl(`postgres://tenant_app_login:pw-not-real@127.0.0.1:54322/postgres${query}`),
    ).toThrow(/only sslmode/)
  })

  it('accepts the login, plain or as the pooler spells it', () => {
    expect(parseTenantDatabaseUrl(POOLER)).toMatchObject({ local: false, verifyFull: false })
    expect(parseTenantDatabaseUrl(LOCAL)).toMatchObject({ local: true })
    expect(parseTenantDatabaseUrl(`${POOLER}?sslmode=verify-full`)).toMatchObject({ verifyFull: true })
  })
})

describe('parsePostgresUrl: the same checks for another connection (the two-tenant kit’s owner URL, C12 review)', () => {
  const NAME = 'TENANT_DB_TEST_ADMIN_URL'

  it.each([
    ['two @ signs with a host list', 'postgres://u@db.remote.example,x@localhost/db', /one user and one host/],
    ['two @ signs', 'postgres://postgres:a@db.remote.example@127.0.0.1:54322/postgres', /one user and one host/],
    ['a host list', 'postgres://postgres:pw-not-real@db.remote.example,127.0.0.1:54322/postgres', /one user and one host/],
    ['a startup parameter', 'postgres://postgres:pw-not-real@127.0.0.1:54322/postgres?options=-c%20role%3Dx', /only sslmode/],
  ])('refuses %s, naming the variable and not the URL', (_label, raw, why) => {
    let err: unknown
    try {
      parsePostgresUrl(raw, NAME)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(TenantContextError)
    expect(String((err as Error).message)).toMatch(why)
    expect(String((err as Error).message)).toContain(NAME)
    expect(String((err as Error).message)).not.toMatch(/pw-not-real|remote/)
  })

  it('accepts a local owner login and returns the parts a caller connects with', () => {
    expect(parsePostgresUrl('postgres://postgres:pw-not-real@127.0.0.1:54322/postgres', NAME)).toMatchObject({
      host: '127.0.0.1',
      port: 54322,
      user: 'postgres',
      password: 'pw-not-real',
      database: 'postgres',
      local: true,
    })
    expect(parsePostgresUrl('postgres://postgres:pw-not-real@db.example.com:5432/postgres', NAME).local).toBe(false)
  })

  it('leaves the tenant URL’s own rules unchanged: parseTenantDatabaseUrl still refuses the owner login', () => {
    expect(() => parseTenantDatabaseUrl('postgres://postgres:pw-not-real@127.0.0.1:54322/postgres')).toThrow(/must connect as tenant_app_login/)
  })
})

describe('createPostgresTenantDriver', () => {
  it('opens nothing until the first transaction is asked for, and then uses transaction-mode settings', () => {
    createPostgresTenantDriver(POOLER)
    expect(pg.factory).toHaveBeenCalledTimes(1)
    const options = pg.state.pools[0].options
    expect(options).toMatchObject({
      prepare: false,
      max: TENANT_POOL_DEFAULTS.max,
      idle_timeout: TENANT_POOL_DEFAULTS.idleTimeoutSeconds,
      connect_timeout: TENANT_POOL_DEFAULTS.connectTimeoutSeconds,
      max_lifetime: TENANT_POOL_DEFAULTS.maxLifetimeSeconds,
      ssl: 'require',
      debug: false,
    })
    expect(typeof options.onnotice).toBe('function')
    expect(pg.state.pools[0].log).toEqual([])
  })

  it('hands postgres.js the checked parts, never the raw connection string', () => {
    createPostgresTenantDriver(POOLER)
    createPostgresTenantDriver('postgres://tenant_app_login:pw%40not%2Creal@LOCALHOST/tenant%20db')
    const [pooler, local] = pg.state.pools
    expect(typeof pooler.url).not.toBe('string')
    expect(typeof local.url).not.toBe('string')
    expect(pooler.options).toMatchObject({
      host: 'aws-0-us-east-1.pooler.supabase.com',
      port: 6543,
      user: 'tenant_app_login.abcdefghijklmnop',
      pass: 'pw-not-real',
      database: 'postgres',
      ssl: 'require',
    })
    expect(local.options).toMatchObject({ host: 'localhost', port: 5432, pass: 'pw@not,real', database: 'tenant db', ssl: false })
  })

  it('refuses an IPv6 literal host, which postgres.js would split on its colons', () => {
    expect(() => createPostgresTenantDriver('postgres://tenant_app_login:pw@[::1]:54322/postgres')).toThrow(
      /by name or IPv4 address/,
    )
    expect(pg.factory).not.toHaveBeenCalled()
  })

  it('drops server notices without printing them', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    try {
      createPostgresTenantDriver(LOCAL)
      const onnotice = pg.state.pools[0].options.onnotice as (n: unknown) => void
      onnotice({ severity: 'NOTICE', message: 'notice text' })
      for (const spy of [log, warn, error, info]) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of [log, warn, error, info]) spy.mockRestore()
    }
  })

  it('sends every statement on the extended protocol, values or not, so the server runs one statement at a time', async () => {
    const driver = createPostgresTenantDriver(LOCAL)
    await driver.transaction(async (tx) => {
      await tx.query('SELECT 1')
      await tx.query('SELECT $1::text', ['x'])
    })
    expect(pg.state.pools[0].unsafeOptions).toEqual([
      { prepare: false, simple: false },
      { prepare: false, simple: false },
    ])
  })

  it('requires TLS off this machine, checks the chain on sslmode=verify-full, and skips it on localhost', () => {
    createPostgresTenantDriver(`${POOLER}?sslmode=verify-full`)
    createPostgresTenantDriver(LOCAL, { max: 1 })
    expect(pg.state.pools.map((p) => p.options.ssl)).toEqual(['verify-full', false])
    expect(pg.state.pools[1].options.max).toBe(1)
  })

  it('refuses a bad URL before creating a pool', () => {
    expect(() => createPostgresTenantDriver('postgres://postgres:pw@db.example.com/postgres')).toThrow(TenantContextError)
    expect(pg.factory).not.toHaveBeenCalled()
  })

  it('runs each statement inside BEGIN/COMMIT with its values bound, and reports rows and count', async () => {
    pg.state.rows = [{ id: 'a' }, { id: 'b' }]
    const driver = createPostgresTenantDriver(LOCAL)
    const out = await driver.transaction((tx) => tx.query('SELECT id FROM public.events WHERE slug = $1', ['ev']))
    expect(out).toEqual({ rows: [{ id: 'a' }, { id: 'b' }], rowCount: 2 })
    expect(pg.state.pools[0].log).toEqual(['BEGIN', 'SELECT id FROM public.events WHERE slug = $1 ["ev"]', 'COMMIT'])
  })

  it('rolls back when the work throws, and passes the error on', async () => {
    const driver = createPostgresTenantDriver(LOCAL)
    await expect(
      driver.transaction(async (tx) => {
        await tx.query('DELETE FROM public.event_settings WHERE event_slug = $1', ['ev'])
        throw new Error('caller failed')
      }),
    ).rejects.toThrow('caller failed')
    expect(pg.state.pools[0].log.at(-1)).toBe('ROLLBACK')
  })
})

describe('tenantDriverFromEnv', () => {
  it('keeps one pool per URL per instance', () => {
    const a = tenantDriverFromEnv({ TENANT_DATABASE_URL: LOCAL })
    const b = tenantDriverFromEnv({ TENANT_DATABASE_URL: LOCAL })
    expect(a).toBe(b)
    expect(pg.factory).toHaveBeenCalledTimes(1)
  })

  it('closes its pools', async () => {
    tenantDriverFromEnv({ TENANT_DATABASE_URL: LOCAL })
    await endTenantDrivers()
    expect(pg.state.pools[0].ended).toBe(true)
  })
})

describe('tenantDb over the Postgres driver', () => {
  it('with the flag off, never creates a pool, even with a URL set', async () => {
    await expect(tenantDb(CANARY, { env: { TENANT_DATABASE_URL: LOCAL } }).sql`SELECT 1`).rejects.toThrow(/is off/)
    await expect(
      tenantDb(CANARY, { env: { [TENANT_DB_FLAG]: 'TRUE', TENANT_DATABASE_URL: LOCAL } }).sql`SELECT 1`,
    ).rejects.toThrow(/is off/)
    expect(pg.factory).not.toHaveBeenCalled()
  })

  it('with the flag on and no URL, refuses without creating a pool', async () => {
    await expect(tenantDb(CANARY, { env: { [TENANT_DB_FLAG]: 'true' } }).sql`SELECT 1`).rejects.toThrow(
      /TENANT_DATABASE_URL is not set/,
    )
    expect(pg.factory).not.toHaveBeenCalled()
  })

  it('with the flag on and a refused URL, refuses without creating a pool', async () => {
    const env = { [TENANT_DB_FLAG]: 'true', TENANT_DATABASE_URL: 'postgres://postgres:pw@db.example.com:5432/postgres' }
    await expect(tenantDb(CANARY, { env }).sql`SELECT 1`).rejects.toThrow(/must connect as tenant_app_login/)
    expect(pg.factory).not.toHaveBeenCalled()
  })

  it('with the flag on and the URL set, pins the tenant in one transaction and returns the rows', async () => {
    pg.state.rows = [{ slug: 'ev-a' }]
    const env = { [TENANT_DB_FLAG]: 'true', TENANT_DATABASE_URL: LOCAL }
    const rows = await tenantDb(CANARY, { env }).sql`SELECT slug FROM public.events WHERE slug = ${'ev-a'}`
    expect(rows).toEqual([{ slug: 'ev-a' }])
    expect(pg.factory).toHaveBeenCalledTimes(1)
    expect(pg.state.pools[0].log).toEqual([
      'BEGIN',
      'SET LOCAL ROLE tenant_app',
      `SELECT set_config('stellr.tenant_id', $1, true) ["${CANARY}"]`,
      'SELECT current_user AS role, public.app_tenant_id()::text AS tenant',
      'SELECT slug FROM public.events WHERE slug = $1 ["ev-a"]',
      'SELECT current_user AS role, public.app_tenant_id()::text AS tenant',
      'COMMIT',
    ])
  })

  it('a registered driver still wins over the environment', async () => {
    const calls: string[] = []
    setTenantDbDriver({
      transaction: (fn) =>
        fn({
          async query(text) {
            calls.push(text)
            return { rows: /current_user AS role/.test(text) ? [{ role: 'tenant_app', tenant: CANARY } as never] : [], rowCount: 0 }
          },
        }),
    })
    await tenantDb(CANARY, { env: { [TENANT_DB_FLAG]: 'true', TENANT_DATABASE_URL: LOCAL } }).sql`SELECT 1`
    expect(calls).toContain('SELECT 1')
    expect(pg.factory).not.toHaveBeenCalled()
  })
})
