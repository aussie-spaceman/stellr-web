// loadScoped(): load one row by id, but only if it belongs to the caller's
// scope (multi-tenancy plan S5, the global-id admin routes).
//
// Today ~131 admin routes take a record id from the path or body and load it
// with a bare `.eq('id', id)`. That is safe only while every staff member is
// Stellr's. loadScoped adds the tenant and event filters from the table
// registry (lib/tenancy/registry.ts), so the same id from another tenant, or
// from an event the caller is not assigned to, is simply not found.
//
//   own / derived tables   tenant_id = scope.tenantId. In Stellr scope, while
//                          the S3 derivation still runs in log mode, a
//                          derived table also matches tenant_id IS NULL, so
//                          Stellr never loses a row it sees today. Plus the
//                          event key IN scope.eventSlugs for an event-scoped
//                          caller
//   inherited tables       an inner embed of the parent, carrying the same
//                          tenant and event filters on the parent's columns.
//                          The embed is removed from the row before it is
//                          returned, so the body is the legacy body
//   platform, stellr_only, no tenant column: allowed in Stellr scope only;
//   identity, system       any other scope throws TenantContextError. Wrapped
//                          data keys are never read here, and the platform
//                          audit and admin tables need a platform actor
//
// No existence oracle. A malformed id, a missing row, another tenant's row and
// another event's row all return the route's OWN notFound() response, built
// fresh each time, so status, headers and body are identical. A malformed id
// (or an event scope that reaches no event) returns it without a database
// call; an id the column's type cannot hold (22P02) returns it too.
//
// Modes, from LOADSCOPED_MODE (per call, `mode` overrides). They apply only to
// Stellr's own tenant-wide scope, which is what today's routes run as:
//   off      (default) the legacy query only — behaviour is exactly today's.
//            The scope is not even planned
//   shadow   run legacy and scoped; return the legacy result; log any
//            difference (found vs not found, or a different row) to
//            app_errors through lib/app-errors.ts. Never throws for the scope
//   enforce  run the scoped query only and return its result
// Every other scope (another tenant, or an event-narrowed caller) always runs
// as enforce, whatever the mode says. These filters are the only tenant or
// event check on a global-id route, so handing such a caller the legacy row
// and logging it would be the leak itself.
//
// An unrecognised value is treated as off, so a typo can never change live
// behaviour, and is reported once per instance to app_errors. The admin health
// route reports the resolved mode, and the flip runbook reads it there.
//
// Event-narrowed scopes throw on tables with no slug event key (identity and
// Sanity-keyed tables). A route that loads such a row for an event manager
// makes its own event check, then passes the unnarrowed Stellr scope.
//
// Converted routes keep their own 404 body via notFound, and go through
// loadRecord or loadEventRecord below, which hold today's query for off and shadow.
// The backend is a filtered service-role read through supabase-js; a tenantDb
// backend (lib/tenancy/db.ts) slots in behind TENANT_DB_ENABLED when its
// driver lands, and is added to lib/tenancy/db-callers.ts then — this module
// does not import db.ts.

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadEventTenantId } from '@/lib/authz/principal'
import { STELLR_TENANT_ID, type DerivationMode } from './constants'
import { loadScopedMode, reportUnrecognisedMode, type LoadScopedMode } from './load-scoped-mode'
import { TABLE_REGISTRY, type TableEntry } from './registry'
import { assertMadeScope, isStellrScope, type ScopeContext } from './scope-context'
import { TenantContextError } from './tenant-id'

export { TenantContextError }

export { LOADSCOPED_MODES, LOADSCOPED_MODE_ENV, loadScopedMode, type LoadScopedMode } from './load-scoped-mode'

// ── Ids ──────────────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KEY = /^[A-Za-z0-9._:-]{1,200}$/

/** A uuid, any version, either case. */
export function isUuid(id: unknown): id is string {
  return typeof id === 'string' && UUID.test(id)
}

