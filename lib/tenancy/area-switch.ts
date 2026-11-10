// The per-area data-path switch (multi-tenancy plan S5, C12).
//
// S5 moves feature areas onto tenantDb (lib/tenancy/db.ts) one at a time. An
// area that has been converted keeps today's service-role read beside its new
// tenantDb read, and this module decides, per area and per call, which one
// answers:
//
//   service  (default) today's read, exactly as before. The tenantDb read is
//            not run, not even built
//   shadow   today's read answers. For a sampled share of calls the tenantDb
//            read also runs, AFTER the response, and the two are compared.
//            A difference is recorded to app_errors with the area, the reason,
//            the row counts and row ids: never a row's content. A shadow
//            failure (a throw, a refusal, a timeout) is recorded the same way
//            and never reaches the request
//   tenant   the tenantDb read answers, and today's read is not run. A failure
//            is the request's failure: there is no fallback to the service
//            read, which would hide the refusal the switch exists to surface
//
// Configuration, from two server-only variables, read on every call:
//
//   TENANT_DB_ENABLED   must be exactly 'true', or every area is service.
//                       The same flag tenantDb itself checks
//   TENANT_DB_AREAS     a comma-separated list of `<area>:<path>` entries:
//                       `events-config:shadow`, `events-config:shadow:0.25`
//                       (a sample rate from 0 to 1; default 1), or
//                       `events-config:tenant`. Empty or unset: every area is
//                       service
//
// An entry that is not one of those forms, names an area that is not in
// DATA_AREAS, or repeats an area, is ignored, so its area stays service: a
// typo can never move live reads. Ignored entries are reported once per
// instance to app_errors, by count only. Nothing here echoes the variable.
//
// Writes: writeArea runs the tenantDb write only in tenant mode. Shadow mode
// writes through the service path alone, because writing twice would apply
// the change twice. For the same reason readArea's shadow read runs on a
// read-only tenantDb (SET TRANSACTION READ ONLY, read back after the pin): a
// write in a shadow callback, or in a function it calls, is refused and
// recorded as tenant_error, never applied.
//
// Callers pass only what the request needs; the environment, the tenant
// database and the mismatch sink are not options. The *WithSeams variants
// take them for tests, and lib/tenancy/db.test.ts fails on any other caller.
//
// What the caller supplies: `tenantId` from its own scope (a staff session's
// tenant, the row's tenant_id), never from request input or the Host, and the
// two reads written to return the same rows. The comparison is
// order-insensitive and normalises the usual differences between supabase-js
// and postgres.js values (timestamps, numerics, bigints); an area whose rows
// differ in other ways passes its own `normalise`.
//
// Nothing calls this yet. C18 converts the first area ('events-config'). Like
// lib/tenancy/db.ts, every file that imports it is named in
// lib/tenancy/db-callers.ts, because it hands its callers a tenantDb.

import 'server-only'
import { createHash } from 'node:crypto'
import { runAfterResponse } from '@/lib/after-response'
import { isTenantDbEnabled, tenantDb, type TenantDb } from './db'
import { assertTenantId, TenantContextError } from './tenant-id'

export { TenantContextError }

/** The variable that names the areas reading through tenantDb. */
export const TENANT_DB_AREAS_ENV = 'TENANT_DB_AREAS'

/**
 * Every area that may be switched. A name not listed here is ignored in
 * TENANT_DB_AREAS and is a type error at a call site. C18 owns the first one;
 * nothing calls dataPath, readArea or writeArea with it yet.
 */
export const DATA_AREAS = ['events-config'] as const
export type DataArea = (typeof DATA_AREAS)[number]

export type DataPath = 'service' | 'shadow' | 'tenant'
export const DATA_PATHS: readonly DataPath[] = ['service', 'shadow', 'tenant']

export interface AreaSetting {
  path: Exclude<DataPath, 'service'>
  /** Shadow only: the share of calls that also run the tenantDb read, 0 to 1. */
  sample: number
}

export interface AreaConfig {
  /** Per area, for the areas set to shadow or tenant. Absent means service. */
  areas: ReadonlyMap<string, AreaSetting>
  /** How many entries were ignored. Never the entries themselves. */
  ignored: number
}

