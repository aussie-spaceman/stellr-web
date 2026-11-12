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
//   * any host that is not this machine is accepted only with
//     sslmode=verify-full in the URL and a root CA in
//     TENANT_DATABASE_CA_CERT (server-only, read here alone): postgres.js
//     then checks the server's certificate chain against that CA and its
//     name against the host. Any other sslmode, no sslmode, or a missing or
//     unreadable CA throws before a pool exists; there is no fallback to an
//     unchecked TLS mode. Local hosts (CI's throwaway database) use no TLS;
//   * every statement goes on the extended protocol, so the server runs one
//     statement per call;
//   * the connection string and the CA never appear in an error or a log
//     line, and postgres.js notices are dropped rather than printed;
//   * a refused URL or CA leaves one 'TENANTDB config' row in app_errors per
//     server instance, naming the fixed reason (tenantDbConfigStatus), and
//     every refusal carries that reason as its error code (S5 wave 7, O3).
//
// Every connection carries application_name 'stellr-tenantdb', so the pooler's
// connections can be counted in pg_stat_activity (supabase/tests/s5_watch_only.sql).

import 'server-only'
import { X509Certificate } from 'node:crypto'
import { isIP } from 'node:net'
import postgres from 'postgres'
import { TenantContextError } from './tenant-id'
import type { TenantQueryResult, TenantSqlDriver, TenantSqlTx } from './db'

/** The server-only secret holding the tenant_app_login pooler connection string. */
export const TENANT_DATABASE_URL_VAR = 'TENANT_DATABASE_URL'

/**
 * The server-only secret holding the PEM of the root CA that signs the
 * database's certificate (Supabase's root CA). Required for any non-local
 * host; never NEXT_PUBLIC_, never logged. A value stored with literal "\n"
 * escapes is read as if it held newlines.
 */
export const TENANT_DATABASE_CA_CERT_VAR = 'TENANT_DATABASE_CA_CERT'

/** The one sslmode accepted for a non-local host. */
export const TENANT_REQUIRED_SSLMODE = 'verify-full'

/** The login role (docs/TENANCY-S4.md, owner actions); the pooler spells it tenant_app_login.<project-ref>. */
export const TENANT_LOGIN_ROLE = 'tenant_app_login'

const LOGIN_USER = /^tenant_app_login(?:\.[a-z0-9]{1,64})?$/
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1'])

/** The application_name every tenantDb connection carries, so pg_stat_activity can count them (S5 wave 7, O3). */
export const TENANT_APPLICATION_NAME = 'stellr-tenantdb'

/**
 * Why the URL or the CA was refused, in fixed words. Never the value: the
 * health route and the 'TENANTDB config' row report these and nothing else.
 */
export type TenantDbConfigReason =
  | 'missing'
  | 'not-a-url'
  | 'not-postgres'
  | 'ambiguous'
  | 'ipv6-host'
  | 'no-host'
  | 'unreadable-part'
  | 'wrong-login'
  | 'query-parameter'
  | 'sslmode-repeated'
  | 'bad-port'
  | 'not-verify-full'
  | 'unreadable'
  | 'not-a-ca'
  | 'refused'

/**
 * A refused connection setting. Still a TenantContextError, with the same
 * message as before. `code` is the reason as a fixed word, so errorCodeOf (the
 * companies GET's log line, the shadow read's row) names it without the message.
 */
export class TenantDbConfigError extends TenantContextError {
  readonly reason: TenantDbConfigReason
  readonly code: string

  constructor(message: string, reason: TenantDbConfigReason) {
    super(message)
    this.reason = reason
    this.code = `tenantdb_config_${reason.replace(/-/g, '_')}`
  }
}

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
  /**
   * The root CA PEM for a non-local host. Defaults to
   * process.env.TENANT_DATABASE_CA_CERT; tenantDriverFromEnv passes the value
   * from the environment it was given. Ignored for a local host.
   */
  caCert?: string
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
  /** The URL's sslmode, or null when it has none. */
  sslmode: string | null
  verifyFull: boolean
}

/** What postgres.js is given as `ssl`: nothing locally, else a chain and name check against the CA. */
export type TenantTlsOptions =
  | false
  | { ca: string; rejectUnauthorized: true; servername?: string; host?: string; minVersion: 'TLSv1.2' }

const ALLOWED_QUERY_PARAMS = new Set(['sslmode'])