/** A slug-like key (for idColumn other than id): 1–200 of A–Z a–z 0–9 . _ : - */
export function isKey(id: unknown): id is string {
  return typeof id === 'string' && KEY.test(id)
}

// ── Planning: which filters a scope puts on a table ──────────────────────────

/** The alias of the parent embed on via_parent tables; stripped from rows. */
export const SCOPE_EMBED_ALIAS = 'stellr_scope_parent'

/**
 * The NULL tenant fallback while no caller says otherwise. S3 derivation runs
 * in log mode today. Remove this at the S3 enforce cut-over, with the plan's
 * includeNull, once tenancy_cutover_checks shows no NULL tenant_id.
 */
const DEFAULT_DERIVATION_MODE: DerivationMode = 'log'

/** Wrapped data keys. Only lib/field-crypto-store.ts reads them. */
const NEVER_LOADED = new Set(['public.tenant_data_keys'])

/** Platform-wide tables holding every tenant's rows; other actors never read them here. */
const PLATFORM_ACTORS_ONLY = new Set(['public.platform_admins', 'public.platform_audit_events'])

/**
 * Child tables whose parent key is deliberately not a foreign key, so PostgREST
 * has no relationship to embed. S5 C0b gave them their own tenant_id; scoping on
 * it directly is for the slice that first reads them this way. load-scoped.test.ts
 * checks this list and the single foreign key of every other child table against
 * the schema.
 */
export const VIA_PARENT_WITHOUT_FK: ReadonlySet<string> = new Set(['public.esign_access_log', 'public.esign_audit_events'])

/** Own tables with a column naming their event, for event-scoped callers. */
const OWN_EVENT_COLUMN: Record<string, string> = {
  'public.events': 'slug',
}

export interface TenantFilter {
  column: string
  value: string
  /** Also match tenant_id IS NULL (Stellr scope, derived table, log mode). */
  includeNull: boolean
}

export interface ScopePlan {
  /** Registry key, e.g. "public.registrations". */
  table: string
  schema: string
  name: string
  entry: TableEntry
  /** The filters apply to the parent embed (via_parent) or to the row itself. */
  target: 'row' | 'parent'
  tenant: TenantFilter | null
  event: { column: string; values: readonly string[] } | null
  embed: { alias: string; parent: string; columns: string } | null
  /** The scope reaches no row of this table at all (an empty event list). */
  reachesNothing: boolean
}

/** "registrations" -> "public.registrations"; "entitlements.x" stays. */
export function registryKey(table: string): string {
  const t = table.trim()
  return t.includes('.') ? t : `public.${t}`
}

function split(key: string): { schema: string; name: string } {
  const i = key.indexOf('.')
  return { schema: key.slice(0, i), name: key.slice(i + 1) }
}

/**
 * The filters `scope` puts on `table`. Pure. Throws TenantContextError (fail
 * closed) for an unknown table, a non-Stellr scope on a table with no tenant
 * column, an event-scoped caller on a table with no slug event key, a
 * via_parent table whose parent is not slug-derived or not a foreign key, a
 * scope that did not come from makeScope, or a table on the deny lists above.
 */
