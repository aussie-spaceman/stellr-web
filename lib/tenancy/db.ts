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
//   * values are always bound ($1, $2, …), never spliced into SQL, and only
//     statements tenantSql built (frozen, remembered in a WeakSet) reach the
//     driver;
//   * caller SQL is one SELECT/INSERT/UPDATE/DELETE/WITH/VALUES/MERGE
//     statement with no comments, no U& escapes, and no mention — quoted,
//     qualified or otherwise — of set_config, pg_settings or a core function
//     that runs SQL text (refusedSql). Pinning belongs to this module;
//   * the pin is read back before the caller's first statement AND after
//     every caller statement, before its rows are returned. A connection that
//     is not tenant_app, a tenant that did not stick, or a statement that
//     moved either, aborts the transaction (writes included).
//     What remains (docs/TENANCY-S4.md, "What tenantDb does and does not
//     stop"): a path refusedSql does not know that re-pins AND restores the
//     pin inside one statement would pass the read-back. Bound values cannot
//     do it (they are never SQL), so it takes SQL written in an allow-listed
//     file, which review and the denylist are there to catch;
//   * with `readOnly`, every transaction is SET TRANSACTION READ ONLY before
//     the pin and read back after it, so the database refuses any write;
//   * it is off unless TENANT_DB_ENABLED is exactly 'true'. With the flag
//     off nothing loads the Postgres client and nothing connects. With it on,
//     a registered driver is used, or else lib/tenancy/driver.ts is loaded on
//     first use and connects with TENANT_DATABASE_URL alone: a missing or
//     refused URL throws, and there is no fallback to any other client. No
//     route calls tenantDb yet: S5 wires it one feature area per PR, and the
//     allow-list in lib/tenancy/db-callers.ts names every module that may
//     import this file.
//
// The transport is an interface (TenantSqlDriver). lib/tenancy/driver.ts is
// the Postgres one (postgres.js over the Supavisor pooler, transaction mode,
// prepare: false), as the login role the owner creates (docs/TENANCY-S4.md,
// owner actions). This file reads no key and no URL.

import { STELLR_TENANT_ID } from './constants'
import { isTenantDbEnabled, TENANT_DB_FLAG } from './tenant-db-config'
import { assertTenantId, TenantContextError } from './tenant-id'

export { assertTenantId, TenantContextError }

/**
 * Environment flag; tenantDb refuses to run unless it is exactly 'true'. Read in
 * ./tenant-db-config (pure), so the switch registry can resolve it without this module.
 */
export { isTenantDbEnabled, TENANT_DB_FLAG }

/** The database role tenant transactions run as (20261104200000). */
export const TENANT_ROLE = 'tenant_app'

/** The transaction-local setting public.app_tenant_id() reads. */
export const TENANT_SETTING = 'stellr.tenant_id'

/** The only statement kinds a caller may send: plain DML and reads. */
const ALLOWED_START = /^\s*(?:select|insert|update|delete|with|values|merge)\b/i

/**
 * Text that may not appear anywhere in caller SQL, in any spelling Postgres
 * would accept. Matched as a plain substring, case-insensitively, so quoting
 * ("set_config"), schema-qualifying (pg_catalog.set_config) or splitting with
 * whitespace before the bracket does not get past it; comments and U& escapes
 * — the two ways to spell an identifier without its letters in a row — are
 * refused outright. Over-refusing (say, a string literal that mentions one of
 * these) costs a caller nothing: the value belongs in a bound parameter.
 */
