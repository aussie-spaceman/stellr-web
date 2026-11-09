import type { SupabaseClient } from '@supabase/supabase-js'
import { startTenantRun, type CronRun } from './cron-runs'
import { STELLR_TENANT_ID } from './tenancy/constants'
import { makeScope, type ScopeContext } from './tenancy/scope-context'

// The per-tenant cron runner (S5 B3). B13 moved surveys, team-profiles and
// survey-retention onto it; B14 moves the rest of the per-tenant crons
// (lib/cron-scope.ts).
//
// A cron partitions the work list it already fetched and hands the runner the
// tenant ids that have work. It is not a loop over the tenants table, so cost
// follows work, not tenant count, and vercel.json keeps its schedules.
//
// A run that only touches Stellr is a plain call: no read of `tenants`, the
// whole budget, no child ledger row, no change to failure labels or to the run's
// result JSON. So crons keep today's ledger on
// production, and nothing writes the new cron_runs columns until a second tenant
// has work. A run with no work at all reads nothing and adds nothing.
//
// When more than one tenant has work, the runner enforces the slices: a tenant
// still running past its slice plus overrunMs is aborted through `signal`, marked
// failed, and the next tenant starts. Promises cannot be cancelled, so `fn` must
// honour the signal or its work carries on in the background.

/** Result key that carries the rotation cursor from one run to the next. */
export const TENANT_CURSOR_KEY = 'tenantCursor'

const DEFAULT_FLOOR_MS = 5_000
const DEFAULT_OVERRUN_MS = 5_000
const TIMED_OUT = Symbol('timed out')

/**
 * Stellr's seeded row (tenancy_core migration). Used for a Stellr-only run, which
 * skips the read, and when `tenants` cannot be read, so that Stellr's work still runs.
 */
const STELLR_FALLBACK: CronTenant = {
  id: STELLR_TENANT_ID,
  status: 'active',
  timeZone: 'America/Denver',
  isPlatformOwner: true,
}

export interface CronTenant {
  id: string
  status: string
  timeZone: string
  isPlatformOwner: boolean
}

export interface TenantJob {
  tenant: CronTenant
  /** This tenant's system scope. Reads inside `fn` go through it (scopedQuery, loadScoped), not the raw client. */
  scope: ScopeContext
  /** Epoch ms this tenant should stop starting work. Never later than the run's own deadline. */
  deadline: number
  /** Aborted when this tenant overran its slice and the runner has moved on. Stop work when it fires. */
  signal: AbortSignal
  /** Record one per-item failure against this tenant. Marks the run not ok. */
  fail(where: string, err: unknown): void
}

export interface RunPerTenantOptions<R extends Record<string, unknown>> {
  job: string
  /** Epoch ms the whole run should stop starting work. Leave overrunMs clear of the route's maxDuration. */
  deadline: number
  /** The tenants with work, from partitionByTenant. Omit to run every active tenant. */
  tenantIds?: readonly string[]
  fn: (job: TenantJob) => Promise<R>
  /** Smallest time slice, so one slow tenant cannot leave the next with nothing. */
  floorMs?: number
  /** How long past its slice a tenant may finish its current item before the runner moves on. */
  overrunMs?: number
  /**
   * Cron fairness is an open owner decision (docs/TENANCY-S5.md, Owner gates).
   * Until it is made, leaving this out keeps Stellr first.
   */
  fairness?: 'rotate' | 'stellr_first'
  /**
   * Also run tenants that are not active. Outbound mail leaves this off. Retention
   * and erasure work turns it on, because offboarding does not stop the retention
   * clock on a tenant's data (lib/cron-scope.ts, inactiveTenants).
   */
  includeInactive?: boolean
  now?: () => number
}

export interface PerTenantOutcome<R> {
  results: Map<string, R>
  /** Tenants passed over because they are not active. Stellr is never here. */
  skipped: string[]
  /** Tenants the deadline cut off; the next run starts with them. */
  notReached: string[]
  /** Spread into the run's result. Empty for a Stellr-only run. */
  ledger: Record<string, unknown>
}

/**
 * Groups rows by tenant, keeping their order. NULL tenant_id goes to Stellr, which
 * is what derivation stamps. A row with no tenant_id key at all means the query
 * left the column out, which would file every tenant's rows under Stellr, so it
 * throws rather than guess.
 */
export function partitionByTenant<T extends { tenant_id: string | null }>(rows: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    if (row.tenant_id === undefined) throw new Error('partitionByTenant: row has no tenant_id; select the column')
    const key = row.tenant_id ?? STELLR_TENANT_ID
    const group = groups.get(key)
    if (group) group.push(row)
    else groups.set(key, [row])
  }
  return groups
}