export function planScope(
  scope: ScopeContext,
  table: string,
  opts: { derivationMode?: DerivationMode } = {},
): ScopePlan {
  assertMadeScope(scope)
  const key = registryKey(table)
  if (NEVER_LOADED.has(key)) throw new TenantContextError(`loadScoped: ${key} is never read through a scope`)
  if (PLATFORM_ACTORS_ONLY.has(key) && scope.actor.kind !== 'platform_admin' && scope.actor.kind !== 'system') {
    throw new TenantContextError(`loadScoped: ${key} needs a platform actor`)
  }
  const entry = TABLE_REGISTRY[key]
  if (!entry) throw new TenantContextError(`loadScoped: ${key} is not in the table registry`)
  const { schema, name } = split(key)
  const stellr = isStellrScope(scope)
  const logMode = (opts.derivationMode ?? DEFAULT_DERIVATION_MODE) === 'log'
  const slugs = scope.eventSlugs
  const base = { table: key, schema, name, entry }

  if (entry.tenantColumn === 'none') {
    if (!stellr) throw new TenantContextError(`loadScoped: ${key} is ${entry.class}; only Stellr scope may read it`)
    if (slugs !== null) {
      throw new TenantContextError(`loadScoped: ${key} has no event key; an event-scoped caller cannot read it`)
    }
    return { ...base, target: 'row', tenant: null, event: null, embed: null, reachesNothing: false }
  }

  // Still filtered on the parent: this also works before the C0b migration
  // reaches a database, and it is the event filter's only route to the slug.
  if (entry.tenantColumn === 'via_parent' || entry.tenantColumn === 'inherited') {
    if (VIA_PARENT_WITHOUT_FK.has(key)) {
      throw new TenantContextError(`loadScoped: ${key} has no foreign key to embed its parent through`)
    }
    const parentKey = entry.parent!
    const parent = TABLE_REGISTRY[parentKey]
    if (!parent || parent.tenantColumn !== 'derived' || parent.eventKey?.kind !== 'slug') {
      throw new TenantContextError(`loadScoped: ${key} needs a slug-derived parent; ${parentKey} is not`)
    }
    const parentName = split(parentKey).name
    const eventColumn = parent.eventKey.column
    return {
      ...base,
      target: 'parent',
      tenant: { column: 'tenant_id', value: scope.tenantId, includeNull: stellr && logMode },
      event: slugs === null ? null : { column: eventColumn, values: slugs },
      embed: { alias: SCOPE_EMBED_ALIAS, parent: parentName, columns: `tenant_id,${eventColumn}` },
      reachesNothing: slugs !== null && slugs.length === 0,
    }
  }

  // own or derived: the row carries tenant_id.
  let eventColumn: string | null = null
  if (slugs !== null) {
    if (entry.tenantColumn === 'derived') {
      if (entry.eventKey?.kind !== 'slug') {
        throw new TenantContextError(`loadScoped: ${key} is keyed by a Sanity id; an event-scoped caller cannot read it yet`)
      }
      eventColumn = entry.eventKey.column
    } else {
      eventColumn = OWN_EVENT_COLUMN[key] ?? null
      if (!eventColumn) {
        throw new TenantContextError(`loadScoped: ${key} is tenant-wide; an event-scoped caller cannot read it`)
      }
    }
  }
  return {
    ...base,
    target: 'row',
    tenant: {
      column: 'tenant_id',
      value: scope.tenantId,
      // own tables are NOT NULL; only derived tables can still hold NULL.
      includeNull: stellr && logMode && entry.tenantColumn === 'derived',
    },
    event: eventColumn === null ? null : { column: eventColumn, values: slugs! },
    embed: null,
    reachesNothing: slugs !== null && slugs.length === 0,
  }
}

// ── Query building ───────────────────────────────────────────────────────────

interface QueryResult {
  data: unknown
  error: unknown
}

/** The slice of a supabase-js filter builder this module uses. */
export interface ScopedFilterBuilder extends PromiseLike<QueryResult> {
  eq(column: string, value: unknown): ScopedFilterBuilder
  in(column: string, values: readonly unknown[]): ScopedFilterBuilder
  or(filters: string, options?: { referencedTable?: string }): ScopedFilterBuilder
  maybeSingle(): PromiseLike<QueryResult>
}

interface ScopedTableSource {
  from(table: string): { select(columns: string): ScopedFilterBuilder }
}

/** The slice of a supabase-js client this module uses. */
export interface ScopedDb extends ScopedTableSource {
  schema?(name: string): ScopedTableSource
}

/**
 * A supabase-js client or a ScopedDb. Deliberately shallow: a union naming
 * SupabaseClient fails real callers with TS2589 (excessively deep comparison).
 */
