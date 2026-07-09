// Minimal in-memory fixed-window rate limiter for public API routes.
//
// Scope & honesty about guarantees: state lives in the serverless instance's
// memory, so the cap is per-warm-instance and resets on cold start / redeploy.
// That is fine for what this protects against — bulk enumeration from one
// client hammers the same warm instance, so a per-IP window still slows a
// scraper from thousands of probes/minute to the configured trickle. It is NOT
// a hard distributed quota; if that's ever needed, swap the store for Upstash
// Redis (@upstash/ratelimit) or enforce at the edge (Vercel WAF rule) without
// changing call sites.

interface WindowState {
  count: number
  windowStart: number
}

interface LimiterResult {
  ok: boolean
  /** Seconds until the window resets — for the Retry-After header. */
  retryAfterSeconds: number
}

const buckets = new Map<string, WindowState>()

// Cap the map so a key-spraying attacker can't grow memory unbounded; clearing
// simply resets windows, which only ever errs in the caller's favour.
const MAX_KEYS = 10_000

export function checkRateLimit(
  key: string,
  opts: { limit: number; windowMs: number },
): LimiterResult {
  const now = Date.now()

  if (buckets.size > MAX_KEYS) buckets.clear()

  const state = buckets.get(key)
  if (!state || now - state.windowStart >= opts.windowMs) {
    buckets.set(key, { count: 1, windowStart: now })
    return { ok: true, retryAfterSeconds: 0 }
  }

  state.count++
  if (state.count > opts.limit) {
    return {
      ok: false,
      retryAfterSeconds: Math.ceil((state.windowStart + opts.windowMs - now) / 1000),
    }
  }
  return { ok: true, retryAfterSeconds: 0 }
}

/** Client IP for rate-limit keying (first hop of x-forwarded-for on Vercel). */
export function clientIp(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip')?.trim() ||
    'unknown'
  )
}

/**
 * Per-IP guard for a public POST route. Returns a ready-to-return 429 Response
 * (with Retry-After) when the caller is over the limit, or null to proceed.
 * Logs every rejection so abuse patterns surface in the Vercel logs (F-17
 * Phase 1 / Phase 3). `keySuffix` lets a route sub-key (e.g. by event slug) so
 * one venue's Wi-Fi checking in a whole class isn't throttled as one attacker.
 */
export function rateLimitGuard(
  req: Request,
  route: string,
  opts: { limit: number; windowMs: number },
  keySuffix?: string,
): Response | null {
  const ip = clientIp(req)
  const key = keySuffix ? `${route}:${keySuffix}:${ip}` : `${route}:${ip}`
  const rl = checkRateLimit(key, opts)
  if (rl.ok) return null
  console.warn('[rate-limit] 429', route, ip)
  return new Response(
    JSON.stringify({ error: 'Too many requests — please wait a moment and try again.' }),
    {
      status: 429,
      headers: { 'content-type': 'application/json', 'Retry-After': String(rl.retryAfterSeconds) },
    },
  )
}

/** Common windows for the public forms (F-17). */
export const HOUR_MS = 60 * 60 * 1000
