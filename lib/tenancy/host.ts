// Tenant host resolution (multi-tenancy plan S5, slice B1).
//
// Maps a request's Host header to "Stellr" or to a tenant, for the proxy rewrite.
// proxy.ts (slice B5) calls it only when TENANT_ROUTING_ENABLED is 'true', so with
// the flag off it changes no live behaviour.
//
// The rules, in order:
//   1. TENANT_ROUTING_ENABLED is not exactly 'true'  -> Stellr. No other check.
//   2. The host is normalised (lower case, no :port, no trailing dot) and
//      validated. A host that fails validation is 'invalid', never Stellr.
//   3. TENANT_HOST_SUFFIX is unset, refused, or a dev zone on the real production
//      app: the zone is unknown, so a known Stellr host -> Stellr and any other
//      host -> 'unavailable' (reason 'zone-misconfigured'), never Stellr. Stellr
//      stays up and a tenant host cannot be served the Stellr site by a bad
//      setting. tenantRoutingConfig().suffixError says why, for health checks.
//   4. The host is not inside the tenant zone (TENANT_HOST_SUFFIX, for example
//      `.events.stellreducation.org`, or `.localhost` in tests) -> Stellr, as a
//      pure string check with zero fetches. That covers www, app, the apex,
//      the dev project host, *.vercel.app previews, localhost and IP literals.
//   5. Inside the zone the host is looked up in the cached host map
//      (tenant_domains joined to active tenants):
//        - mapped to the platform owner (STELLR_TENANT_ID) -> Stellr;
//        - mapped to another active tenant                -> that tenant;
//        - not mapped, or the tenant is not active        -> 'not-found'
//          (the caller answers 404; never Stellr);
//        - the map cannot be loaded                       -> 'unavailable'
//          (the caller answers 503 no-store; never Stellr).
//
// Custom domains are not supported. Only hosts inside the zone consult the map,
// so a tenant_domains row outside the zone is loaded and never read: that host
// gets the Stellr path (with trackers off, because it is not a known Stellr
// host). Provisioning must refuse such a row until a slice adds support.
//
// stellr.localhost, decided (S5 critique): there is NO hard-coded exemption.
// When the zone is `.localhost` (the B10 Playwright project), stellr.localhost
// is inside the zone, so it is looked up like any other zone host, and the
// two-tenant seed maps it to Stellr, so it resolves to the Stellr path through
// the platform-owner rule. That costs one map load per TTL, and it makes the
// platform-owner path a tested path instead of a special case. Under a production
// zone, stellr.localhost is outside it and takes the Stellr path with zero
// fetches, like plain localhost.
//
// Edge-safe: no supabase-js. The map is read with a raw PostgREST fetch, the
// same key pattern as lib/crawlers.ts (supabaseSecretKey/supabaseApiHeaders).
//
// Server only in practice. Client code imports the pure rules from ./host-pure.

import { isRealProductionApp } from '../env-guards'
import { supabaseApiHeaders, supabaseSecretKey } from '../supabase-keys'
import { STELLR_TENANT_ID } from './constants'
import { classifyHost, isDevZoneSuffix, isKnownStellrHost, normaliseHost, normaliseZoneSuffix } from './host-pure'

export {
  classifyHost,
  isKnownStellrHost,
  isStellrTrackingHost,
  normaliseHost,
  normaliseZoneSuffix,
  type HostClass,
} from './host-pure'

// ── Constants ────────────────────────────────────────────────────────────────

/** The env flag that turns host routing on. Anything but exactly 'true' is off. */
export const TENANT_ROUTING_FLAG = 'TENANT_ROUTING_ENABLED'

/** The env var holding the tenant zone suffix, for example `.events.stellreducation.org`. */
export const TENANT_HOST_SUFFIX_VAR = 'TENANT_HOST_SUFFIX'

/**
 * Trusted request headers the proxy will set on a tenant host. A client can send
 * these, so every proxy branch that forwards to a route must delete both
 * unconditionally, including kind 'stellr' and routing disabled, and only the
 * tenant branch sets them. Routes that skip the proxy must not read them.
 */