type AnyDb = { from: unknown; schema?: unknown }

function source(db: AnyDb, schema: string): ScopedTableSource {
  const d = db as unknown as ScopedDb
  if (schema === 'public') return d
  if (typeof d.schema !== 'function') throw new TenantContextError(`loadScoped: the client cannot reach schema ${schema}`)
  return d.schema(schema)
}

function applyPlan(builder: ScopedFilterBuilder, plan: ScopePlan): ScopedFilterBuilder {
  let q = builder
  const prefix = plan.target === 'parent' ? `${plan.embed!.alias}.` : ''
  if (plan.tenant) {
    const { column, value, includeNull } = plan.tenant
    if (includeNull) {
      // value is a validated tenant uuid (makeScope), never caller text.
      const expr = `${column}.eq.${value},${column}.is.null`
      q = plan.target === 'parent' ? q.or(expr, { referencedTable: plan.embed!.alias }) : q.or(expr)
    } else {
      q = q.eq(`${prefix}${column}`, value)
    }
  }
  if (plan.event) q = q.in(`${prefix}${plan.event.column}`, plan.event.values)
  return q
}

function selectWithEmbed(select: string, plan: ScopePlan): string {
  if (!plan.embed) return select
  const { alias, parent, columns } = plan.embed
  return `${select},${alias}:${parent}!inner(${columns})`
}

/** A row with the scope's parent embed removed (identity for other rows). */
export function stripScopeEmbed<T>(row: T): T {
  if (!row || typeof row !== 'object' || !(SCOPE_EMBED_ALIAS in (row as object))) return row
  const { [SCOPE_EMBED_ALIAS]: _drop, ...rest } = row as Record<string, unknown>
  void _drop
  return rest as T
}

/**
 * A select on `table` with the scope's filters already applied, for list
 * queries and child lookups (chain more filters onto it). On a via_parent
 * table each row carries the parent embed: pass rows through
 * stripScopeEmbed() before returning them. An empty event list applies an
 * empty IN, which matches no row. Throws as planScope does.
 */
export function scopedQuery(
  scope: ScopeContext,
  table: string,
  opts: { db: AnyDb; select?: string; derivationMode?: DerivationMode },
): ScopedFilterBuilder {
  const plan = planScope(scope, table, { derivationMode: opts.derivationMode })
  const builder = source(opts.db, plan.schema).from(plan.name).select(selectWithEmbed(opts.select ?? '*', plan))
  return applyPlan(builder, plan)
}

// ── loadScoped ───────────────────────────────────────────────────────────────

export type LoadScopedResult<T> =
  | { ok: true; row: T }
  | { ok: false; response: Response }
  | { ok: false; response?: undefined; error: unknown }

export interface ShadowMismatch {
  table: string
  label: string
  reason: 'presence' | 'row' | 'scoped_error' | 'plan_error'
  legacyFound: boolean
  scopedFound: boolean
  actorKind: string
}

export interface LoadScopedOptions<T> {
  db: AnyDb
  /** The route's own not-found response. Called afresh for every miss. */
  notFound: () => Response
  /** Columns to select (default '*'). */
  select?: string
  /** The column the id is matched against (default 'id'). */
  idColumn?: string
  /**
   * Id format check; default isUuid for idColumn 'id', isKey otherwise. A table
   * with bigint ids (credential_events) must pass its own: isUuid finds nothing.
   */
  isValidId?: (id: unknown) => boolean
  /** Today's query, unchanged. Required in off and shadow modes; only Stellr's tenant-wide scope ever runs it. */
  legacy?: () => PromiseLike<{ data: T | null; error: unknown }>
  mode?: LoadScopedMode
  /** tenancy_settings.derivation_mode; default 'log' (today's value). */
  derivationMode?: DerivationMode
  /** A label for the shadow log, e.g. "POST /api/admin/credentials/[id]/resend". */
  label?: string
  /** Shadow-mode sink (tests). Default: app_errors via lib/app-errors.ts. */
  onMismatch?: (m: ShadowMismatch) => void | Promise<void>
}