const FORBIDDEN_TEXT: readonly [RegExp, string][] = [
  [/--|\/\*/, 'no comments in tenant SQL'],
  [/u&["']/i, 'no U& escapes in tenant SQL'],
  // The function that sets a setting: it could re-pin the tenant, or set
  // 'role' to drop tenant_app for the login role.
  [/set_config/i, 'set_config() belongs to tenantDb'],
  // pg_settings is updatable by PUBLIC: UPDATE pg_settings is set_config.
  [/pg_settings/i, 'pg_settings belongs to tenantDb'],
  // Core functions that execute SQL text, which could carry any of the above
  // (or arrive as a bound value): query_to_xml and the rest of the *_to_xml
  // family, ts_stat and ts_rewrite. Extensions that run SQL text (dblink and
  // the like) are not granted to tenant_app.
  [/_to_xml/i, 'functions that run SQL text are not allowed'],
  [/\bts_stat\b|\bts_rewrite\b/i, 'functions that run SQL text are not allowed'],
]

/**
 * Why a caller's SQL is refused, or null. Checked on the code the caller
 * wrote (a template's literal parts), never on bound values. Refused: more
 * than one statement; anything but SELECT/INSERT/UPDATE/DELETE/WITH/VALUES/
 * MERGE (so no SET or RESET ROLE, SET SESSION AUTHORIZATION, DO, CALL,
 * COMMIT, DDL); and anything in FORBIDDEN_TEXT.
 *
 * This is the first line, not the only one: after every caller statement
 * tenantDb reads the role and the tenant back and rolls the transaction back
 * if either moved (see verifyPin), so a path this list does not know about
 * cannot leave a re-pinned tenant or a dropped role behind it.
 */
export function refusedSql(literal: string): string | null {
  if (typeof literal !== 'string') return 'not SQL text'
  const body = literal.trim().replace(/;\s*$/, '')
  if (body.includes(';')) return 'one statement per call'
  if (!ALLOWED_START.test(body)) return 'only SELECT, INSERT, UPDATE, DELETE, WITH, VALUES or MERGE'
  for (const [re, why] of FORBIDDEN_TEXT) if (re.test(body)) return why
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
  readonly text: string
  readonly values: readonly unknown[]
}

/** Statements tenantSql built. run() takes nothing else, so a hand-made {text, values} cannot reach the driver. */
const MINTED = new WeakSet<object>()

/**
 * Build a statement from a tagged template. Every interpolation becomes a
 * bound parameter; the literal parts are checked by refusedSql. The result
 * is frozen and remembered, so it cannot be edited after the check.
 */
export function tenantSql(strings: TemplateStringsArray, ...values: unknown[]): TenantStatement {
  // A real template strings array, and its .raw, are frozen by the language.
  if (
    !Array.isArray(strings) ||
    !Object.isFrozen(strings) ||
    !Array.isArray((strings as { raw?: unknown }).raw) ||
    !Object.isFrozen(strings.raw) ||
    strings.length !== values.length + 1 ||
    !strings.every((s) => typeof s === 'string')
  ) {
    throw new TenantContextError('tenantSql must be used as a tagged template (tenantSql`…`), so values are bound')
  }
  const refused = refusedSql(strings.join(' '))
  if (refused) throw new TenantContextError(`tenantDb refused the SQL: ${refused}`)
  let text = strings[0]
  for (let i = 0; i < values.length; i++) text += `$${i + 1}${strings[i + 1]}`
  const statement: TenantStatement = Object.freeze({ text, values: Object.freeze([...values]) })
  MINTED.add(statement)
  return statement
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
 * Register a transport in place of the one lib/tenancy/driver.ts builds from
 * the environment (tests, scripts). Passing null removes it. Not called
 * anywhere in the app.
 */
export function setTenantDbDriver(driver: TenantSqlDriver | null): void {
  registeredDriver = driver
}

export interface TenantDbOptions {
  /** Use this transport instead of the registered one (tests, scripts). Skips the flag. */
  driver?: TenantSqlDriver
  env?: Record<string, string | undefined>
  /**
   * Every transaction is READ ONLY: set before the pin and read back with it,
   * so the database refuses any write, including one a volatile function
   * makes. A write-shaped statement is refused before it is sent. The area
   * switch's shadow read uses this (C12).
   */
  readOnly?: boolean
}

/** Sent before the pin when `readOnly` is set. Postgres refuses to turn it back to read-write after the first query. */
export const READ_ONLY_SQL = 'SET TRANSACTION READ ONLY'

/** The read-back for `readOnly`: 'on' once the transaction is read-only. */
export const READ_ONLY_CHECK_SQL = "SELECT current_setting('transaction_read_only') AS read_only"

/** A statement that writes, at its start or inside a WITH. Over-refuses rather than under-refuses: it guards reads. */
const WRITE_SHAPED = /^\s*(?:insert|update|delete|merge)\b|^\s*with\b[\s\S]*\b(?:insert\s+into|update\b[\s\S]*\bset\b|delete\s+from|merge\s+into)\b/i

/** True when `text` reads as a write. Exported for the area switch's tests. */
export function isWriteShaped(text: string): boolean {
  return WRITE_SHAPED.test(text)
}

/** The read-back: which role the transaction runs as and which tenant app_tenant_id() returns. */
export const PIN_CHECK_SQL = 'SELECT current_user AS role, public.app_tenant_id()::text AS tenant'

/** Throws unless the transaction still runs as tenant_app with exactly `tenantId` pinned. */
async function verifyPin(tx: TenantSqlTx, tenantId: string, message: string): Promise<void> {
  const check = await tx.query<{ role: unknown; tenant: unknown }>(PIN_CHECK_SQL)
  const row = check.rows[0]
  if (!row || row.role !== TENANT_ROLE || row.tenant !== tenantId) throw new TenantContextError(message)
}

/** Pin the tenant on an open transaction and prove it took. */
async function pin(tx: TenantSqlTx, tenantId: string): Promise<void> {
  await tx.query(`SET LOCAL ROLE ${TENANT_ROLE}`)
  await tx.query(`SELECT set_config('${TENANT_SETTING}', $1, true)`, [tenantId])
  await verifyPin(tx, tenantId, 'tenantDb could not pin the tenant on this connection; the transaction was rolled back')
}

/**
 * The database as one tenant. Throws at once without a valid tenant id.
 * Every call opens its own transaction; see the file header for what runs.
 */
export function tenantDb(tenantId: string, opts: TenantDbOptions = {}): TenantDb {
  const id = assertTenantId(tenantId)

  const driver = async (): Promise<TenantSqlDriver> => {
    if (opts.driver) return opts.driver
    const env = opts.env ?? process.env
    if (!isTenantDbEnabled(env)) {
      throw new TenantContextError(`tenantDb is off: ${TENANT_DB_FLAG} is not 'true'`)
    }
    if (registeredDriver) return registeredDriver
    // Loaded only here, so with the flag off the Postgres client is never
    // imported. Throws, without connecting, when TENANT_DATABASE_URL is
    // missing or refused.
    const { tenantDriverFromEnv } = await import('./driver')
    return tenantDriverFromEnv(env)
  }

  const readOnly = opts.readOnly === true

  const transaction = async <T>(fn: (q: TenantQuery) => Promise<T>): Promise<T> =>
    (await driver()).transaction(async (tx) => {
      if (readOnly) await tx.query(READ_ONLY_SQL)
      await pin(tx, id)
      if (readOnly) {
        const check = await tx.query<{ read_only: unknown }>(READ_ONLY_CHECK_SQL)
        if (check.rows[0]?.read_only !== 'on') {
          throw new TenantContextError('tenantDb could not make this transaction read-only; it was rolled back')
        }
      }
      const run = async <R>(statement: TenantStatement) => {
        if (!statement || typeof statement !== 'object' || !MINTED.has(statement)) {
          throw new TenantContextError('tenantDb runs only statements built with tenantSql')
        }
        const refused = refusedSql(statement.text)
        if (refused) throw new TenantContextError(`tenantDb refused the SQL: ${refused}`)
        if (readOnly && isWriteShaped(statement.text)) {
          throw new TenantContextError('tenantDb refused the SQL: this transaction is read-only')
        }
        const result = await tx.query<R>(statement.text, statement.values)
        // Before the caller sees a row: if the statement moved the role or the
        // tenant by any path refusedSql does not know, throw, and the driver
        // rolls the whole transaction back (its writes and the move with it).
        await verifyPin(tx, id, 'a statement changed the tenant pin or the role; tenantDb rolled the transaction back')
        return result
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
      if (readOnly && isWriteShaped(statement.text)) {
        return Promise.reject(new TenantContextError('tenantDb refused the SQL: this transaction is read-only'))
      }
      return transaction(async (q) => (await q.run<R>(statement)).rows)
    },
    transaction,
  }
}

/** Stellr is tenant #1: tenantDb(STELLR_TENANT_ID) is how Stellr's own reads will run (S5). */
export const stellrDb = (opts?: TenantDbOptions): TenantDb => tenantDb(STELLR_TENANT_ID, opts)