// postgres.js 3.4.x reads `simple` from unsafe()'s options (src/index.js) but
// its type for those options names only `prepare`, hence the widened constant.
const EXTENDED_PROTOCOL: postgres.UnsafeQueryOptions = { prepare: false, simple: false } as postgres.UnsafeQueryOptions

function decoded(part: string, what: string, name: string): string {
  try {
    return decodeURIComponent(part)
  } catch {
    throw new TenantDbConfigError(`${name} has an unreadable ${what}`, 'unreadable-part')
  }
}

/**
 * Checks the connection string without echoing it. Throws TenantContextError
 * when it is missing, is not a postgres URL, names a user other than the
 * tenant login, has an authority that parsers could read two ways (more than
 * one '@', a host list, or an encoded host), or carries a query parameter
 * other than sslmode, or names a non-local host without sslmode=verify-full.
 * The driver connects with the parts returned here, so the host it dials is
 * the host checked here. The CA is checked separately (tenantTlsOptions).
 */
export function parseTenantDatabaseUrl(raw: string | undefined): ParsedUrl {
  const parsed = parsePostgresUrl(raw, TENANT_DATABASE_URL_VAR, {
    checkUser: (user) => {
      if (!LOGIN_USER.test(user)) {
        throw new TenantDbConfigError(
          `${TENANT_DATABASE_URL_VAR} must connect as ${TENANT_LOGIN_ROLE}; any other login is refused`,
          'wrong-login',
        )
      }
    },
  })
  if (!parsed.local && parsed.sslmode !== TENANT_REQUIRED_SSLMODE) {
    throw new TenantDbConfigError(
      `${TENANT_DATABASE_URL_VAR} must end in ?sslmode=${TENANT_REQUIRED_SSLMODE} for a host that is not this machine; no other TLS mode is accepted`,
      'not-verify-full',
    )
  }
  return parsed
}

const PEM_BLOCK = /-----BEGIN CERTIFICATE-----[A-Za-z0-9+/=\s]+?-----END CERTIFICATE-----/g

// Values that parsed, and their result. tenantDriverFromEnv runs on every
// tenantDb transaction and hands the normalised PEM on to
// createPostgresTenantDriver, so both the raw value and the PEM are kept, and
// the certificates are parsed once per value. Only a value that passed every
// check is kept; a refused value is checked (and refused) on every call. A
// server instance sees one or two values, so the map is simply emptied if it
// ever grows past a few.
const parsedCa = new Map<string, string>()
const PARSED_CA_LIMIT = 8

/**
 * Reads the root CA PEM from TENANT_DATABASE_CA_CERT's value. Throws, without
 * echoing the value, unless it holds at least one certificate, every block in
 * it parses, and every certificate is a CA certificate (a pasted server
 * certificate is refused). Returns the normalised PEM.
 */
export function parseTenantCaCert(raw: string | undefined): string {
  const known = typeof raw === 'string' ? parsedCa.get(raw) : undefined
  if (known !== undefined) return known
  const pem = readTenantCaCert(raw)
  if (parsedCa.size >= PARSED_CA_LIMIT) parsedCa.clear()
  parsedCa.set(raw as string, pem)
  parsedCa.set(pem, pem)
  return pem
}

function readTenantCaCert(raw: string | undefined): string {
  const missing = `${TENANT_DATABASE_CA_CERT_VAR} is not set; a host that is not this machine needs the database's root CA to check its certificate`
  if (typeof raw !== 'string' || raw.trim() === '') throw new TenantDbConfigError(missing, 'missing')
  // Some secret stores keep a multi-line value with literal "\n" escapes.
  const pem = raw.replace(/\\r\\n|\\n/g, '\n').replace(/\r\n/g, '\n').trim()
  const blocks = pem.match(PEM_BLOCK) ?? []
  const unreadable = `${TENANT_DATABASE_CA_CERT_VAR} must hold one or more PEM CA certificates and nothing else`
  if (blocks.length === 0 || pem.replace(PEM_BLOCK, '').trim() !== '') throw new TenantDbConfigError(unreadable, 'unreadable')
  for (const block of blocks) {
    let cert: X509Certificate
    try {
      cert = new X509Certificate(block)
    } catch {
      throw new TenantDbConfigError(unreadable, 'unreadable')
    }
    if (!cert.ca) {
      throw new TenantDbConfigError(`${TENANT_DATABASE_CA_CERT_VAR} must hold the root CA, not a server certificate`, 'not-a-ca')
    }
  }
  return blocks.join('\n') + '\n'
}