async function defaultMismatchSink(m: ShadowMismatch): Promise<void> {
  const { captureRequestError } = await import('@/lib/app-errors')
  const message =
    `loadScoped shadow mismatch: ${m.table} ${m.reason} ` +
    `(legacy ${m.legacyFound ? 'found' : 'missing'}, scoped ${m.scopedFound ? 'found' : 'missing'}, ` +
    `actor ${m.actorKind})`
  await captureRequestError(new Error(message), { method: 'LOADSCOPED', path: m.label }, { routePath: m.label })
}

async function report(opts: LoadScopedOptions<unknown>, m: ShadowMismatch): Promise<void> {
  try {
    await (opts.onMismatch ?? defaultMismatchSink)(m)
  } catch (e) {
    console.error('[load-scoped] shadow log failed:', e instanceof Error ? e.message : e)
  }
}

/** Postgres invalid_text_representation: the id cannot be cast to the column's type. */
function isMalformedIdError(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code === '22P02'
}

function idOf(row: unknown, column: string): unknown {
  return row && typeof row === 'object' ? (row as Record<string, unknown>)[column] : undefined
}

async function runScoped<T>(
  scope: ScopeContext,
  table: string,
  id: string,
  opts: LoadScopedOptions<T>,
  plan: ScopePlan,
): Promise<{ data: T | null; error: unknown }> {
  const column = opts.idColumn ?? 'id'
  const builder = source(opts.db, plan.schema).from(plan.name).select(selectWithEmbed(opts.select ?? '*', plan))
  const { data, error } = await applyPlan(builder.eq(column, id), plan).maybeSingle()
  // The tenant and event values are validated, so only the id can fail the cast.
  if (error) return { data: null, error: isMalformedIdError(error) ? null : error }
  return { data: data == null ? null : stripScopeEmbed(data as T), error: null }
}

/**
 * Load one row of `table` by `id`, inside `scope`. Returns the row, the
 * route's notFound() response, or (legacy or database failure) the error for
 * the route to handle as it does today. A scope other than Stellr's tenant-wide
 * one always runs as enforce. Throws TenantContextError in enforce when the
 * scope may not read the table at all, and a TypeError when off or shadow mode
 * is used without a legacy query.
 */
export async function loadScoped<T = Record<string, unknown>>(
  scope: ScopeContext,
  table: string,
  id: unknown,
  opts: LoadScopedOptions<T>,
): Promise<LoadScopedResult<T>> {
  assertMadeScope(scope)
  if (opts.mode === undefined) await reportUnrecognisedMode()
  const requested = opts.mode ?? loadScopedMode()
  const mode = isStellrScope(scope) && scope.eventSlugs === null ? requested : 'enforce'
  const column = opts.idColumn ?? 'id'
  const valid = (opts.isValidId ?? (column === 'id' ? isUuid : isKey))(id)

  if (requested === 'off' || requested === 'shadow') {
    if (typeof opts.legacy !== 'function') throw new TypeError(`loadScoped: ${requested} mode needs the legacy query`)
  }

  if (mode === 'off') {
    const { data, error } = await opts.legacy!()
    if (error) return { ok: false, error }
    return data == null ? { ok: false, response: opts.notFound() } : { ok: true, row: data }
  }

  if (mode === 'shadow') {
    const label = opts.label ?? registryKey(table)
    const base = { table: registryKey(table), label, actorKind: scope.actor.kind }
    let plan: ScopePlan | null = null
    let planFailed = false
    try {
      plan = planScope(scope, table, { derivationMode: opts.derivationMode })
    } catch {
      planFailed = true
    }
    const skipScoped = planFailed || !valid
    const [legacy, scoped] = await Promise.all([
      opts.legacy!(),
      skipScoped
        ? Promise.resolve({ data: null, error: null })
        : runScoped(scope, table, id as string, opts, plan!).catch((e: unknown) => ({ data: null, error: e })),
    ])
    const legacyFound = !legacy.error && legacy.data != null
    const scopedFound = !scoped.error && scoped.data != null
    let reason: ShadowMismatch['reason'] | null = null
    if (planFailed) reason = 'plan_error'
    else if (scoped.error) reason = 'scoped_error'
    else if (!legacy.error && legacyFound !== scopedFound) reason = 'presence'
    else if (legacyFound && scopedFound && idOf(legacy.data, column) !== idOf(scoped.data, column)) reason = 'row'
    if (reason) await report(opts as LoadScopedOptions<unknown>, { ...base, reason, legacyFound, scopedFound })
    if (legacy.error) return { ok: false, error: legacy.error }
    return legacyFound ? { ok: true, row: legacy.data as T } : { ok: false, response: opts.notFound() }
  }

  // enforce
  const plan = planScope(scope, table, { derivationMode: opts.derivationMode })
  if (!valid || plan.reachesNothing) return { ok: false, response: opts.notFound() }
  const { data, error } = await runScoped(scope, table, id as string, opts, plan)
  if (error) return { ok: false, error }
  return data == null ? { ok: false, response: opts.notFound() } : { ok: true, row: data }
}