/** Sorted ids rotated to start at the cursor: the first id at or after it, wrapping round. */
export function rotateFrom(ids: readonly string[], cursor: string | null): string[] {
  const sorted = [...ids].sort()
  if (!cursor) return sorted
  const start = sorted.findIndex((id) => id >= cursor)
  return start <= 0 ? sorted : [...sorted.slice(start), ...sorted.slice(0, start)]
}

/** An equal share of what is left, at least the floor, never more than what is left. */
export function tenantSliceMs(remainingMs: number, tenantsLeft: number, floorMs: number): number {
  return Math.min(remainingMs, Math.max(floorMs, Math.floor(remainingMs / tenantsLeft)))
}

async function loadTenants(
  db: SupabaseClient,
  run: CronRun,
  tenantIds: readonly string[] | undefined,
): Promise<CronTenant[] | null> {
  try {
    const query = db.from('tenants').select('id, status, time_zone, is_platform_owner')
    const { data, error } = await (tenantIds ? query.in('id', [...tenantIds]) : query)
    if (error) throw new Error(error.message)
    return (data ?? []).map((t) => ({
      id: t.id as string,
      status: t.status as string,
      timeZone: t.time_zone as string,
      isPlatformOwner: t.is_platform_owner as boolean,
    }))
  } catch (err) {
    console.error('[cron-tenants] tenants read failed:', err)
    run.fail('tenants', err)
    return null
  }
}

/**
 * The ledger of this job's newest finished multi-tenant run. Stellr-only and idle
 * runs carry no cursor, so filtering on it means they do not reset the rotation.
 * Only multi-tenant runs make this read, so it costs a Stellr-only run nothing.
 */
async function lastTenantLedger(db: SupabaseClient, job: string): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await db
      .from('cron_runs')
      .select('result')
      .eq('job', job)
      .is('parent_id', null)
      .not('finished_at', 'is', null)
      .not(`result->>${TENANT_CURSOR_KEY}`, 'is', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return (data?.result as Record<string, unknown> | undefined) ?? null
  } catch (err) {
    console.error(`[cron-tenants] ${job} last ledger read failed:`, err)
    return null
  }
}

/**
 * The tenant that was mid-run when the platform killed the last run: the job's
 * newest child row never finished. A killed run writes no cursor, so without this
 * the same tenant would go first again and take the budget again.
 */