const ENTRY = /^([a-z][a-z0-9-]{0,63}):(shadow|tenant)(?::(0(?:\.\d{1,6})?|1(?:\.0{1,6})?))?$/

/**
 * Parse a TENANT_DB_AREAS value. Pure. An entry that does not parse, names an
 * area outside `known`, gives a rate to `tenant`, or repeats an area is
 * ignored; a repeated area is dropped altogether (both entries), so a
 * conflicting list leaves it on the service path.
 */
export function parseAreas(raw: string | undefined, known: readonly string[] = DATA_AREAS): AreaConfig {
  const areas = new Map<string, AreaSetting>()
  const repeated = new Set<string>()
  let ignored = 0
  for (const part of (raw ?? '').split(',')) {
    const entry = part.trim()
    if (entry === '') continue
    const m = ENTRY.exec(entry)
    if (!m || !known.includes(m[1]) || (m[2] === 'tenant' && m[3] !== undefined)) {
      ignored++
      continue
    }
    const [, area, path, rate] = m
    if (areas.has(area) || repeated.has(area)) {
      if (areas.delete(area)) ignored++
      repeated.add(area)
      ignored++
      continue
    }
    areas.set(area, { path: path as AreaSetting['path'], sample: rate === undefined ? 1 : Number(rate) })
  }
  return { areas, ignored }
}

let cached: { raw: string; config: AreaConfig } | null = null

function configFrom(env: Record<string, string | undefined>): AreaConfig {
  const raw = env[TENANT_DB_AREAS_ENV] ?? ''
  if (cached?.raw !== raw) cached = { raw, config: parseAreas(raw) }
  return cached.config
}

/** This area's setting, or null for service. Service whenever TENANT_DB_ENABLED is not exactly 'true'. */
export function areaSetting(area: string, env: Record<string, string | undefined> = process.env): AreaSetting | null {
  if (!isTenantDbEnabled(env)) return null
  return configFrom(env).areas.get(area) ?? null
}

/** Which path answers for this area: 'service' unless the flag is on and the area is listed. */
export function dataPath(area: DataArea, env: Record<string, string | undefined> = process.env): DataPath {
  return areaSetting(area, env)?.path ?? 'service'
}

// ── Comparison ───────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const INTEGER_ID = /^\d{1,19}$/
/** A slug with at least one hyphen (event slugs). A single word is not shown: it could be a name. */
const SLUG_ID = /^[a-z0-9]+(?:-[a-z0-9]+)+$/
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/
const NUMERIC = /^-?\d+(?:\.\d+)?$/

/** Id forms an area may opt in to showing, beside uuids. */
export type ShowableIdKind = 'integer' | 'slug'

/**
 * The id a mismatch record may show for a row. By default only a uuid. An
 * area may opt in to integer ids or hyphenated slugs (at most 64 characters)
 * through `showIds`. Anything else (an email, a name, free text, or a form
 * the area did not opt in to) is never shown, and the row is compared by
 * content instead.
 */
export function showableId(value: unknown, kinds: readonly ShowableIdKind[] = []): string | null {
  const integers = kinds.includes('integer')
  if (typeof value === 'number') return integers && Number.isSafeInteger(value) && value >= 0 ? String(value) : null
  if (typeof value === 'bigint') return integers && value >= BigInt(0) ? value.toString() : null
  if (typeof value !== 'string' || value.length > 64) return null
  if (UUID.test(value)) return value.toLowerCase()
  if (integers && INTEGER_ID.test(value)) return value
  if (kinds.includes('slug') && SLUG_ID.test(value)) return value
  return null
}

/**
 * A value in a form both drivers agree on: object keys sorted, undefined
 * dropped, Dates and timestamp strings as ISO-8601 UTC with milliseconds,
 * numbers, bigints and numeric strings as their shortest decimal text.
 */