export const TENANT_ID_HEADER = 'x-stellr-tenant-id'
export const TENANT_SLUG_HEADER = 'x-stellr-tenant-slug'

/** How long a loaded host map is fresh. */
export const HOST_MAP_TTL_MS = 60_000

/**
 * How long past its TTL a map may still answer while a refresh runs in the
 * background (stale-while-revalidate). Past this, a lookup waits for a fresh
 * load, and a failed load fails closed.
 *
 * TTL + max-stale is the worst-case lag, per instance, before a suspended tenant
 * or a reassigned host takes effect: 2 minutes. It is also how long a PostgREST
 * outage can last before tenant hosts answer 503. Stellr hosts are unaffected.
 */
export const HOST_MAP_MAX_STALE_MS = 60_000

/**
 * After a failed load, lookups do not fetch again for this long, so an outage is
 * not amplified into a request storm against PostgREST. With no usable map they
 * answer 'unavailable'; with a stale map they keep answering from it.
 */
export const HOST_MAP_FAILURE_COOLDOWN_MS = 5_000

/** The longest a map load may take before it counts as failed. */
export const HOST_MAP_FETCH_TIMEOUT_MS = 2_000

// ── Config ───────────────────────────────────────────────────────────────────

export type TenantRoutingConfig = {
  enabled: boolean
  /** Canonical zone suffix, or null when unset or refused. */
  suffix: string | null
  /** Set when the zone setting is unusable, for health checks and build guards. */
  suffixError: string | null
}

type Env = Record<string, string | undefined>

const ON_BAD_ZONE = 'known Stellr hosts keep working and every other host answers unavailable.'

/**
 * Reads the routing flag and zone suffix from the env it is given. Whether this
 * deployment is the real production app comes from process.env (env-guards).
 */
export function tenantRoutingConfig(env: Env = process.env): TenantRoutingConfig {
  const enabled = env[TENANT_ROUTING_FLAG] === 'true'
  const raw = env[TENANT_HOST_SUFFIX_VAR]
  const suffix = normaliseZoneSuffix(raw)

  if (raw && raw.trim() && !suffix) {
    return { enabled, suffix: null, suffixError: `${TENANT_HOST_SUFFIX_VAR} is not a safe tenant zone suffix; ${ON_BAD_ZONE}` }
  }
  if (suffix && isDevZoneSuffix(suffix) && isRealProductionApp()) {
    return { enabled, suffix: null, suffixError: `${TENANT_HOST_SUFFIX_VAR} is a development zone on production; ${ON_BAD_ZONE}` }
  }
  if (enabled && !suffix) {
    return { enabled, suffix: null, suffixError: `${TENANT_HOST_SUFFIX_VAR} is not set; ${ON_BAD_ZONE}` }
  }
  return { enabled, suffix, suffixError: null }
}

// ── Host map ─────────────────────────────────────────────────────────────────

export type TenantHostEntry = { tenantId: string; tenantSlug: string }

/** host -> tenant, active tenants only. */
export type TenantHostMap = ReadonlyMap<string, TenantHostEntry>

export class TenantHostMapError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TenantHostMapError'
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/**
 * PostgREST path for the whole active host map: tenant_domains with an inner
 * join to tenants, filtered to status 'active'. Suspended, archived and
 * provisioning tenants drop out, so their hosts are not-found.
 */
export const HOST_MAP_QUERY =
  '/rest/v1/tenant_domains?select=host,tenant_id,tenants!inner(slug,status)&tenants.status=eq.active'

/**
 * Loads the whole active host map with one raw PostgREST fetch. Throws
 * TenantHostMapError on missing config, a non-2xx answer, a timeout or an
 * unexpected body; the resolver turns that into 'unavailable'. Rows that do not
 * parse, or whose tenant is not active, are skipped (defence in depth on top of
 * the query filter).
 */
