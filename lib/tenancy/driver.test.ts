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

// The real X509Certificate, counted, so a test can see how often the CA is parsed.
const x509 = vi.hoisted(() => ({ parsed: 0 }))
vi.mock('node:crypto', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:crypto')>()
  class CountedX509Certificate extends real.X509Certificate {
    constructor(...args: ConstructorParameters<typeof real.X509Certificate>) {
      super(...args)
      x509.parsed++
    }
  }
  return { ...real, default: real, X509Certificate: CountedX509Certificate }
})

// The 'TENANTDB config' row (O3): lib/after-response and lib/app-errors are
// stood in for, so a refusal's row is recorded here instead of written.
const rows = vi.hoisted(() => ({ written: [] as { route: string; message: string; digest: string }[], tasks: [] as Promise<unknown>[] }))
vi.mock('@/lib/after-response', () => ({
  runAfterResponse: (_label: string, task: () => Promise<unknown>) => void rows.tasks.push(task()),
}))
vi.mock('@/lib/app-errors', () => ({
  routeLabel: (method: string, routePath: string) => `${method} ${routePath}`,
  errorDigest: (route: string, message: string) => `digest:${route}:${message}`,
  recordBuiltAppError: async (route: string, message: string, digest: string) => {
    rows.written.push({ route, message, digest })
    return true
  },
}))

import {
  createPostgresTenantDriver,
  endTenantDrivers,
  parsePostgresUrl,
  parseTenantCaCert,
  parseTenantDatabaseUrl,
  resetTenantDbConfigRow,
  TENANT_APPLICATION_NAME,
  tenantDbConfigMessage,
  tenantDbConfigStatus,
  TenantDbConfigError,
  tenantDriverFromEnv,
  tenantTlsOptions,
  TENANT_POOL_DEFAULTS,
} from './driver'
import { errorCodeOf } from './area-switch'
import { setTenantDbDriver, tenantDb, TenantContextError, TENANT_DB_FLAG } from './db'

const CANARY = 'c0ffee00-0000-4000-8000-0000000000b2'
const POOLER = 'postgres://tenant_app_login.abcdefghijklmnop:pw-not-real@aws-0-us-east-1.pooler.supabase.com:6543/postgres'
const POOLER_VF = `${POOLER}?sslmode=verify-full`
const LOCAL = 'postgres://tenant_app_login:pw-not-real@127.0.0.1:54322/postgres'

// A throwaway self-signed root made for these tests (CA:TRUE; its key was
// discarded). Public test material, like any root certificate.
const TEST_CA = `-----BEGIN CERTIFICATE-----
MIIBgjCCASigAwIBAgIUALfgo5LYX5L0C3UWJPyP7b0uS08wCgYIKoZIzj0EAwIw
HjEcMBoGA1UEAwwTc3RlbGxyLXRlc3Qtcm9vdC1jYTAgFw0yNjExMTAxNTM1NTNa
GA8yMTI2MTAxNzE1MzU1M1owHjEcMBoGA1UEAwwTc3RlbGxyLXRlc3Qtcm9vdC1j
YTBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABA0xyYAYw+X/pdt8y4KvJM30LISZ
bj1pDUsSG+WBai7YkxDcO34BUY248lJFBy770jim37+3IdyaClHH/2wI8mWjQjBA
MB0GA1UdDgQWBBTNi5qtSkN1FNswBXKqpxSSXht35zAPBgNVHRMBAf8EBTADAQH/
MA4GA1UdDwEB/wQEAwIBBjAKBggqhkjOPQQDAgNIADBFAiBJ1s59a959QUA5MjTt
Nc9/XyTikoqN6z/yEPa9ipIQZwIhALMguIhzXmmwVL4G1MGd3fv2kqAVQw9tDRxr
qwTU41My
-----END CERTIFICATE-----
`
// A throwaway self-signed server certificate (CA:FALSE), which must be refused as the CA.
const TEST_LEAF = `-----BEGIN CERTIFICATE-----
MIIBZzCCAQ2gAwIBAgIUKGvHsUKj6kpEDOJiZGcLcfTaT4kwCgYIKoZIzj0EAwIw
GjEYMBYGA1UEAwwPZGIuZXhhbXBsZS50ZXN0MCAXDTI2MTExMDE1MzU1M1oYDzIx
MjYxMDE3MTUzNTUzWjAaMRgwFgYDVQQDDA9kYi5leGFtcGxlLnRlc3QwWTATBgcq
hkjOPQIBBggqhkjOPQMBBwNCAARKX7Dmraj08Q6k1trNreoe0urcfuFoniBssGAT
ToxHGbOdHH7bvpF2vYAJmtl+OkhFphaQ+l2VEjjf0V3vMtMloy8wLTAdBgNVHQ4E
FgQUNeOXhyTlrN/tndIakzJ+bC99s5gwDAYDVR0TAQH/BAIwADAKBggqhkjOPQQD
AgNIADBFAiA9G7nIKVaNQ26KgPpp2HooQ/cGYgWUUxV0w/pOTOwxfwIhAMbnP1YJ
fwR7M47r0Gw/MsJUCk+Wxwz1Ewka8adXvndC
-----END CERTIFICATE-----
`
const VERIFIED_SSL = {
  ca: TEST_CA,
  rejectUnauthorized: true,
  servername: 'aws-0-us-east-1.pooler.supabase.com',
  minVersion: 'TLSv1.2',
}

