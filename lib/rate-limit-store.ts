// The shared counter behind lib/rate-limit-async.ts: rate_limit_take() in Postgres,
// reached over a short timeout. Inert while RATE_LIMIT_STORE is memory, its default.
//
// proxy.ts must never reach this module (test/rate-limit-proxy-closure.test.ts):
// the proxy runs on every request, and this one brings the Supabase client with it.
//
// Limiter keys hold IP addresses and sometimes names, so only an HMAC of a key
// leaves this process. Without a usable secret nothing is sent at all, and the
// caller keeps its in-memory decision.

import { createHmac } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { startCronRun } from '@/lib/cron-runs'
import { supabaseServer } from '@/lib/supabase'

export type RateLimitStoreMode = 'memory' | 'shadow' | 'postgres'

export interface StoreDecision {
  ok: boolean
  retryAfterSeconds: number
}

/** A limiter sits on the request path, so a slow database must not become a slow site. */
export const STORE_TIMEOUT_MS = 300
const GC_TIMEOUT_MS = 10_000
const MIN_SECRET_LENGTH = 32
const LOG_EVERY_MS = 60_000

const lastLogged = new Map<string, number>()

/**
 * Log a store problem at most once a minute per instance, so an outage on a busy
 * route cannot flood the logs. `problem` is always one of the fixed strings below,
 * and neither it nor `detail` holds a key.
 */
function logStoreProblem(problem: string, detail?: string): void {
  const now = Date.now()
  if (now - (lastLogged.get(problem) ?? -Infinity) < LOG_EVERY_MS) return
  lastLogged.set(problem, now)
  if (detail) console.error(`[rate-limit] ${problem}:`, detail)
  else console.error(`[rate-limit] ${problem}`)
}

/**
 * An unset or unrecognised value is memory, so a typo cannot turn the store on. A
 * value it does not recognise is logged, without repeating it, because the operator
 * set it expecting something else.
 */
export function rateLimitStoreMode(): RateLimitStoreMode {
  const mode = process.env.RATE_LIMIT_STORE?.trim()
  if (mode === 'shadow' || mode === 'postgres') return mode
  if (mode && mode !== 'memory') logStoreProblem('RATE_LIMIT_STORE is not memory, shadow or postgres: using memory')
  return 'memory'
}

let storeClient: ReturnType<typeof supabaseServer> | undefined

/** One client per instance: building one on every limited request is a waste on a hot path. */
function client() {
  storeClient ??= supabaseServer()
  return storeClient
}

/** HMAC-SHA256 of a limiter key, in the hex form PostgREST reads as bytea. */
export function hashRateLimitKey(key: string, secret: string): string {
  return `\\x${createHmac('sha256', secret).update(key).digest('hex')}`
}

/**
 * Resolve to the request's result, or to null once `ms` has passed. The timer
 * aborts the request as well as abandoning it, so the connection is let go.
 */
async function withTimeout<T>(request: (signal: AbortSignal) => PromiseLike<T>, ms: number): Promise<T | null> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve(null)
    }, ms)
  })
  try {
    return await Promise.race([request(controller.signal), timedOut])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Count one request against a key's window in Postgres. Null when the store
 * could not answer (no secret, an error, the timeout): the caller then uses its
 * in-memory decision. Never throws, and logs no key.
 */
export async function takeFromStore(
  key: string,
  opts: { limit: number; windowMs: number },
): Promise<StoreDecision | null> {
  const secret = process.env.RATE_LIMIT_KEY_SECRET
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    logStoreProblem('store skipped: RATE_LIMIT_KEY_SECRET is missing or too short')
    return null
  }
  try {
    const params = {
      p_keys: [hashRateLimitKey(key, secret)],
      p_limits: [opts.limit],
      p_windows: [Math.max(1, Math.ceil(opts.windowMs / 1000))],
    }
    const result = await withTimeout(
      (signal) => client().rpc('rate_limit_take', params).abortSignal(signal),
      STORE_TIMEOUT_MS,
    )
    if (!result) {
      logStoreProblem('store timed out')
      return null
    }
    if (result.error) {
      logStoreProblem('store failed', result.error.message)
      return null
    }
    const row = (result.data as { allowed?: unknown; retry_after?: unknown }[] | null)?.[0]
    if (typeof row?.allowed !== 'boolean') {
      logStoreProblem('store returned an unexpected shape')
      return null
    }
    return { ok: row.allowed, retryAfterSeconds: Number(row.retry_after) || 0 }
  } catch (err) {
    logStoreProblem('store threw', err instanceof Error ? err.message : 'unknown error')
    return null
  }
}

/**
 * Delete expired windows, for the entitlements cron. In memory mode it does
 * nothing at all, so a database without the migration sees no call. Otherwise
 * it records itself in cron_runs as 'rate-limit-gc'. Never throws, so it cannot
 * fail the job that hosts it.
 */
export async function gcRateLimitStore(db: SupabaseClient): Promise<{ deleted: number } | { failed: true } | null> {
  if (rateLimitStoreMode() === 'memory') return null
  const run = await startCronRun(db, 'rate-limit-gc')
  try {
    const result = await withTimeout((signal) => db.rpc('rate_limit_gc').abortSignal(signal), GC_TIMEOUT_MS)
    if (!result) throw new Error('timed out')
    if (result.error) throw new Error(result.error.message)
    const deleted = Number(result.data) || 0
    await run.finish({ deleted })
    return { deleted }
  } catch (err) {
    console.error('[rate-limit] gc failed:', err instanceof Error ? err.message : 'unknown error')
    run.fail('gc', err)
    await run.finish({})
    return { failed: true }
  }
}