// ── For route files (S5 C16) ─────────────────────────────────────────────────
//
// A file classed tenant_crew may not call .from() on a table holding tenant rows
// (test/route-manifest.test.ts), and that covers the legacy query loadScoped needs in
// off and shadow modes, and the write after a load. So today's queries live here.

/** The mode that applies to this scope: anything but Stellr's tenant-wide scope is enforced. */
function modeFor(scope: ScopeContext, requested: LoadScopedMode | undefined): LoadScopedMode {
  const mode = requested ?? loadScopedMode()
  return isStellrScope(scope) && scope.eventSlugs === null ? mode : 'enforce'
}

/**
 * The answer to a tenant's staff on an action that still runs on Stellr's own accounts and
 * global records: Stripe, and the roster add's member lookups and activity writes. Null in
 * Stellr's scope, which goes on as ever. A route that names a record by global id asks this
 * after loading it, so another tenant's id still answers as a missing one. A route under
 * events/[slug] has already placed the event in the caller's tenant, so it asks first, and
 * every id then gets the same answer.
 */
export function refuseOutsideStellr(scope: ScopeContext): Response | null {
  if (isStellrScope(scope)) return null
  return Response.json({ error: "This isn't available for your organisation yet." }, { status: 503 })
}

/**
 * refuseOutsideStellr checks who is asking; this checks whose event it is. For a route under
 * events/[slug] that acts only on Stellr's accounts and records (its signing accounts, its
 * sender, its store, shared members): another tenant's event is refused for everyone, a Stellr admin
 * included, in every LOADSCOPED_MODE, because off and shadow do not narrow the reads that
 * follow. The owner comes from the events mirror by slug, an unmirrored slug counting as
 * Stellr's (loadEventTenantId). A tenant's event gets the answer requireEventRoute gives an
 * event outside the caller's reach; a failed owner read is a retryable 503, never Stellr's.
 * Null for Stellr's own events, which go on as ever. Ask it before any read about a person,
 * any email and any envelope.
 */
export async function refuseUnlessStellrEvent(db: SupabaseClient, slug: string, label: string): Promise<Response | null> {
  let owner: string
  try {
    owner = await loadEventTenantId(db, slug)
  } catch (err) {
    console.error(`[${label}] event owner lookup failed:`, err instanceof Error ? err.message : err)
    return Response.json(
      { error: 'This is temporarily unavailable. Please try again shortly.' },
      { status: 503, headers: { 'Retry-After': '5', 'Cache-Control': 'no-store' } },
    )
  }
  if (owner === STELLR_TENANT_ID) return null
  return Response.json({ error: 'Not found' }, { status: 404 })
}