export async function loadTenantHostMap(
  opts: { fetch?: FetchLike; timeoutMs?: number } = {},
): Promise<TenantHostMap> {
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init))
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  let key: string | undefined
  try {
    key = supabaseSecretKey()
  } catch {
    throw new TenantHostMapError('Supabase secret key slot is misconfigured.')
  }
  if (!url || !key) throw new TenantHostMapError('Supabase URL or secret key is not set.')

  const timeoutMs = opts.timeoutMs ?? HOST_MAP_FETCH_TIMEOUT_MS
  let res: Response
  try {
    res = await doFetch(`${url}${HOST_MAP_QUERY}`, {
      method: 'GET',
      headers: { ...supabaseApiHeaders(key), Accept: 'application/json' },
      cache: 'no-store',
      // Inside the try: a runtime without AbortSignal.timeout fails closed.
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    throw new TenantHostMapError('Host map request failed.')
  }
  if (!res.ok) throw new TenantHostMapError(`Host map request returned ${res.status}.`)

  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw new TenantHostMapError('Host map response was not JSON.')
  }
  if (!Array.isArray(body)) throw new TenantHostMapError('Host map response was not an array.')

  const map = new Map<string, TenantHostEntry>()
  for (const row of body) {
    const entry = parseRow(row)
    if (entry) map.set(entry.host, { tenantId: entry.tenantId, tenantSlug: entry.tenantSlug })
  }
  return map
}

function parseRow(row: unknown): { host: string; tenantId: string; tenantSlug: string } | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  const tenant = Array.isArray(r.tenants) ? r.tenants[0] : r.tenants
  if (!tenant || typeof tenant !== 'object') return null
  const t = tenant as Record<string, unknown>
  if (t.status !== 'active') return null
  if (typeof r.tenant_id !== 'string' || !r.tenant_id) return null
  if (typeof t.slug !== 'string' || !t.slug) return null
  const host = normaliseHost(typeof r.host === 'string' ? r.host : null)
  if (!host || host !== r.host) return null // the table stores canonical hosts only
  return { host, tenantId: r.tenant_id, tenantSlug: t.slug }
}

// ── Resolver ─────────────────────────────────────────────────────────────────

export type TenantHostResolution =
  | {
      kind: 'stellr'
      reason: 'routing-disabled' | 'outside-zone' | 'platform-owner'
      /** Canonical host; null when routing is disabled (the host is not read). */
      host: string | null
    }
  | { kind: 'tenant'; host: string; tenantId: string; tenantSlug: string }
  /** Inside the zone but not an active tenant's host. Answer 404, never Stellr. */
  | { kind: 'not-found'; host: string }
  /** The Host header is not a valid hostname. Never Stellr. */
  | { kind: 'invalid' }
  /**
   * Answer 503 no-store, never Stellr. Either the host is inside the zone and the
   * map cannot be loaded ('host-map'), or the zone setting is unusable and this is
   * not a known Stellr host ('zone-misconfigured').
   */
  | { kind: 'unavailable'; reason: 'host-map' | 'zone-misconfigured'; host: string }

export type TenantHostResolverOptions = {
  /** Fetch for the map load (which reads the Supabase URL and key from process.env). */
  fetch?: FetchLike
  /** Env for the flag and suffix; defaults to process.env, read on every call. */
  env?: Env
  /** Clock, for tests. */
  now?: () => number
  ttlMs?: number
  maxStaleMs?: number
  failureCooldownMs?: number
  /** Replaces loadTenantHostMap entirely, for tests. */
  loadMap?: () => Promise<TenantHostMap>
}

export type TenantHostResolver = {
  resolve(rawHost: string | null | undefined): Promise<TenantHostResolution>
  /**
   * The active, non-owner tenant with this slug, from the same cached map; null
   * when routing is off, there is no such tenant, or the map cannot be loaded.
   * For the tenant tree, which trusts its URL param only after this check.
   */
  activeTenantBySlug(slug: string): Promise<TenantHostEntry | null>
  /** Drops the cached map, for tests and for an explicit refresh. */
  reset(): void
}

/**
 * A resolver with its own cache. The cache holds the whole active map, so a
 * host missing from a fresh map is answered 'not-found' with no fetch: that is
 * the negative cache, and an unknown host can never force a reload before the
 * TTL. Concurrent loads are single-flight.
 */
