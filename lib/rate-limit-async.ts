// The async limiter API, for routes that move to a store shared across instances.
// It lives apart from lib/rate-limit.ts because proxy.ts imports that file, and
// nothing here may join the bundle that runs on every request.
//
// RATE_LIMIT_STORE picks where the decision comes from:
//   memory (default)  the in-memory limiter alone; Postgres is never called
//   shadow            the in-memory decision, plus a Postgres count, logged when they differ
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
// Always await these, and use the answer: a Promise and a decision are both truthy
// (test/rate-limit-await.test.ts).

import { checkRateLimit, clientIp } from '@/lib/rate-limit'
import { rateLimitStoreMode, takeFromStore } from '@/lib/rate-limit-store'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

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

async function decide(key: string, opts: LimitOptions, label: string): Promise<LimitDecision> {
  const scoped = tenantKey(key, opts.tenantId)
  const window = { limit: opts.limit, windowMs: opts.windowMs }
  const memory = checkRateLimit(scoped, window)

  const mode = rateLimitStoreMode()
  if (mode === 'memory' || !memory.ok) return memory

  const store = await takeFromStore(scoped, window)
  if (!store) return memory
  if (mode === 'postgres') return store

  if (store.ok !== memory.ok) {
    console.warn('[rate-limit] shadow disagreement', label, { memory: memory.ok, store: store.ok })
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
 * the same response and logs the same line.
 *
 * Every new key is a new row in the store, so a keySuffix the client chooses (a
 * token, a slug it posted) needs an unsuffixed per-IP call before it. Without one,
 * a single client writes as many rows as it has requests.
 */
export async function rateLimit(
  req: Request,
  route: string,
  opts: LimitOptions,
  keySuffix?: string,
): Promise<Response | null> {
  const ip = clientIp(req)
  const key = keySuffix ? `${route}:${keySuffix}:${ip}` : `${route}:${ip}`
  const decision = await decide(key, opts, route)
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