async function killedTenant(db: SupabaseClient, job: string): Promise<string | null> {
  try {
    const { data, error } = await db
      .from('cron_runs')
      .select('tenant_id, finished_at')
      .eq('job', job)
      .not('parent_id', 'is', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return data && !data.finished_at ? (data.tenant_id as string | null) : null
  } catch (err) {
    console.error(`[cron-tenants] ${job} child row read failed:`, err)
    return null
  }
}

/** Stops waiting for `work` after `ms`, firing `abort`. A rejection after that is swallowed by the race. */
async function raceSlice<R>(work: () => Promise<R>, ms: number, abort: () => void): Promise<R | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const stop = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => {
      abort()
      resolve(TIMED_OUT)
    }, ms)
  })
  try {
    return await Promise.race([work(), stop])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Runs `fn` once per tenant with work, inside `deadline`. A tenant that throws
 * or overruns is recorded on `run` and the next tenant still runs. Never throws;
 * the caller spreads `ledger` into its run.finish().
 */
export async function runPerTenant<R extends Record<string, unknown>>(
  db: SupabaseClient,
  run: CronRun,
  opts: RunPerTenantOptions<R>,
): Promise<PerTenantOutcome<R>> {
  const { job, deadline, fn, tenantIds } = opts
  const now = opts.now ?? Date.now
  const floorMs = opts.floorMs ?? DEFAULT_FLOOR_MS
  const overrunMs = opts.overrunMs ?? DEFAULT_OVERRUN_MS

  if (tenantIds?.length === 0) return { results: new Map(), skipped: [], notReached: [], ledger: {} }

  // Stellr alone needs nothing from `tenants`: it runs whatever the row says, and
  // the fallback carries its seeded values. Skipping the read keeps that run's
  // queries and failures as they were before the runner.
  const stellrAlone = tenantIds?.length === 1 && tenantIds[0] === STELLR_TENANT_ID
  const loaded = stellrAlone ? [STELLR_FALLBACK] : await loadTenants(db, run, tenantIds)
  const known = new Map((loaded ?? []).map((t) => [t.id, t]))
  // Stellr runs whatever the read said: its work must not depend on this table.
  if (!known.has(STELLR_TENANT_ID) && (!tenantIds || tenantIds.includes(STELLR_TENANT_ID))) {
    known.set(STELLR_TENANT_ID, STELLR_FALLBACK)
  }

  const unknown = (tenantIds ?? []).filter((id) => !known.has(id))
  for (const id of unknown) run.fail(`t:${id}:run`, new Error('tenant not found or tenants unreadable'))

  const skipped: string[] = []
  const runnable = new Map<string, CronTenant>()
  for (const tenant of known.values()) {
    if (tenant.status === 'active' || tenant.isPlatformOwner || opts.includeInactive) runnable.set(tenant.id, tenant)
    else skipped.push(tenant.id)
  }
  skipped.sort()

  const ids = [...runnable.keys()]
  const stellrFirst = (opts.fairness ?? 'stellr_first') === 'stellr_first' && runnable.has(STELLR_TENANT_ID)
  const rotating = stellrFirst ? ids.filter((id) => id !== STELLR_TENANT_ID) : ids
  const [previous, killed] = ids.length > 1 ? await Promise.all([lastTenantLedger(db, job), killedTenant(db, job)]) : [null, null]
  const cursor = typeof previous?.[TENANT_CURSOR_KEY] === 'string' ? (previous[TENANT_CURSOR_KEY] as string) : null
  const rotated = rotateFrom(rotating, cursor)
  const planned = stellrFirst ? [STELLR_TENANT_ID, ...rotated] : rotated
  // The tenant a killed run died on goes last, so it can only cost itself.
  const order = killed && planned.includes(killed) ? [...planned.filter((id) => id !== killed), killed] : planned

  const stellrOnly = order.length === 1 && order[0] === STELLR_TENANT_ID && !skipped.length && !unknown.length

  const results = new Map<string, R>()
  const detail: Record<string, Record<string, unknown>> = {}
  const notReached: string[] = []

  for (let i = 0; i < order.length; i++) {
    const remaining = deadline - now()
    // Stellr alone always gets its call, even past the deadline, as before the
    // runner: fn checks job.deadline itself, so late work is counted as deferred
    // (and its housekeeping still runs) rather than the whole pass vanishing.
    if (remaining <= 0 && !stellrOnly) {
      notReached.push(...order.slice(i))
      break
    }
    const id = order[i]
    const child = stellrOnly ? null : await startTenantRun(db, run, job, id)
    let ok = true
    const fail = (where: string, err: unknown) => {
      ok = false
      run.fail(stellrOnly ? where : `t:${id}:${where}`, err)
      child?.fail(where, err)
    }
    const sliceMs = tenantSliceMs(remaining, order.length - i, floorMs)
    // Read after the child insert, so that insert comes out of this slice and
    // the tenant is never handed time beyond the run's deadline.
    const sliceEnd = Math.min(deadline, now() + sliceMs)
    const controller = new AbortController()
    const work = async () => {
      const scope = makeScope({ tenantId: id, eventSlugs: null, actor: { kind: 'system', memberId: null } })
      return fn({ tenant: runnable.get(id) as CronTenant, scope, deadline: sliceEnd, signal: controller.signal, fail })
    }
    let result: R | null = null
    try {
      // Stellr alone keeps the plain call: it has the whole budget and no one to yield to.
      const outcome = stellrOnly
        ? await work()
        : await raceSlice(work, Math.max(0, sliceEnd - now()) + overrunMs, () => controller.abort())
      if (outcome === TIMED_OUT) {
        fail('slice', new Error(`still running ${overrunMs} ms past its slice`))
      } else {
        result = outcome
        results.set(id, outcome)
      }
    } catch (err) {
      console.error(`[cron-tenants] ${job} tenant ${id} failed:`, err)
      fail('run', err)
    }
    detail[id] = { ...result, ok }
    await child?.finish(result ?? {})
  }

  // A tenant cut off now and at the last multi-tenant run too is not a one-off.
  // Nothing else marks it, because a cut-off tenant is not itself a failure.
  if (Array.isArray(previous?.notReached) && previous.notReached.length > 0) {
    for (const id of notReached) run.fail(`t:${id}:not_reached`, new Error('deadline cut off tenants on consecutive runs'))
  }

  const ledger: Record<string, unknown> = stellrOnly
    ? {}
    : {
        tenants: detail,
        skipped,
        notReached,
        // Whoever the deadline cut off goes first next time; otherwise the
        // start moves on by one, so no tenant is always last.
        [TENANT_CURSOR_KEY]: notReached.find((id) => rotated.includes(id)) ?? rotated[1] ?? rotated[0] ?? null,
      }

  return { results, skipped, notReached, ledger }
}
