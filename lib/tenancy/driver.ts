// The Postgres transport behind tenantDb (multi-tenancy plan S5, C11; the
// design is docs/S4-SPIKE.md, Option B, and docs/TENANCY-S4.md).
//
// postgres.js over the Supabase pooler in transaction mode, with
// `prepare: false` (a transaction-mode pooler hands each transaction to any
// backend, so a named prepared statement may not exist on the next one). The
// login is `tenant_app_login`: NOINHERIT, no table grant of its own, allowed
// only to SET ROLE tenant_app. lib/tenancy/db.ts runs every transaction:
//
//   BEGIN; SET LOCAL ROLE tenant_app; SELECT set_config('stellr.tenant_id', $1, true);
//   <read-back>; <caller statements, each followed by the read-back>; COMMIT
//
// This module only opens connections and runs what db.ts hands it. It is
// loaded by db.ts with a dynamic import, and only once TENANT_DB_ENABLED is
// 'true' and no driver was registered, so with the flag off (the default)
// nothing imports postgres.js and nothing connects. proxy.ts and client code
// never reach it (lib/tenancy/driver.test.ts walks both import graphs).
//
// Fail-closed rules:
//   * TENANT_DATABASE_URL is the only connection this reads. Missing, blank or
//     not a postgres URL: tenantDb throws. There is no fallback to the
//     service-role client or to any other connection;
//   * the URL's user must be tenant_app_login (or the pooler's
//     tenant_app_login.<project-ref>), so a pasted owner or service connection
//     string is refused before it is used;
//   * the URL must name one user and one host and carry no query parameter
//     but sslmode; postgres.js gets the checked parts, never the string, so
//     the host it dials is the host the TLS rule below was decided on;
//   * TLS is required for any host that is not this machine;
//   * every statement goes on the extended protocol, so the server runs one
//     statement per call;
//   * the connection string never appears in an error or a log line, and
//     postgres.js notices are dropped rather than printed.

import 'server-only'
import postgres from 'postgres'
import { TenantContextError } from './tenant-id'
import type { TenantQueryResult, TenantSqlDriver, TenantSqlTx } from './db'

/** The server-only secret holding the tenant_app_login pooler connection string. */
export const TENANT_DATABASE_URL_VAR = 'TENANT_DATABASE_URL'

/** The login role (docs/TENANCY-S4.md, owner actions); the pooler spells it tenant_app_login.<project-ref>. */
export const TENANT_LOGIN_ROLE = 'tenant_app_login'

const LOGIN_USER = /^tenant_app_login(?:\.[a-z0-9]{1,64})?$/
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1'])

/** Pool settings. Small: Hobby functions are short-lived and the pooler's client limit is shared. */
export const TENANT_POOL_DEFAULTS = Object.freeze({
  max: 3,
  idleTimeoutSeconds: 20,
  connectTimeoutSeconds: 10,
  maxLifetimeSeconds: 60 * 5,
})

export interface TenantDriverOptions {
  /** Pool size; defaults to TENANT_POOL_DEFAULTS.max. Tests use 1 to force connection reuse. */
  max?: number
}

/** A running driver, with a way to close its pool (scripts and tests). */
export interface PostgresTenantDriver extends TenantSqlDriver {
  end(): Promise<void>
}

interface ParsedUrl {
  /** The trimmed connection string; a cache key only, never handed to postgres.js. */
  url: string
  /** The one host, without IPv6 brackets. */
  host: string
  port: number
  user: string
  password: string
  database: string
  local: boolean
  verifyFull: boolean
}

const ALLOWED_QUERY_PARAMS = new Set(['sslmode'])

// postgres.js 3.4.x reads `simple` from unsafe()'s options (src/index.js) but
// its type for those options names only `prepare`, hence the widened constant.
const EXTENDED_PROTOCOL: postgres.UnsafeQueryOptions = { prepare: false, simple: false } as postgres.UnsafeQueryOptions

function decoded(part: string, what: string, name: string): string {
  try {
    return decodeURIComponent(part)
  } catch {
    throw new TenantContextError(`${name} has an unreadable ${what}`)
  }
}

/**
 * Checks the connection string without echoing it. Throws TenantContextError
 * when it is missing, is not a postgres URL, names a user other than the
 * tenant login, has an authority that parsers could read two ways (more than
 * one '@', a host list, or an encoded host), or carries a query parameter
 * other than sslmode. The driver connects with the parts returned here, so the
 * host it dials is the host checked here.
 */
export function parseTenantDatabaseUrl(raw: string | undefined): ParsedUrl {
  return parsePostgresUrl(raw, TENANT_DATABASE_URL_VAR, {
    checkUser: (user) => {
      if (!LOGIN_USER.test(user)) {
        throw new TenantContextError(
          `${TENANT_DATABASE_URL_VAR} must connect as ${TENANT_LOGIN_ROLE}; any other login is refused`,
        )
      }
    },
  })
}

/**
 * The same checks as parseTenantDatabaseUrl for any postgres connection string
 * named `name`, with the user check left to the caller. Connect with the parts
 * it returns, never the string: postgres.js parses a URL its own way. The
 * two-tenant kit uses it for its owner connection (C12).
 */