export function normaliseValue(value: unknown): unknown {
  if (value === undefined) return undefined
  if (value === null) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'invalid-date' : value.toISOString()
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : `number:${String(value)}`
  if (typeof value === 'string') {
    if (TIMESTAMP.test(value)) {
      const t = new Date(value.replace(' ', 'T'))
      if (!Number.isNaN(t.getTime())) return t.toISOString()
    }
    if (NUMERIC.test(value)) {
      const n = Number(value)
      if (Number.isFinite(n) && (value.includes('.') || Number.isSafeInteger(n))) return String(n)
    }
    return value
  }
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : normaliseValue(v)))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      const v = normaliseValue((value as Record<string, unknown>)[k])
      if (v !== undefined) out[k] = v
    }
    return out
  }
  return typeof value
}

/** The rows a read returned: an array as is, null or undefined as none, anything else as one row. */
export function asRows(result: unknown): unknown[] {
  if (Array.isArray(result)) return result
  if (result === null || result === undefined) return []
  return [result]
}

export interface CompareOptions<R> {
  /**
   * The row's id. Default `row.id`. Shown in a mismatch only if showableId
   * accepts it. Never a member number, an email, or a slug built from a
   * person's name: those must not reach app_errors.
   */
  key?: (row: R) => unknown
  /** Applied to each row before hashing (drop a column one path cannot return, say). */
  normalise?: (row: R) => unknown
  /**
   * Id forms shown beside uuids. 'slug' suits event slugs; 'integer' suits a
   * table's own serial id. Neither may be used where the key is a member
   * number or is derived from a person.
   */
  showIds?: readonly ShowableIdKind[]
}

export interface RowFingerprint {
  count: number
  /** Content hash by showable id. */
  byId: Map<string, string>
  /** Content hash counts for rows with no showable id, or a repeated one. */
  unkeyed: Map<string, number>
}

const hashOf = (value: unknown): string =>
  createHash('sha256')
    .update(JSON.stringify(normaliseValue(value)) ?? 'undefined')
    .digest('hex')

/** Hash every row now, so a later change to the objects (by the route) cannot move the comparison. */
export function fingerprint<R>(result: unknown, opts: CompareOptions<R> = {}): RowFingerprint {
  const rows = asRows(result) as R[]
  const byId = new Map<string, string>()
  const unkeyed = new Map<string, number>()
  for (const row of rows) {
    const hash = hashOf(opts.normalise ? opts.normalise(row) : row)
    const raw = opts.key ? opts.key(row) : row && typeof row === 'object' ? (row as Record<string, unknown>).id : undefined
    const id = showableId(raw, opts.showIds)
    if (id !== null && !byId.has(id)) byId.set(id, hash)
    else unkeyed.set(hash, (unkeyed.get(hash) ?? 0) + 1)
  }
  return { count: rows.length, byId, unkeyed }
}

export type MismatchReason = 'count' | 'ids' | 'content' | 'tenant_error' | 'timeout' | 'no_tenant'

/** What a shadow mismatch records. Counts and ids only: never a row's content or an error's text. */
export interface ShadowMismatch {
  area: string
  label: string
  reason: MismatchReason
  serviceCount: number
  tenantCount: number | null
  /** Ids only the service read returned (at most MAX_IDS). */
  onlyService: string[]
  /** Ids only the tenant read returned (at most MAX_IDS). */
  onlyTenant: string[]
  /** Ids both returned with different content (at most MAX_IDS). */
  differ: string[]
  /** For tenant_error: a Postgres SQLSTATE or an error class name. */
  errorCode: string | null
}

/** Ids listed per side in one record; the counts carry the rest. */
export const MAX_IDS = 10

function sameMultiset(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false
  for (const [k, n] of a) if (b.get(k) !== n) return false
  return true
}

/**
 * Compare two fingerprints. Null when they hold the same rows (in any order);
 * otherwise the mismatch, without the area and label, which the caller adds.
 */