export type LoadedRecord<T> = { ok: true; row: T } | { ok: false; response: Response }

/**
 * loadScoped, with today's query as its legacy read. A failed read answers as the route's
 * notFound, which is what these routes did when they ignored the read's error: a row that
 * cannot be read is not acted on, in any mode.
 */
export async function loadRecord<T = Record<string, unknown>>(
  scope: ScopeContext,
  table: string,
  id: unknown,
  opts: Omit<LoadScopedOptions<T>, 'legacy'>,
): Promise<LoadedRecord<T>> {
  const { schema, name } = split(registryKey(table))
  const legacy = () =>
    source(opts.db, schema)
      .from(name)
      .select(opts.select ?? '*')
      .eq(opts.idColumn ?? 'id', id)
      .maybeSingle() as PromiseLike<{ data: T | null; error: unknown }>
  const loaded = await loadScoped<T>(scope, table, id, { ...opts, legacy })
  if (loaded.ok) return loaded
  if (loaded.response) return { ok: false, response: loaded.response }
  // 22P02 is an id the column cannot hold: that is a miss, and the database is fine.
  if (!isMalformedIdError(loaded.error)) console.error(`[load-scoped] ${registryKey(table)} read failed`)
  return { ok: false, response: opts.notFound() }
}

/**
 * loadRecord for a caller who may reach only some events. The row's event must be one
 * they cover, and any other row answers as a missing one, so a refusal does not say the
 * record exists. A row with no event is covered only by someone who reaches every event.
 *
 * The scope stays tenant-wide, as the header above allows for an event check made here:
 * an event-narrowed scope always runs as enforce, and LOADSCOPED_MODE=off has to keep
 * today's read for event managers as well.
 */
export async function loadEventRecord<T extends { event_slug?: string | null }>(
  crew: { scope: ScopeContext; covers: (eventSlug: string | null | undefined) => boolean },
  table: string,
  id: unknown,
  opts: Omit<LoadScopedOptions<T>, 'legacy'>,
): Promise<LoadedRecord<T>> {
  const loaded = await loadRecord<T>(crew.scope, table, id, opts)
  if (loaded.ok && !crew.covers(loaded.row.event_slug)) return { ok: false, response: opts.notFound() }
  return loaded
}

export interface LoadRowsOptions {
  db: AnyDb
  /** Columns to select (default '*'). */
  select?: string
  /** Column = value filters, on the table itself. */
  match: Record<string, unknown>
  order?: { column: string; ascending?: boolean }
  /** At most this many rows. Needs `order`, so which rows is settled. */
  limit?: number
  mode?: LoadScopedMode
  derivationMode?: DerivationMode
  /** A label for the shadow log. */
  label?: string
  onMismatch?: (m: ShadowMismatch) => void | Promise<void>
}

/** The slice of a builder a list read needs beyond ScopedFilterBuilder. */
type Orderable = { order(column: string, opts?: { ascending?: boolean }): PromiseLike<QueryResult> & { limit(count: number): PromiseLike<QueryResult> } }

/**
 * The rows of `table` matching `match`, inside `scope`, under the same modes as
 * loadScoped: off runs today's query, shadow returns it and logs a different row count,
 * enforce runs the scoped query alone. Any scope but Stellr's tenant-wide one is enforced.
 * Shadow compares counts only: not every table has an `id`, and a list that differs by
 * count is what a missing filter looks like.
 */
