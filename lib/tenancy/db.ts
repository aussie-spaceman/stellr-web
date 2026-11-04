// tenantDb(): the one way server code reads or writes tenant data as a single
// tenant (multi-tenancy plan S4; the spike's decision is docs/S4-SPIKE.md,
// Option B).
//
// Every call runs in its own transaction on a connection that may assume the
// `tenant_app` database role, which does NOT bypass row level security:
//
//   BEGIN;
//   SET LOCAL ROLE tenant_app;
//   SELECT set_config('stellr.tenant_id', $1, true);      -- transaction-local
//   SELECT current_user, public.app_tenant_id();          -- verify the pin took
//   … the caller's parametrised statements …
//   COMMIT;                                               -- or ROLLBACK on any throw
//
// The tenant policies (supabase/migrations/20261104200000_tenant_isolation_policies.sql)
// then let the transaction see and write only rows whose tenant_id is that
// tenant. Both the role and the setting are LOCAL, so they end with the
// transaction: a pooled connection (Supavisor transaction mode) never carries
// a tenant into the next request.
//
// Guarantees enforced here:
//   * no tenant, no query: tenantDb() throws on a missing, malformed or nil
//     tenant id before anything touches the database;
//   * values are always bound ($1, $2, …), never spliced into SQL;
//   * caller SQL is one SELECT/INSERT/UPDATE/DELETE/WITH/VALUES/MERGE
//     statement and never calls set_config(): it cannot change the role or
//     re-pin the tenant (refusedSql) — that belongs to this module;
//   * the pin is read back before the caller's first statement; a connection
//     that is not tenant_app, or a tenant that did not stick, aborts the
//     transaction;
//   * it is off unless TENANT_DB_ENABLED is 'true' and a driver is
//     registered. Nothing in the app registers one yet: S5 wires it, one
//     feature area per PR, and the allow-list in lib/tenancy/db-callers.ts
//     names every module that may import this file.
//
// The transport is an interface (TenantSqlDriver), not a dependency: S5 adds
// the Postgres client (postgres.js over the Supavisor pooler, transaction
// mode, prepare: false) and its credentials, the login role the owner creates
// (docs/TENANCY-S4.md, owner actions). Nothing here reads a key or a URL.

import { STELLR_TENANT_ID } from './constants'
import { assertTenantId, TenantContextError } from './tenant-id'

export { assertTenantId, TenantContextError }

/** The database role tenant transactions run as (20261104200000). */
export const TENANT_ROLE = 'tenant_app'

/** The transaction-local setting public.app_tenant_id() reads. */
export const TENANT_SETTING = 'stellr.tenant_id'

/** Environment flag; tenantDb refuses to run unless it is exactly 'true'. */
export const TENANT_DB_FLAG = 'TENANT_DB_ENABLED'

/** The only statement kinds a caller may send: plain DML and reads. */
const ALLOWED_START = /^\s*(?:select|insert|update|delete|with|values|merge)\b/i

/**
 * Why a caller's SQL is refused, or null. Checked on the code the caller
 * wrote (a template's literal parts), never on bound values. Refused: more
 * than one statement; anything but SELECT/INSERT/UPDATE/DELETE/WITH/VALUES/
 * MERGE (so no SET or RESET ROLE, SET SESSION AUTHORIZATION, DO, CALL,
 * COMMIT, DDL); and set_config(), the one function that could re-pin the
 * tenant from inside a query.
 */