export function compareFingerprints(
  service: RowFingerprint,
  tenant: RowFingerprint,
): Omit<ShadowMismatch, 'area' | 'label'> | null {
  const onlyService = [...service.byId.keys()].filter((id) => !tenant.byId.has(id))
  const onlyTenant = [...tenant.byId.keys()].filter((id) => !service.byId.has(id))
  const differ = [...service.byId.keys()].filter((id) => tenant.byId.has(id) && tenant.byId.get(id) !== service.byId.get(id))
  const unkeyedSame = sameMultiset(service.unkeyed, tenant.unkeyed)
  if (service.count === tenant.count && !onlyService.length && !onlyTenant.length && !differ.length && unkeyedSame) return null
  const reason: MismatchReason =
    service.count !== tenant.count ? 'count' : onlyService.length || onlyTenant.length ? 'ids' : 'content'
  return {
    reason,
    serviceCount: service.count,
    tenantCount: tenant.count,
    onlyService: onlyService.slice(0, MAX_IDS),
    onlyTenant: onlyTenant.slice(0, MAX_IDS),
    differ: differ.slice(0, MAX_IDS),
    errorCode: null,
  }
}

/** Compare two reads' rows directly (the two-tenant kit uses this to hold both paths equal). */
export function compareRows<R>(service: unknown, tenant: unknown, opts: CompareOptions<R> = {}) {
  return compareFingerprints(fingerprint(service, opts), fingerprint(tenant, opts))
}

// ── Recording ────────────────────────────────────────────────────────────────

const ERROR_CODE = /^[A-Za-z0-9_]{1,40}$/

/** A Postgres SQLSTATE or an error class name, never the message (it can carry values). */
export function errorCodeOf(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code
  if (typeof code === 'string' && ERROR_CODE.test(code)) return code
  const name = err instanceof Error ? err.name : ''
  return ERROR_CODE.test(name) ? name : 'unknown'
}

const LABEL = /^[A-Za-z0-9 /[\]._:-]{1,120}$/

/** The text of the app_errors row: fixed labels, counts and showable ids only. */
export function mismatchMessage(m: ShadowMismatch): string {
  const ids = (xs: string[]) => (xs.length ? xs.join(',') : '-')
  return (
    `tenantdb_shadow_mismatch area=${m.area} reason=${m.reason} ` +
    `service=${m.serviceCount} tenant=${m.tenantCount ?? '-'} ` +
    `only_service=${ids(m.onlyService)} only_tenant=${ids(m.onlyTenant)} differ=${ids(m.differ)}` +
    (m.errorCode ? ` error=${m.errorCode}` : '')
  )
}

/**
 * lib/app-errors pulls in the mailer, so it loads only when there is a row to
 * write. recordBuiltAppError, not captureRequestError: the scrubber would
 * blank the uuids the row exists to carry, and the message holds nothing a
 * request supplied. Same per-instance rate limit as every app_errors write.
 */
async function recordMismatch(m: ShadowMismatch): Promise<void> {
  const { errorDigest, recordBuiltAppError, routeLabel } = await import('@/lib/app-errors')
  const route = routeLabel('TENANTDB', m.label, undefined)
  const message = mismatchMessage(m)
  if (!(await recordBuiltAppError(route, message, errorDigest(`${route}\n${m.area}\n${m.reason}`, message)))) {
    console.error('[area-switch] shadow mismatch record failed')
  }
}

const reportedIgnored = new Set<string>()

/**
 * Once per instance per value: how many TENANT_DB_AREAS entries were ignored.
 * The write is registered with after() (runAfterResponse), so a frozen
 * instance does not drop it. Never throws.
 */
function reportIgnored(env: Record<string, string | undefined>): void {
  const raw = env[TENANT_DB_AREAS_ENV] ?? ''
  const { ignored } = configFrom(env)
  if (ignored === 0 || reportedIgnored.has(raw)) return
  reportedIgnored.add(raw)
  runAfterResponse('area-switch', async () => {
    try {
      const { errorDigest, recordBuiltAppError } = await import('@/lib/app-errors')
      const route = 'CONFIG TENANT_DB_AREAS'
      const message = `TENANT_DB_AREAS has ${ignored} ignored entr${ignored === 1 ? 'y' : 'ies'}; their areas read through the service path`
      await recordBuiltAppError(route, message, errorDigest(route, message))
    } catch {
      console.error('[area-switch] could not report ignored TENANT_DB_AREAS entries')
    }
  })
}

// ── Reads and writes ─────────────────────────────────────────────────────────

/** Shadow reads running at once on this instance; past this a sampled call is skipped. */
export const MAX_SHADOW_IN_FLIGHT = 2
/** A shadow read slower than this is recorded as a timeout. */
export const SHADOW_TIMEOUT_MS = 5_000