export async function loadScopedRows<T = Record<string, unknown>>(
  scope: ScopeContext,
  table: string,
  opts: LoadRowsOptions,
): Promise<{ data: T[] | null; error: unknown }> {
  assertMadeScope(scope)
  if (opts.mode === undefined) await reportUnrecognisedMode()
  const mode = modeFor(scope, opts.mode)
  const narrowed = (q: ScopedFilterBuilder) => {
    let out = q
    for (const [column, value] of Object.entries(opts.match)) out = out.eq(column, value)
    if (!opts.order) return out as PromiseLike<QueryResult>
    const ordered = (out as unknown as Orderable).order(opts.order.column, { ascending: opts.order.ascending ?? true })
    return opts.limit === undefined ? ordered : ordered.limit(opts.limit)
  }
  const legacy = async () => {
    const { schema, name } = split(registryKey(table))
    const { data, error } = await narrowed(source(opts.db, schema).from(name).select(opts.select ?? '*'))
    return { data: (data as T[] | null) ?? null, error }
  }
  const scoped = async () => {
    const plan = planScope(scope, table, { derivationMode: opts.derivationMode })
    if (plan.reachesNothing) return { data: [] as T[], error: null }
    const { data, error } = await narrowed(scopedQuery(scope, table, opts))
    return { data: error ? null : ((data as T[] | null) ?? []).map((r) => stripScopeEmbed(r)), error }
  }
  if (mode === 'off') return legacy()
  if (mode === 'enforce') return scoped()
  const [today, withScope] = await Promise.all([legacy(), scoped().catch((e: unknown) => ({ data: null, error: e }))])
  const legacyCount = today.data?.length ?? 0
  const scopedCount = withScope.data?.length ?? 0
  const reason = withScope.error ? 'scoped_error' : !today.error && legacyCount !== scopedCount ? 'row' : null
  if (reason) {
    await report(opts as unknown as LoadScopedOptions<unknown>, {
      table: registryKey(table),
      label: opts.label ?? registryKey(table),
      actorKind: scope.actor.kind,
      reason,
      legacyFound: legacyCount > 0,
      scopedFound: scopedCount > 0,
    })
  }
  return today
}

/** The builder a by-id write hands back: awaited as it is, or asked for the row. */
export interface ScopedWriteBuilder extends PromiseLike<QueryResult> {
  in(column: string, values: readonly unknown[]): ScopedWriteBuilder
  select(columns?: string): { single(): PromiseLike<QueryResult>; maybeSingle(): PromiseLike<QueryResult> }
}

/**
 * Update or delete one row a caller has just loaded. Off and shadow modes write as today,
 * by id alone. Enforced, the write carries the scope's tenant filter too, so it cannot land
 * outside the scope whatever happened since the load. Own and derived tables only: a child
 * table's row has no tenant filter to carry on a write.
 */
export function scopedRowWrite(
  scope: ScopeContext,
  table: string,
  id: string,
  opts: { db: AnyDb; mode?: LoadScopedMode; derivationMode?: DerivationMode },
): { update(values: Record<string, unknown>): ScopedWriteBuilder; delete(): ScopedWriteBuilder } {
  const plan = planScope(scope, table, { derivationMode: opts.derivationMode })
  if (plan.target !== 'row') throw new TenantContextError(`scopedRowWrite: ${plan.table} is a child table`)
  const enforced = modeFor(scope, opts.mode) === 'enforce'
  const table_ = () => source(opts.db, plan.schema).from(plan.name) as unknown as {
    update(values: Record<string, unknown>): ScopedFilterBuilder
    delete(): ScopedFilterBuilder
  }
  const finish = (q: ScopedFilterBuilder) => (enforced ? applyPlan(q.eq('id', id), plan) : q.eq('id', id)) as unknown as ScopedWriteBuilder
  return {
    update: (values) => finish(table_().update(values)),
    delete: () => finish(table_().delete()),
  }
}

/**
 * The tenant filter a list spanning several rows must carry for this scope, or null when
 * the mode leaves today's query alone (off and shadow, in Stellr's tenant-wide scope). For
 * a lib helper that builds its own query and cannot take a scope.
 */
export function enforcedTenantFilter(scope: ScopeContext, table: string, opts: { mode?: LoadScopedMode; derivationMode?: DerivationMode } = {}): TenantFilter | null {
  if (modeFor(scope, opts.mode) !== 'enforce') return null
  return planScope(scope, table, { derivationMode: opts.derivationMode }).tenant
}