/** The error a thunk throws, so its message can be checked for leaks. */
function thrown(fn: () => unknown): Error {
  try {
    fn()
  } catch (e) {
    return e as Error
  }
  throw new Error('expected a throw')
}

beforeEach(() => {
  pg.state.pools.length = 0
  pg.state.rows = []
  pg.factory.mockClear()
  setTenantDbDriver(null)
  rows.written.length = 0
  rows.tasks.length = 0
  resetTenantDbConfigRow()
})

/** Let the dynamic imports and the registered task settle. */
async function settled(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 0))
    await Promise.all(rows.tasks)
  }
}
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
    expect(parseTenantDatabaseUrl(POOLER_VF)).toMatchObject({ local: false, sslmode: 'verify-full', verifyFull: true })
    expect(parseTenantDatabaseUrl(LOCAL)).toMatchObject({ local: true, sslmode: null })
  })
})

describe('TLS for a host that is not this machine: sslmode=verify-full and the root CA, or refused (owner decision, 10 Nov 2026)', () => {
  it.each([
    ['no sslmode', POOLER],
    ['sslmode=require', `${POOLER}?sslmode=require`],
    ['sslmode=prefer', `${POOLER}?sslmode=prefer`],
    ['sslmode=allow', `${POOLER}?sslmode=allow`],
    ['sslmode=disable', `${POOLER}?sslmode=disable`],
    ['sslmode=verify-ca', `${POOLER}?sslmode=verify-ca`],
    ['sslmode=VERIFY-FULL (libpq is case-sensitive)', `${POOLER}?sslmode=VERIFY-FULL`],
    ['an empty sslmode', `${POOLER}?sslmode=`],
    ['a non-local IPv4 host with sslmode=require', 'postgres://tenant_app_login:pw-not-real@10.0.0.5:5432/postgres?sslmode=require'],
  ])('refuses %s, naming the rule and not the URL', (_label, raw) => {
    const err = thrown(() => parseTenantDatabaseUrl(raw))
    expect(err).toBeInstanceOf(TenantContextError)
    expect(err.message).toMatch(/must end in \?sslmode=verify-full/)
    expect(err.message).not.toMatch(/pw-not-real|pooler|supabase|abcdefghijklmnop/)
  })

  it('refuses sslmode given twice, whichever comes first', () => {
    expect(() => parseTenantDatabaseUrl(`${POOLER}?sslmode=require&sslmode=verify-full`)).toThrow(/sslmode once/)
    expect(() => parseTenantDatabaseUrl(`${POOLER}?sslmode=verify-full&sslmode=require`)).toThrow(/sslmode once/)
  })

  it('refuses each of them before creating a pool, with or without a CA', () => {
    for (const raw of [POOLER, `${POOLER}?sslmode=require`, `${POOLER}?sslmode=prefer`, `${POOLER}?sslmode=disable`]) {
      expect(() => createPostgresTenantDriver(raw, { caCert: TEST_CA })).toThrow(TenantContextError)
      expect(() => tenantDriverFromEnv({ TENANT_DATABASE_URL: raw, TENANT_DATABASE_CA_CERT: TEST_CA })).toThrow(TenantContextError)
    }
    expect(pg.factory).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', undefined, /TENANT_DATABASE_CA_CERT is not set/],
    ['blank', '  \n ', /TENANT_DATABASE_CA_CERT is not set/],
    ['not a PEM', 'not a certificate', /one or more PEM CA certificates/],
    ['a PEM with junk around it', `junk\n${TEST_CA}`, /one or more PEM CA certificates/],
    ['a damaged PEM', TEST_CA.replace('MIIBgjCC', 'MIIBgjXX'), /one or more PEM CA certificates/],
    ['a server certificate instead of the root', TEST_LEAF, /the root CA, not a server certificate/],
    ['a bundle with a server certificate in it', TEST_CA + TEST_LEAF, /the root CA, not a server certificate/],
  ])('with sslmode=verify-full, refuses a CA that is %s, before creating a pool and without echoing it', (_label, ca, why) => {
    const err = thrown(() => createPostgresTenantDriver(POOLER_VF, { caCert: ca as string | undefined }))
    expect(err).toBeInstanceOf(TenantContextError)
    expect(err.message).toMatch(why)
    expect(err.message).not.toMatch(/BEGIN CERTIFICATE|MIIB|pw-not-real|pooler/)
    const fromEnv = thrown(() => tenantDriverFromEnv({ TENANT_DATABASE_URL: POOLER_VF, TENANT_DATABASE_CA_CERT: ca as string | undefined }))
    expect(fromEnv.message).toMatch(why)
    expect(pg.factory).not.toHaveBeenCalled()
  })

  it('does not fall back to process.env when tenantDriverFromEnv is given an environment without a CA', () => {
    const before = process.env.TENANT_DATABASE_CA_CERT
    process.env.TENANT_DATABASE_CA_CERT = TEST_CA
    try {
      expect(() => tenantDriverFromEnv({ TENANT_DATABASE_URL: POOLER_VF })).toThrow(/TENANT_DATABASE_CA_CERT is not set/)
      expect(pg.factory).not.toHaveBeenCalled()
    } finally {
      if (before === undefined) delete process.env.TENANT_DATABASE_CA_CERT
      else process.env.TENANT_DATABASE_CA_CERT = before
    }
  })

  it('with sslmode=verify-full and the CA, checks the chain against that CA and the name against the host', () => {
    createPostgresTenantDriver(POOLER_VF, { caCert: TEST_CA })
    expect(pg.state.pools[0].options.ssl).toEqual(VERIFIED_SSL)
  })

  it('reads the CA from process.env when the caller passes none', () => {
    const before = process.env.TENANT_DATABASE_CA_CERT
    process.env.TENANT_DATABASE_CA_CERT = TEST_CA
    try {
      createPostgresTenantDriver(POOLER_VF)
      expect(pg.state.pools[0].options.ssl).toEqual(VERIFIED_SSL)
    } finally {
      if (before === undefined) delete process.env.TENANT_DATABASE_CA_CERT
      else process.env.TENANT_DATABASE_CA_CERT = before
    }
  })

  it('prefers the CA the caller passes over process.env', () => {
    const before = process.env.TENANT_DATABASE_CA_CERT
    // A different, valid value (a two-certificate bundle), so a swapped precedence shows.
    process.env.TENANT_DATABASE_CA_CERT = `${TEST_CA}${TEST_CA}`
    try {
      createPostgresTenantDriver(POOLER_VF, { caCert: TEST_CA })
      expect(pg.state.pools[0].options.ssl).toEqual(VERIFIED_SSL)
    } finally {
      if (before === undefined) delete process.env.TENANT_DATABASE_CA_CERT
      else process.env.TENANT_DATABASE_CA_CERT = before
    }
  })

  it('parses a given CA value once, however many transactions ask for the driver, and still refuses a bad value every time', () => {
    // A value no other test uses, so nothing earlier has parsed it.
    const value = `${TEST_CA}\n\n\n`
    const env = { TENANT_DATABASE_URL: POOLER_VF, TENANT_DATABASE_CA_CERT: value }
    x509.parsed = 0
    const first = tenantDriverFromEnv(env)
    expect(x509.parsed).toBe(1)
    for (let i = 0; i < 5; i++) expect(tenantDriverFromEnv(env)).toBe(first)
    expect(x509.parsed).toBe(1)
    expect(pg.factory).toHaveBeenCalledTimes(1)
    // A refused value is not remembered: it throws on each call, and the good value still works after it.
    for (let i = 0; i < 2; i++) {
      expect(() => tenantDriverFromEnv({ ...env, TENANT_DATABASE_CA_CERT: TEST_LEAF })).toThrow(/not a server certificate/)
    }
    expect(tenantDriverFromEnv(env)).toBe(first)
  })

  it('reads a CA stored with literal \\n escapes, and a bundle of CA certificates', () => {
    const escaped = TEST_CA.trim().replace(/\n/g, '\\n')
    expect(parseTenantCaCert(escaped)).toBe(TEST_CA)
    expect(parseTenantCaCert(`${TEST_CA}\n${TEST_CA}`)).toBe(`${TEST_CA.trim()}\n${TEST_CA}`)
    tenantDriverFromEnv({ TENANT_DATABASE_URL: POOLER_VF, TENANT_DATABASE_CA_CERT: escaped })
    expect(pg.state.pools[0].options.ssl).toEqual(VERIFIED_SSL)
  })

  it('sends no server name for an IPv4 host (SNI takes names only); the address goes as host, for the certificate check', () => {
    const parsed = parseTenantDatabaseUrl('postgres://tenant_app_login:pw-not-real@10.0.0.5:5432/postgres?sslmode=verify-full')
    expect(tenantTlsOptions(parsed, TEST_CA)).toEqual({ ca: TEST_CA, rejectUnauthorized: true, host: '10.0.0.5', minVersion: 'TLSv1.2' })
  })

  it('keeps one pool per URL and CA', () => {
    const a = tenantDriverFromEnv({ TENANT_DATABASE_URL: POOLER_VF, TENANT_DATABASE_CA_CERT: TEST_CA })
    const b = tenantDriverFromEnv({ TENANT_DATABASE_URL: POOLER_VF, TENANT_DATABASE_CA_CERT: `${TEST_CA}\n` })
    expect(a).toBe(b)
    const c = tenantDriverFromEnv({ TENANT_DATABASE_URL: POOLER_VF, TENANT_DATABASE_CA_CERT: `${TEST_CA}${TEST_CA}` })
    expect(c).not.toBe(a)
    expect(pg.factory).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['127.0.0.1, no sslmode', LOCAL],
    ['localhost, no sslmode', 'postgres://tenant_app_login:pw-not-real@localhost:54322/postgres'],
    ['127.0.0.1, sslmode=disable', `${LOCAL}?sslmode=disable`],
    ['127.0.0.1, sslmode=require', `${LOCAL}?sslmode=require`],
  ])('leaves a local host as it was: %s, no CA, no TLS', (_label, raw) => {
    expect(() => parseTenantDatabaseUrl(raw)).not.toThrow()
    tenantDriverFromEnv({ TENANT_DATABASE_URL: raw })
    expect(pg.state.pools.at(-1)?.options.ssl).toBe(false)
  })

  it('ignores an unreadable CA for a local host, which uses no TLS', () => {
    createPostgresTenantDriver(LOCAL, { caCert: 'not a certificate' })
    expect(pg.state.pools[0].options.ssl).toBe(false)
  })

  it('tenantDb over a refused remote URL refuses without creating a pool', async () => {
    for (const env of [
      { [TENANT_DB_FLAG]: 'true', TENANT_DATABASE_URL: `${POOLER}?sslmode=require`, TENANT_DATABASE_CA_CERT: TEST_CA },
      { [TENANT_DB_FLAG]: 'true', TENANT_DATABASE_URL: POOLER_VF },
    ]) {
      await expect(tenantDb(CANARY, { env }).sql`SELECT 1`).rejects.toThrow(TenantContextError)
    }
    expect(pg.factory).not.toHaveBeenCalled()
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
    createPostgresTenantDriver(POOLER_VF, { caCert: TEST_CA })
    expect(pg.factory).toHaveBeenCalledTimes(1)
    const options = pg.state.pools[0].options
    expect(options).toMatchObject({
      // So the pooler's tenantDb connections can be counted (O3; supabase/tests/s5_watch_only.sql).
      connection: { application_name: 'stellr-tenantdb' },
      prepare: false,
      max: TENANT_POOL_DEFAULTS.max,
      idle_timeout: TENANT_POOL_DEFAULTS.idleTimeoutSeconds,
      connect_timeout: TENANT_POOL_DEFAULTS.connectTimeoutSeconds,
      max_lifetime: TENANT_POOL_DEFAULTS.maxLifetimeSeconds,
      ssl: VERIFIED_SSL,
      debug: false,
    })
    expect(typeof options.onnotice).toBe('function')
    expect(pg.state.pools[0].log).toEqual([])
  })

  it('hands postgres.js the checked parts, never the raw connection string', () => {
    createPostgresTenantDriver(POOLER_VF, { caCert: TEST_CA })
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
      ssl: VERIFIED_SSL,
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

  it('checks the chain against the CA off this machine, and uses no TLS on localhost', () => {
    createPostgresTenantDriver(POOLER_VF, { caCert: TEST_CA })
    createPostgresTenantDriver(LOCAL, { max: 1 })
    expect(pg.state.pools.map((p) => p.options.ssl)).toEqual([VERIFIED_SSL, false])
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

describe('a refused setting is visible: its reason, the health status and one app_errors row (S5 wave 7, O3)', () => {
  const SECRETS = /pw-not-real|abcdefghijklmnop|pooler|supabase|BEGIN CERTIFICATE|MIIB/

  it('names the connection by application_name stellr-tenantdb', () => {
    expect(TENANT_APPLICATION_NAME).toBe('stellr-tenantdb')
    createPostgresTenantDriver(LOCAL)
    expect(pg.state.pools[0].options.connection).toEqual({ application_name: 'stellr-tenantdb' })
  })

  it.each([
    ['unset', undefined, 'missing'],
    ['not a URL', 'not a url', 'not-a-url'],
    ['not postgres', 'mysql://tenant_app_login:pw-not-real@db.example.com/x', 'not-postgres'],
    ['the owner login', 'postgres://postgres:pw-not-real@db.example.com/postgres?sslmode=verify-full', 'wrong-login'],
    ['no sslmode', POOLER, 'not-verify-full'],
    ['sslmode=require', `${POOLER}?sslmode=require`, 'not-verify-full'],
    ['sslmode twice', `${POOLER_VF}&sslmode=verify-full`, 'sslmode-repeated'],
    ['another query parameter', `${POOLER_VF}&application_name=x`, 'query-parameter'],
    ['a host list', 'postgres://tenant_app_login:pw-not-real@a.example.com,b.example.com/postgres?sslmode=verify-full', 'ambiguous'],
    ['an IPv6 host', 'postgres://tenant_app_login:pw-not-real@[::1]:5432/postgres', 'ipv6-host'],
    ['a bad port', 'postgres://tenant_app_login:pw-not-real@db.example.com:0/postgres?sslmode=verify-full', 'bad-port'],
  ])('a refused URL (%s) throws a TenantContextError whose code is the fixed reason', (_label, raw, reason) => {
    const err = thrown(() => parseTenantDatabaseUrl(raw))
    expect(err).toBeInstanceOf(TenantContextError)
    expect(err).toBeInstanceOf(TenantDbConfigError)
    expect((err as TenantDbConfigError).reason).toBe(reason)
    expect(errorCodeOf(err)).toBe(`tenantdb_config_${reason.replace(/-/g, '_')}`)
    expect(err.name).toBe('TenantContextError')
  })

  it.each([
    ['unset', undefined, 'missing'],
    ['not a PEM', 'not a certificate', 'unreadable'],
    ['a server certificate', TEST_LEAF, 'not-a-ca'],
  ])('a refused CA (%s) throws with the fixed reason as its code', (_label, ca, reason) => {
    const err = thrown(() => parseTenantCaCert(ca))
    expect((err as TenantDbConfigError).reason).toBe(reason)
    expect(errorCodeOf(err)).toBe(`tenantdb_config_${reason.replace(/-/g, '_')}`)
  })

  it('tenantDbConfigStatus reports each check as ok or a fixed reason, never a value, and opens nothing', () => {
    const cases: [Record<string, string | undefined>, ReturnType<typeof tenantDbConfigStatus>][] = [
      [{}, { url: 'missing', ca: 'missing' }],
      [{ TENANT_DATABASE_URL: POOLER_VF, TENANT_DATABASE_CA_CERT: TEST_CA }, { url: 'ok', ca: 'ok' }],
      [{ TENANT_DATABASE_URL: POOLER_VF }, { url: 'ok', ca: 'missing' }],
      [{ TENANT_DATABASE_URL: POOLER_VF, TENANT_DATABASE_CA_CERT: TEST_LEAF }, { url: 'ok', ca: 'not-a-ca' }],
      [{ TENANT_DATABASE_URL: POOLER_VF, TENANT_DATABASE_CA_CERT: 'not a certificate' }, { url: 'ok', ca: 'unreadable' }],
      [{ TENANT_DATABASE_URL: `${POOLER}?sslmode=require`, TENANT_DATABASE_CA_CERT: TEST_CA }, { url: 'not-verify-full', ca: 'ok' }],
      [{ TENANT_DATABASE_URL: LOCAL }, { url: 'ok', ca: 'not-needed' }],
      [{ TENANT_DATABASE_URL: LOCAL, TENANT_DATABASE_CA_CERT: 'not a certificate' }, { url: 'ok', ca: 'not-needed' }],
    ]
    for (const [env, want] of cases) {
      const status = tenantDbConfigStatus(env)
      expect(status).toEqual(want)
      expect(JSON.stringify(status)).not.toMatch(SECRETS)
    }
    expect(pg.factory).not.toHaveBeenCalled()
  })

  it('a refusal in tenantDriverFromEnv writes one TENANTDB config row per instance, with fixed words only', async () => {
    expect(() => tenantDriverFromEnv({ TENANT_DATABASE_URL: `${POOLER}?sslmode=require`, TENANT_DATABASE_CA_CERT: TEST_CA })).toThrow(
      TenantContextError,
    )
    // Another refusal, for another reason, on the same instance: no second row.
    expect(() => tenantDriverFromEnv({ TENANT_DATABASE_URL: POOLER_VF, TENANT_DATABASE_CA_CERT: TEST_LEAF })).toThrow(
      /not a server certificate/,
    )
    expect(() => tenantDriverFromEnv({})).toThrow(/is not set/)
    await settled()
    expect(rows.written).toEqual([
      {
        route: 'TENANTDB config',
        message: 'tenantdb_config_refused url=not-verify-full ca=ok',
        digest: 'digest:TENANTDB config:tenantdb_config_refused url=not-verify-full ca=ok',
      },
    ])
    expect(JSON.stringify(rows.written)).not.toMatch(SECRETS)
    expect(pg.factory).not.toHaveBeenCalled()
  })

  it('writes the row through tenantDb too, and none for a setting that passes', async () => {
    const ok = { [TENANT_DB_FLAG]: 'true', TENANT_DATABASE_URL: LOCAL }
    await tenantDb(CANARY, { env: ok }).sql`SELECT 1`
    await settled()
    expect(rows.written).toEqual([])
    await expect(tenantDb(CANARY, { env: { [TENANT_DB_FLAG]: 'true' } }).sql`SELECT 1`).rejects.toThrow(TenantContextError)
    await settled()
    expect(rows.written.map((r) => r.message)).toEqual(['tenantdb_config_refused url=missing ca=missing'])
  })

  it('with the flag off, a tenantDb call writes no row and loads nothing', async () => {
    await expect(tenantDb(CANARY, { env: { TENANT_DATABASE_URL: 'garbage' } }).sql`SELECT 1`).rejects.toThrow(/is off/)
    await settled()
    expect(rows.written).toEqual([])
    expect(rows.tasks).toEqual([])
  })

  it('tenantDbConfigMessage is fixed words', () => {
    expect(tenantDbConfigMessage({ url: 'wrong-login', ca: 'not-needed' })).toBe('tenantdb_config_refused url=wrong-login ca=not-needed')
  })
})