export function parsePostgresUrl(
  raw: string | undefined,
  name: string,
  opts: { checkUser?: (user: string) => void } = {},
): ParsedUrl {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new TenantContextError(
      name === TENANT_DATABASE_URL_VAR
        ? `tenantDb is on but ${TENANT_DATABASE_URL_VAR} is not set; it has no other connection to use`
        : `${name} is not set`,
    )
  }
  const trimmed = raw.trim()
  let u: URL
  try {
    u = new URL(trimmed)
  } catch {
    throw new TenantContextError(`${name} is not a valid connection URL`)
  }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') {
    throw new TenantContextError(`${name} must be a postgres:// URL`)
  }
  const schemeEnd = trimmed.indexOf('://')
  const authority = schemeEnd < 0 ? '' : trimmed.slice(schemeEnd + 3).split(/[/?#]/)[0]
  const atCount = authority.split('@').length - 1
  const hostPart = authority.slice(authority.lastIndexOf('@') + 1)
  if (atCount > 1 || /[,%\\]/.test(hostPart) || /[,%]/.test(u.hostname)) {
    throw new TenantContextError(
      `${name} must name one user and one host; encode any '@', ',' or '%' in the password`,
    )
  }
  // postgres.js splits a host string on ':' to find a port, so an IPv6
  // literal would not reach it intact. Neither the pooler nor CI uses one.
  if (u.hostname.includes(':') || u.hostname.startsWith('[')) {
    throw new TenantContextError(`${name} must name its host by name or IPv4 address`)
  }
  if (!u.hostname) throw new TenantContextError(`${name} has no host`)
  const user = decoded(u.username, 'user name', name)
  opts.checkUser?.(user)
  for (const key of u.searchParams.keys()) {
    if (!ALLOWED_QUERY_PARAMS.has(key)) {
      throw new TenantContextError(`${name} may carry only sslmode as a query parameter`)
    }
  }
  const host = u.hostname.toLowerCase()
  const port = u.port === '' ? 5432 : Number(u.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TenantContextError(`${name} has an invalid port`)
  }
  return {
    url: trimmed,
    host,
    port,
    user,
    password: decoded(u.password, 'password', name),
    database: decoded(u.pathname.replace(/^\//, ''), 'database name', name) || 'postgres',
    local: LOCAL_HOSTS.has(host),
    verifyFull: u.searchParams.get('sslmode') === 'verify-full',
  }
}

/** A driver over one postgres.js pool. Opens no connection until the first transaction. */
export function createPostgresTenantDriver(rawUrl: string | undefined, opts: TenantDriverOptions = {}): PostgresTenantDriver {
  const parsed = parseTenantDatabaseUrl(rawUrl)
  // The checked parts, not the string: postgres.js parses a URL its own way
  // (host lists, its own '@' split, query keys as startup parameters), and the
  // host it dials must be the one checked above (one name, no ',' or ':').
  const sql = postgres({
    host: parsed.host,
    port: parsed.port,
    user: parsed.user,
    pass: parsed.password,
    database: parsed.database,
    prepare: false,
    max: opts.max ?? TENANT_POOL_DEFAULTS.max,
    idle_timeout: TENANT_POOL_DEFAULTS.idleTimeoutSeconds,
    connect_timeout: TENANT_POOL_DEFAULTS.connectTimeoutSeconds,
    max_lifetime: TENANT_POOL_DEFAULTS.maxLifetimeSeconds,
    // Encrypted off this machine. 'require' encrypts without checking the
    // certificate chain; sslmode=verify-full in the URL checks it too.
    ssl: parsed.local ? false : parsed.verifyFull ? 'verify-full' : 'require',
    onnotice: () => {},
    debug: false,
    connection: { application_name: 'stellr-tenantdb' },
  })

  return {
    async transaction<T>(fn: (tx: TenantSqlTx) => Promise<T>): Promise<T> {
      // begin() sends BEGIN, then COMMIT when fn resolves or ROLLBACK when it throws.
      const out = await sql.begin(async (t) => {
        const tx: TenantSqlTx = {
          async query<R = Record<string, unknown>>(text: string, values: readonly unknown[] = []): Promise<TenantQueryResult<R>> {
            // Only text db.ts built reaches here: its own pin statements, or a
            // statement tenantSql minted and refusedSql passed. Values are bound.
            // simple: false keeps every statement on the extended protocol,
            // values or not, so the server itself refuses text holding more
            // than one statement (postgres.js would otherwise use the simple
            // protocol whenever there are no values).
            const result = await t.unsafe(text, values as never[], EXTENDED_PROTOCOL)
            const rows = Array.from(result) as R[]
            return { rows, rowCount: typeof result.count === 'number' ? result.count : rows.length }
          },
        }
        return fn(tx)
      })
      return out as T
    },
    end: () => sql.end({ timeout: 5 }),
  }
}

const cached = new Map<string, PostgresTenantDriver>()

/**
 * The driver for this environment's TENANT_DATABASE_URL, one pool per URL per
 * server instance. lib/tenancy/db.ts calls this when the flag is on and no
 * driver was registered. Throws, without connecting, when the URL is missing
 * or refused.
 */
export function tenantDriverFromEnv(env: Record<string, string | undefined> = process.env): PostgresTenantDriver {
  const parsed = parseTenantDatabaseUrl(env[TENANT_DATABASE_URL_VAR])
  let driver = cached.get(parsed.url)
  if (!driver) {
    driver = createPostgresTenantDriver(parsed.url)
    cached.set(parsed.url, driver)
  }
  return driver
}

/** Close every pool this module opened (scripts and tests). */
export async function endTenantDrivers(): Promise<void> {
  const drivers = [...cached.values()]
  cached.clear()
  await Promise.all(drivers.map((d) => d.end()))
}