/**
 * The `ssl` option postgres.js gets for a parsed tenant URL. Local: no TLS, as
 * before. Otherwise only sslmode=verify-full with a readable CA: the chain is
 * checked against that CA alone and the certificate's name against the host
 * (Node's default identity check). A name goes as the server name. An IPv4
 * address goes as `host`: SNI carries names only, and postgres.js hands Node
 * a connected socket with no host, so without it Node checks the certificate
 * against "localhost" rather than the address (driver-tls.test.ts). Throws for
 * anything else; never returns an unchecked mode.
 */
export function tenantTlsOptions(parsed: ParsedUrl, caCert: string | undefined): TenantTlsOptions {
  if (parsed.local) return false
  if (parsed.sslmode !== TENANT_REQUIRED_SSLMODE) {
    throw new TenantDbConfigError(
      `${TENANT_DATABASE_URL_VAR} must end in ?sslmode=${TENANT_REQUIRED_SSLMODE} for a host that is not this machine; no other TLS mode is accepted`,
      'not-verify-full',
    )
  }
  const ca = parseTenantCaCert(caCert)
  return {
    ca,
    rejectUnauthorized: true,
    ...(isIP(parsed.host) ? { host: parsed.host } : { servername: parsed.host }),
    minVersion: 'TLSv1.2',
  }
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
    throw new TenantDbConfigError(
      name === TENANT_DATABASE_URL_VAR
        ? `tenantDb is on but ${TENANT_DATABASE_URL_VAR} is not set; it has no other connection to use`
        : `${name} is not set`,
      'missing',
    )
  }
  const trimmed = raw.trim()
  let u: URL
  try {
    u = new URL(trimmed)
  } catch {
    throw new TenantDbConfigError(`${name} is not a valid connection URL`, 'not-a-url')
  }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') {
    throw new TenantDbConfigError(`${name} must be a postgres:// URL`, 'not-postgres')
  }
  const schemeEnd = trimmed.indexOf('://')
  const authority = schemeEnd < 0 ? '' : trimmed.slice(schemeEnd + 3).split(/[/?#]/)[0]
  const atCount = authority.split('@').length - 1
  const hostPart = authority.slice(authority.lastIndexOf('@') + 1)
  if (atCount > 1 || /[,%\\]/.test(hostPart) || /[,%]/.test(u.hostname)) {
    throw new TenantDbConfigError(
      `${name} must name one user and one host; encode any '@', ',' or '%' in the password`,
      'ambiguous',
    )
  }
  // postgres.js splits a host string on ':' to find a port, so an IPv6
  // literal would not reach it intact. Neither the pooler nor CI uses one.
  if (u.hostname.includes(':') || u.hostname.startsWith('[')) {
    throw new TenantDbConfigError(`${name} must name its host by name or IPv4 address`, 'ipv6-host')
  }
  if (!u.hostname) throw new TenantDbConfigError(`${name} has no host`, 'no-host')
  const user = decoded(u.username, 'user name', name)
  opts.checkUser?.(user)
  for (const key of u.searchParams.keys()) {
    if (!ALLOWED_QUERY_PARAMS.has(key)) {
      throw new TenantDbConfigError(`${name} may carry only sslmode as a query parameter`, 'query-parameter')
    }
  }
  const sslmodes = u.searchParams.getAll('sslmode')
  if (sslmodes.length > 1) throw new TenantDbConfigError(`${name} may give sslmode once`, 'sslmode-repeated')
  const host = u.hostname.toLowerCase()
  const port = u.port === '' ? 5432 : Number(u.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TenantDbConfigError(`${name} has an invalid port`, 'bad-port')
  }
  return {
    url: trimmed,
    host,
    port,
    user,
    password: decoded(u.password, 'password', name),
    database: decoded(u.pathname.replace(/^\//, ''), 'database name', name) || 'postgres',
    local: LOCAL_HOSTS.has(host),
    sslmode: sslmodes[0] ?? null,
    verifyFull: sslmodes[0] === 'verify-full',
  }
}

/** A driver over one postgres.js pool. Opens no connection until the first transaction. */
export function createPostgresTenantDriver(rawUrl: string | undefined, opts: TenantDriverOptions = {}): PostgresTenantDriver {
  const parsed = parseTenantDatabaseUrl(rawUrl)
  const ssl = tenantTlsOptions(parsed, opts.caCert ?? process.env[TENANT_DATABASE_CA_CERT_VAR])
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
    // Off this machine: the chain checked against the CA and the name against
    // the host (tenantTlsOptions). No TLS on this machine only.
    ssl,
    onnotice: () => {},
    debug: false,
    connection: { application_name: TENANT_APPLICATION_NAME },
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
 * or refused, or when a non-local host has no readable CA.
 */
export function tenantDriverFromEnv(env: Record<string, string | undefined> = process.env): PostgresTenantDriver {
  let parsed: ParsedUrl
  let ssl: TenantTlsOptions
  try {
    parsed = parseTenantDatabaseUrl(env[TENANT_DATABASE_URL_VAR])
    ssl = tenantTlsOptions(parsed, env[TENANT_DATABASE_CA_CERT_VAR])
  } catch (err) {
    if (err instanceof TenantDbConfigError) noteConfigRefusal(env)
    throw err
  }
  // A changed CA gets its own pool rather than reusing one built on the old one.
  const key = ssl ? `${parsed.url}\n${ssl.ca}` : parsed.url
  let driver = cached.get(key)
  if (!driver) {
    driver = createPostgresTenantDriver(parsed.url, { caCert: ssl ? ssl.ca : undefined })
    cached.set(key, driver)
  }
  return driver
}

/** The URL check and the CA check, each 'ok' or a fixed reason. The CA is 'not-needed' for a local host. */
export interface TenantDbConfigStatus {
  url: 'ok' | TenantDbConfigReason
  ca: 'ok' | 'not-needed' | TenantDbConfigReason
}

const reasonOf = (err: unknown): TenantDbConfigReason => (err instanceof TenantDbConfigError ? err.reason : 'refused')

/**
 * Whether TENANT_DATABASE_URL and TENANT_DATABASE_CA_CERT pass the checks
 * tenantDriverFromEnv makes, as 'ok' or a fixed reason: never a value, a host
 * or a message. Opens nothing. The health route loads this module for it only
 * when TENANT_DB_ENABLED is 'true' (S5 wave 7, O3).
 */
export function tenantDbConfigStatus(env: Record<string, string | undefined> = process.env): TenantDbConfigStatus {
  let url: TenantDbConfigStatus['url'] = 'ok'
  let local = false
  try {
    local = parseTenantDatabaseUrl(env[TENANT_DATABASE_URL_VAR]).local
  } catch (err) {
    url = reasonOf(err)
  }
  if (local) return { url, ca: 'not-needed' }
  try {
    parseTenantCaCert(env[TENANT_DATABASE_CA_CERT_VAR])
    return { url, ca: 'ok' }
  } catch (err) {
    return { url, ca: reasonOf(err) }
  }
}

/** The app_errors row for a refused setting: fixed words only. */
export function tenantDbConfigMessage(status: TenantDbConfigStatus): string {
  return `tenantdb_config_refused url=${status.url} ca=${status.ca}`
}

// One 'TENANTDB config' row per server instance: a refused setting refuses
// every tenantDb call, and one row says so. The redeploy that fixes it starts
// new instances.
let configRowNoted = false

/** Test hook: let this instance write its 'TENANTDB config' row again. */
export function resetTenantDbConfigRow(): void {
  configRowNoted = false
}

function noteConfigRefusal(env: Record<string, string | undefined>): void {
  if (configRowNoted) return
  configRowNoted = true
  void recordConfigRow(tenantDbConfigMessage(tenantDbConfigStatus(env)))
}

/**
 * lib/app-errors brings the mailer and the service-role client with it, so
 * both it and lib/after-response load only when there is a row to write, as
 * the limiter's rows do (O2). recordBuiltAppError, so the text is kept as
 * built; the same per-instance limit as every app_errors write. Never throws.
 * This module never logs, so a failed write is dropped (after-response logs a
 * failed task itself).
 */
async function recordConfigRow(message: string): Promise<void> {
  try {
    const { runAfterResponse } = await import('@/lib/after-response')
    runAfterResponse('tenant-db', async () => {
      const { errorDigest, recordBuiltAppError, routeLabel } = await import('@/lib/app-errors')
      const route = routeLabel('TENANTDB', 'config', undefined)
      await recordBuiltAppError(route, message, errorDigest(route, message))
    })
  } catch {
    // Nothing to do: the refusal itself still throws to the caller.
  }
}

/** Close every pool this module opened (scripts and tests). */
export async function endTenantDrivers(): Promise<void> {
  const drivers = [...cached.values()]
  cached.clear()
  await Promise.all(drivers.map((d) => d.end()))
}
