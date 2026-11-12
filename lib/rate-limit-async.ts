// The async limiter API, for routes that move to a store shared across instances.
// It lives apart from lib/rate-limit.ts because proxy.ts imports that file, and
// nothing here may join the bundle that runs on every request.
//
// RATE_LIMIT_STORE picks where the decision comes from:
//   memory (default)  the in-memory limiter alone; Postgres is never called
//   shadow            the in-memory decision, plus a Postgres count, logged and written to
//                     app_errors when they differ
//   postgres          the Postgres decision, or the in-memory one if the store cannot answer
//
// Every mode counts in memory first, so a store outage falls back to a window
// that was already counting. It is never an allow-all.
//
// A request memory has already denied stops there in every mode, with no database
// call, so a client hammering one key costs a map lookup and cannot queue on that
// key's row. The store has already counted what this instance let through, so it
// loses nothing it needs to deny the key on another instance.
//
// Every new key is a new row in the store, and a rateLimit() suffix holds what the
// client sent: a slug, a token. Each route gives an IP a budget of store calls for
// suffixed keys, and past it the IP keeps its in-memory decision. That slows the rows
// one client can write without adding a limit. It is not a firm bound: the budget is
// per instance and per exact IP, so a client rotating addresses is not held by it.
// It does change one thing: an IP past its budget is counted per instance on that
// route, as in memory mode, so a key the store would refuse can be allowed. Every such
// key holds the IP, so that only ever affects the client spending the budget.
//
// limit() has no budget. Its keys need not hold the IP, so a client could otherwise
// spend a budget to lift a count that protects someone else.
//
// Always await these, and use the answer: a Promise and a decision are both truthy
// (test/rate-limit-await.test.ts).

import { checkRateLimit, clientIp, HOUR_MS } from '@/lib/rate-limit'
import { rateLimitStoreMode, recordRateLimitRow, takeFromStore } from '@/lib/rate-limit-store'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

/**
 * Store calls one IP may make, per route, per instance and per hour, for suffixed keys.
 * A venue counts one for each check-in, and past this it simply counts per instance
 * for the rest of the hour, as it does in memory mode.
 */
const STORE_BUDGET_CALLS = 2_000
const STORE_BUDGET_WINDOW_MS = HOUR_MS
const MAX_STORE_BUDGETS = 10_000

// Apart from lib/rate-limit.ts's buckets, because the keys a spray creates there would
// evict the budget meant to slow that spray. Insertion order is window order, so the
// first entry is the one closest to expiring.
const storeBudgets = new Map<string, { spent: number; windowStart: number }>()

function withinStoreBudget(route: string, ip: string): boolean {
  const now = Date.now()
  const key = `${route}:${ip}`
  const budget = storeBudgets.get(key)
  if (budget && now - budget.windowStart < STORE_BUDGET_WINDOW_MS) {
    budget.spent++
    return budget.spent <= STORE_BUDGET_CALLS
  }
  storeBudgets.delete(key)
  if (storeBudgets.size >= MAX_STORE_BUDGETS) {
    const oldest = storeBudgets.keys().next().value
    if (oldest !== undefined) storeBudgets.delete(oldest)
  }
  storeBudgets.set(key, { spent: 1, windowStart: now })
  return true
}

export interface LimitOptions {
  limit: number
  windowMs: number
  /**
   * Whose bucket this is: the resolved tenant, or null on a route only Stellr
   * serves. Required, because in postgres mode a route that left it out would share
   * one global bucket with every tenant. Only another tenant's id changes the key,
   * so Stellr's keys stay as they are.
   */
  tenantId: string | null
}

export interface LimitDecision {
  ok: boolean
  /** Seconds until the window resets, for the Retry-After header. */
  retryAfterSeconds: number
}

function tenantKey(key: string, tenantId: string | null): string {
  return tenantId && tenantId !== STELLR_TENANT_ID ? `tenant:${tenantId}:${key}` : key
}

const verdict = (ok: boolean) => (ok ? 'allow' : 'deny')

async function decide(key: string, opts: LimitOptions, label: string, budgetIp?: string): Promise<LimitDecision> {
  const scoped = tenantKey(key, opts.tenantId)
  const window = { limit: opts.limit, windowMs: opts.windowMs }
  const memory = checkRateLimit(scoped, window)

  const mode = rateLimitStoreMode()
  if (mode === 'memory' || !memory.ok) return memory
  if (budgetIp && !withinStoreBudget(label, budgetIp)) return memory

  const store = await takeFromStore(scoped, window)
  if (!store) return memory
  if (mode === 'postgres') return store

  if (store.ok !== memory.ok) {
    console.warn('[rate-limit] shadow disagreement', label, { memory: memory.ok, store: store.ok })
    // A 'RATELIMIT <label>' row: the label comes from the code, never the key.
    await recordRateLimitRow(label, `shadow_disagreement memory=${verdict(memory.ok)} store=${verdict(store.ok)}`)
  }
  return memory
}

/** One decision for one key. The key is hashed before it leaves this process. */
export function limit(key: string, opts: LimitOptions): Promise<LimitDecision> {
  return decide(key, opts, 'limit')
}

/**
 * The async form of rateLimitGuard: a ready-to-return 429 Response when the
 * caller's IP is over the limit, or null to proceed. It takes the same key, sends
 * the same response and logs the same line. A keySuffix draws on the IP's store
 * budget for this route, since a client may choose it (a token, a slug it posted).
 */
export async function rateLimit(
  req: Request,
  route: string,
  opts: LimitOptions,
  keySuffix?: string,
): Promise<Response | null> {
  const ip = clientIp(req)
  const key = keySuffix ? `${route}:${keySuffix}:${ip}` : `${route}:${ip}`
  const decision = await decide(key, opts, route, keySuffix ? ip : undefined)
  if (decision.ok) return null
  console.warn('[rate-limit] 429', route, ip)
  return new Response(
    JSON.stringify({ error: 'Too many requests — please wait a moment and try again.' }),
    {
      status: 429,
      headers: { 'content-type': 'application/json', 'Retry-After': String(decision.retryAfterSeconds) },
    },
  )
}