export function refusedSql(literal: string): string | null {
  const body = literal.trim().replace(/;\s*$/, '')
  if (body.includes(';')) return 'one statement per call'
  if (!ALLOWED_START.test(body)) return 'only SELECT, INSERT, UPDATE, DELETE, WITH, VALUES or MERGE'
  if (/\bset_config\s*\(/i.test(body)) return 'set_config() belongs to tenantDb'
  return null
}

export interface TenantQueryResult<R> {
  rows: R[]
  rowCount: number
}

/** One open transaction on one connection. */
export interface TenantSqlTx {
  /** A parametrised statement: `text` uses $1…$n, `values` are bound by the driver. */
  query<R = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<TenantQueryResult<R>>
}

/** The transport: runs `fn` in one transaction, commits if it resolves, rolls back if it throws. */
export interface TenantSqlDriver {
  transaction<T>(fn: (tx: TenantSqlTx) => Promise<T>): Promise<T>
}

/** A statement built from a tagged template: literal SQL with $n placeholders, values bound. */
export interface TenantStatement {
  text: string
  values: unknown[]
}

/**
 * Build a statement from a tagged template. Every interpolation becomes a
 * bound parameter; the literal parts are checked against FORBIDDEN_SQL.
 */
export function tenantSql(strings: TemplateStringsArray, ...values: unknown[]): TenantStatement {
  if (!Array.isArray(strings) || !('raw' in strings)) {
    throw new TenantContextError('tenantSql must be used as a tagged template (tenantSql`…`), so values are bound')
  }
  const refused = refusedSql(strings.join(' '))
  if (refused) throw new TenantContextError(`tenantDb refused the SQL: ${refused}`)
  let text = strings[0]
  for (let i = 0; i < values.length; i++) text += `$${i + 1}${strings[i + 1]}`
  return { text, values }
}

/** What a tenantDb transaction callback receives. */
export interface TenantQuery {
  /** Run a statement built with tenantSql inside this tenant transaction. */
  run<R = Record<string, unknown>>(statement: TenantStatement): Promise<TenantQueryResult<R>>
  /** Tagged-template shorthand: `await q.sql\`SELECT … WHERE id = ${id}\`` returns the rows. */
  sql<R = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<R[]>
}

export interface TenantDb {
  readonly tenantId: string
  /** One statement in its own tenant transaction; returns the rows. */
  sql<R = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<R[]>
  /** Several statements in one tenant transaction (all or nothing). */
  transaction<T>(fn: (q: TenantQuery) => Promise<T>): Promise<T>
}

let registeredDriver: TenantSqlDriver | null = null

/**
 * Register the transport (S5, once, at server start). Passing null removes it.
 * Not called anywhere in the app yet.
 */
export function setTenantDbDriver(driver: TenantSqlDriver | null): void {
  registeredDriver = driver
}

export function isTenantDbEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[TENANT_DB_FLAG] === 'true'
}

export interface TenantDbOptions {
  /** Use this transport instead of the registered one (tests, scripts). Skips the flag. */
  driver?: TenantSqlDriver
  env?: Record<string, string | undefined>
}

/** Pin the tenant on an open transaction and prove it took. */
async function pin(tx: TenantSqlTx, tenantId: string): Promise<void> {
  await tx.query(`SET LOCAL ROLE ${TENANT_ROLE}`)
  await tx.query(`SELECT set_config('${TENANT_SETTING}', $1, true)`, [tenantId])
  const check = await tx.query<{ role: unknown; tenant: unknown }>(
    'SELECT current_user AS role, public.app_tenant_id()::text AS tenant',
  )
  const row = check.rows[0]
  if (!row || row.role !== TENANT_ROLE || row.tenant !== tenantId) {
    throw new TenantContextError('tenantDb could not pin the tenant on this connection; the transaction was rolled back')
  }
}

/**
 * The database as one tenant. Throws at once without a valid tenant id.
 * Every call opens its own transaction; see the file header for what runs.
 */
export function tenantDb(tenantId: string, opts: TenantDbOptions = {}): TenantDb {
  const id = assertTenantId(tenantId)

  const driver = (): TenantSqlDriver => {
    if (opts.driver) return opts.driver
    if (!isTenantDbEnabled(opts.env)) {
      throw new TenantContextError(`tenantDb is off: ${TENANT_DB_FLAG} is not 'true'`)
    }
    if (!registeredDriver) throw new TenantContextError('tenantDb has no database driver registered')
    return registeredDriver
  }

  const transaction = async <T>(fn: (q: TenantQuery) => Promise<T>): Promise<T> =>
    driver().transaction(async (tx) => {
      await pin(tx, id)
      const run = <R>(statement: TenantStatement) => {
        if (!statement || typeof statement.text !== 'string' || !Array.isArray(statement.values)) {
          throw new TenantContextError('tenantDb runs only statements built with tenantSql')
        }
        const refused = refusedSql(statement.text)
        if (refused) throw new TenantContextError(`tenantDb refused the SQL: ${refused}`)
        return tx.query<R>(statement.text, statement.values)
      }
      const q: TenantQuery = {
        run,
        sql: async <R>(strings: TemplateStringsArray, ...values: unknown[]) =>
          (await run<R>(tenantSql(strings, ...values))).rows,
      }
      return fn(q)
    })

  return {
    tenantId: id,
    sql: <R>(strings: TemplateStringsArray, ...values: unknown[]) => {
      const statement = tenantSql(strings, ...values)
      return transaction(async (q) => (await q.run<R>(statement)).rows)
    },
    transaction,
  }
}

/** Stellr is tenant #1: tenantDb(STELLR_TENANT_ID) is how Stellr's own reads will run (S5). */
export const stellrDb = (opts?: TenantDbOptions): TenantDb => tenantDb(STELLR_TENANT_ID, opts)