export function createTenantHostResolver(opts: TenantHostResolverOptions = {}): TenantHostResolver {
  const now = opts.now ?? Date.now
  const ttlMs = opts.ttlMs ?? HOST_MAP_TTL_MS
  const maxStaleMs = opts.maxStaleMs ?? HOST_MAP_MAX_STALE_MS
  const cooldownMs = opts.failureCooldownMs ?? HOST_MAP_FAILURE_COOLDOWN_MS
  const loadMap =
    opts.loadMap ?? (() => loadTenantHostMap({ fetch: opts.fetch }))

  let map: TenantHostMap | null = null
  let loadedAt = 0
  let failedAt: number | null = null
  let inflight: Promise<TenantHostMap | null> | null = null
  // Bumped by reset(), so a load started before it cannot change the state after.
  let generation = 0

  function refresh(): Promise<TenantHostMap | null> {
    if (inflight) return inflight
    const startedIn = generation
    const load: Promise<TenantHostMap | null> = loadMap()
      .then((loaded) => {
        if (startedIn === generation) {
          map = loaded
          loadedAt = now()
          failedAt = null
        }
        return loaded
      })
      .catch(() => {
        if (startedIn === generation) failedAt = now()
        return null
      })
      .finally(() => {
        if (inflight === load) inflight = null
      })
    inflight = load
    return load
  }

  async function currentMap(): Promise<TenantHostMap | null> {
    const t = now()
    if (map) {
      const age = t - loadedAt
      if (age <= ttlMs) return map
      if (age <= ttlMs + maxStaleMs) {
        // Stale but usable: answer now, refresh in the background. A failed
        // background refresh keeps the stale map until max-stale runs out. If the
        // instance freezes before the refresh lands, the next lookup past
        // max-stale waits for a fresh load, so the failure mode is only latency.
        if (failedAt === null || t - failedAt >= cooldownMs) void refresh()
        return map
      }
    }
    if (failedAt !== null && t - failedAt < cooldownMs && !inflight) return null
    return refresh()
  }

  return {
    async resolve(rawHost) {
      const config = tenantRoutingConfig(opts.env ?? process.env)
      if (!config.enabled) return { kind: 'stellr', reason: 'routing-disabled', host: null }

      const cls = classifyHost(rawHost, config.suffix)
      if (cls.kind === 'invalid') return { kind: 'invalid' }
      if (!config.suffix && !isKnownStellrHost(cls.host)) {
        return { kind: 'unavailable', reason: 'zone-misconfigured', host: cls.host }
      }
      if (cls.kind === 'outside-zone') return { kind: 'stellr', reason: 'outside-zone', host: cls.host }

      const loaded = await currentMap()
      if (!loaded) return { kind: 'unavailable', reason: 'host-map', host: cls.host }
      const entry = loaded.get(cls.host)
      if (!entry) return { kind: 'not-found', host: cls.host }
      if (entry.tenantId === STELLR_TENANT_ID) {
        return { kind: 'stellr', reason: 'platform-owner', host: cls.host }
      }
      return { kind: 'tenant', host: cls.host, tenantId: entry.tenantId, tenantSlug: entry.tenantSlug }
    },
    async activeTenantBySlug(slug) {
      if (!tenantRoutingConfig(opts.env ?? process.env).enabled) return null
      const loaded = await currentMap()
      if (!loaded) return null
      for (const entry of loaded.values()) {
        if (entry.tenantSlug === slug && entry.tenantId !== STELLR_TENANT_ID) return entry
      }
      return null
    },
    reset() {
      map = null
      loadedAt = 0
      failedAt = null
      inflight = null
      generation++
    },
  }
}

let defaultResolver: TenantHostResolver | null = null

/**
 * Resolves a Host header with the per-instance default resolver (process env,
 * global fetch, 60 s TTL). See the file header for the rules.
 */
export function resolveTenantHost(rawHost: string | null | undefined): Promise<TenantHostResolution> {
  defaultResolver ??= createTenantHostResolver()
  return defaultResolver.resolve(rawHost)
}

/** The active, non-owner tenant with this slug, from the default resolver's map. */
export function activeTenantBySlug(slug: string): Promise<TenantHostEntry | null> {
  defaultResolver ??= createTenantHostResolver()
  return defaultResolver.activeTenantBySlug(slug)
}