let inFlight = 0

/** Test hook. */
export function resetAreaSwitchState(): void {
  inFlight = 0
  cached = null
  reportedIgnored.clear()
}

/**
 * Test seams. Only readAreaWithSeams and writeAreaWithSeams take them, and
 * lib/tenancy/db.test.ts fails if a file outside the tests calls either: a
 * production caller cannot pick its own environment, tenant database or
 * mismatch sink, so the path is always the server's TENANT_DB_* flags.
 */
export interface SwitchSeams {
  env?: Record<string, string | undefined>
  /** Build the tenant database. Default tenantDb(tenantId, { env, readOnly }). */
  db?: (tenantId: string, o: { readOnly: boolean }) => TenantDb
  /** Shadow: in [0, 1). Default Math.random. */
  random?: () => number
  /** Shadow: run the comparison off the response path. Default runAfterResponse. */
  schedule?: (task: () => Promise<void>) => void
  /** Shadow: where a mismatch goes. Default app_errors. */
  onMismatch?: (m: ShadowMismatch) => void | Promise<void>
  timeoutMs?: number
}

export interface ReadAreaOptions<T, R = unknown> extends CompareOptions<R> {
  /** The tenant the read is for, from the caller's own scope. Checked in shadow and tenant mode only. */
  tenantId: string
  /** Today's read, unchanged. Its result, or its throw, is the answer in service and shadow mode. */
  service: () => Promise<T>
  /**
   * The same read through tenantDb. The answer in tenant mode. In shadow mode
   * it gets a read-only tenantDb: a write in it is refused, by tenantDb and by
   * the database, and recorded as tenant_error.
   */
  tenant: (db: TenantDb) => Promise<T>
  /** A route pattern for the mismatch record, e.g. "GET /api/admin/events/[slug]/settings". Default: the area. */
  label?: string
}

function timeout(ms: number): { promise: Promise<'timeout'>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  const promise = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms)
  })
  return { promise, cancel: () => clearTimeout(timer) }
}

function tenantDbFor(opts: SwitchSeams, readOnly: boolean): (tenantId: string) => TenantDb {
  if (opts.db) {
    const build = opts.db
    return (tenantId) => build(tenantId, { readOnly })
  }
  return (tenantId) => tenantDb(tenantId, { env: opts.env ?? process.env, readOnly })
}

/**
 * Read one area through the configured path. Service: `service()` only.
 * Tenant: `tenant(db)` only, and its failure is the caller's. Shadow:
 * `service()` answers; for a sampled share of calls its rows are hashed at
 * once and `tenant(db)` runs after the response on a read-only tenantDb, then
 * the two are compared and any difference recorded. Nothing the shadow side
 * does can throw here, delay the return, or change the answer.
 *
 * Only the options below are read: anything else on `opts` is dropped, so the
 * path always follows this server's environment.
 */
export function readArea<T, R = unknown>(area: DataArea, opts: ReadAreaOptions<T, R>): Promise<T> {
  const { tenantId, service, tenant, label, key, normalise, showIds } = opts
  return readAreaWithSeams(area, { tenantId, service, tenant, label, key, normalise, showIds })
}

/** readArea with test seams. Tests only (lib/tenancy/db.test.ts holds every caller to that). */
export async function readAreaWithSeams<T, R = unknown>(area: DataArea, opts: ReadAreaOptions<T, R> & SwitchSeams): Promise<T> {
  const env = opts.env ?? process.env
  const setting = areaSetting(area, env)
  if (setting === null) {
    if (isTenantDbEnabled(env)) safely(() => reportIgnored(env))
    return opts.service()
  }

  if (setting.path === 'tenant') {
    // Fails closed: no tenant, no read, and no service fallback.
    const tenantId = assertTenantId(opts.tenantId)
    return opts.tenant(tenantDbFor(opts, false)(tenantId))
  }

  const result = await opts.service()
  try {
    scheduleShadow(area, setting, result, opts, env)
  } catch (err) {
    console.error('[area-switch] shadow not scheduled:', errorCodeOf(err))
  }
  return result
}

function safely(fn: () => void): void {
  try {
    fn()
  } catch {
    console.error('[area-switch] post-response report not scheduled')
  }
}

function scheduleShadow<T, R>(
  area: DataArea,
  setting: AreaSetting,
  result: T,
  opts: ReadAreaOptions<T, R> & SwitchSeams,
  env: Record<string, string | undefined>,
): void {
  safely(() => reportIgnored(env))
  if ((opts.random ?? Math.random)() >= setting.sample) return
  if (inFlight >= MAX_SHADOW_IN_FLIGHT) return

  const label = typeof opts.label === 'string' && LABEL.test(opts.label) ? opts.label : area
  const compare = { key: opts.key, normalise: opts.normalise, showIds: opts.showIds }
  const serviceFp = fingerprint(result, compare)
  const record = async (m: Omit<ShadowMismatch, 'area' | 'label'>) => {
    try {
      await (opts.onMismatch ?? recordMismatch)({ area, label, ...m })
    } catch {
      console.error('[area-switch] shadow mismatch sink failed')
    }
  }
  const none = { onlyService: [], onlyTenant: [], differ: [] }
  const schedule = opts.schedule ?? defaultSchedule

  let tenantId: string
  try {
    tenantId = assertTenantId(opts.tenantId)
  } catch {
    schedule(() => record({ reason: 'no_tenant', serviceCount: serviceFp.count, tenantCount: null, errorCode: null, ...none }))
    return
  }

  // The slot is held until the tenant read itself settles, not until it loses
  // the race to the timeout: a timed-out read still holds a tenant connection,
  // so a slow tenant database cannot pile up shadow reads past the cap.
  inFlight++
  let released = false
  const release = () => {
    if (!released) {
      released = true
      inFlight--
    }
  }
  const task = async () => {
    const limit = timeout(opts.timeoutMs ?? SHADOW_TIMEOUT_MS)
    const read = Promise.resolve().then(() => opts.tenant(tenantDbFor(opts, true)(tenantId)))
    // A read that loses the race still settles; this also keeps it from ever being unhandled.
    read.then(release, release)
    try {
      const outcome = await Promise.race([read.then((rows) => ({ rows })), limit.promise])
      if (outcome === 'timeout') {
        await record({ reason: 'timeout', serviceCount: serviceFp.count, tenantCount: null, errorCode: null, ...none })
        return
      }
      const diff = compareFingerprints(serviceFp, fingerprint(outcome.rows, compare))
      if (diff) await record(diff)
    } catch (err) {
      await record({ reason: 'tenant_error', serviceCount: serviceFp.count, tenantCount: null, errorCode: errorCodeOf(err), ...none })
    } finally {
      limit.cancel()
    }
  }
  try {
    schedule(task)
  } catch (err) {
    release()
    throw err
  }
}

const defaultSchedule = (task: () => Promise<void>) => runAfterResponse('area-switch', task)

export interface WriteAreaOptions<T> {
  tenantId: string
  /** Today's write, unchanged. Runs in service and shadow mode. */
  service: () => Promise<T>
  /** The same write through tenantDb. Runs in tenant mode only. */
  tenant: (db: TenantDb) => Promise<T>
}

/**
 * Write one area through the configured path. Tenant mode runs `tenant(db)`
 * alone; service and shadow mode run `service()` alone, so a write is never
 * applied twice. Only the options above are read.
 */
export function writeArea<T>(area: DataArea, opts: WriteAreaOptions<T>): Promise<T> {
  const { tenantId, service, tenant } = opts
  return writeAreaWithSeams(area, { tenantId, service, tenant })
}

/** writeArea with test seams. Tests only (lib/tenancy/db.test.ts holds every caller to that). */
export async function writeAreaWithSeams<T>(
  area: DataArea,
  opts: WriteAreaOptions<T> & Pick<SwitchSeams, 'env' | 'db'>,
): Promise<T> {
  const env = opts.env ?? process.env
  if (dataPath(area, env) !== 'tenant') return opts.service()
  const tenantId = assertTenantId(opts.tenantId)
  return opts.tenant(tenantDbFor(opts, false)(tenantId))
}
