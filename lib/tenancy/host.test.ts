// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  normaliseHost,
  normaliseZoneSuffix,
  classifyHost,
  tenantRoutingConfig,
  isStellrTrackingHost,
  loadTenantHostMap,
  createTenantHostResolver,
  TenantHostMapError,
  HOST_MAP_QUERY,
  HOST_MAP_TTL_MS,
  HOST_MAP_MAX_STALE_MS,
  HOST_MAP_FAILURE_COOLDOWN_MS,
  HOST_MAP_FETCH_TIMEOUT_MS,
  TENANT_ID_HEADER,
  TENANT_SLUG_HEADER,
  type TenantHostMap,
  PRODUCTION_TENANT_ZONE,
} from './host'
import { isInProductionTenantZone, PRODUCTION_TENANT_ZONE as PRODUCTION_ZONE_FROM_PURE } from './host-pure'
import { STELLR_TENANT_ID } from './constants'

const CANARY = 'c0ffee00-0000-4000-8000-0000000000b2'
const SUSPENDED = 'c0ffee00-0000-4000-8000-0000000000b3'
const SUPABASE_URL = 'https://example-project.supabase.co'
// A placeholder in the new secret-key format; not a real key.
const SECRET_PLACEHOLDER = 'sb_secret_placeholder_for_tests'

const PROD_ZONE = { TENANT_ROUTING_ENABLED: 'true', TENANT_HOST_SUFFIX: '.events.stellreducation.org' }
const TEST_ZONE = { TENANT_ROUTING_ENABLED: 'true', TENANT_HOST_SUFFIX: '.localhost' }

/**
 * The real production app (env-guards isRealProductionApp). Since W7-27 the
 * production zone is accepted only there, so a test that routes under PROD_ZONE
 * runs as production.
 */
function onProduction() {
  vi.stubEnv('VERCEL_ENV', 'production')
  vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'prod')
}

/** The rows PostgREST returns for HOST_MAP_QUERY against the two-tenant seed. */
const SEED_ROWS = [
  { host: 'canary-academy.localhost', tenant_id: CANARY, tenants: { slug: 'canary-academy', status: 'active' } },
  { host: 'stellr.localhost', tenant_id: STELLR_TENANT_ID, tenants: { slug: 'stellr', status: 'active' } },
]

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function fetchSpy(body: unknown = SEED_ROWS, status = 200) {
  return vi.fn(async (_input: string, _init?: RequestInit) => jsonResponse(body, status))
}

/** A fetch that never answers; it rejects only when its signal aborts. */
function hangingFetch() {
  return vi.fn(
    (_input: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      }),
  )
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL)
  vi.stubEnv('SUPABASE_SECRET_KEY', SECRET_PLACEHOLDER)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('constants', () => {
  it('names the trusted tenant headers', () => {
    expect(TENANT_ID_HEADER).toBe('x-stellr-tenant-id')
    expect(TENANT_SLUG_HEADER).toBe('x-stellr-tenant-slug')
  })

  it('pins the cache timings, which set the worst-case suspension lag', () => {
    expect(HOST_MAP_TTL_MS).toBe(60_000)
    expect(HOST_MAP_MAX_STALE_MS).toBe(60_000)
    expect(HOST_MAP_FETCH_TIMEOUT_MS).toBe(2_000)
  })
})

describe('host-pure module', () => {
  it('imports nothing, so a client component can use it without the loader', () => {
    const source = readFileSync(fileURLToPath(new URL('./host-pure.ts', import.meta.url)), 'utf8')
    expect(source).not.toMatch(/^\s*import\s/m)
    expect(source).not.toMatch(/\brequire\(|\bimport\(/)
    expect(source).not.toContain('process.env')
  })
})

describe('normaliseHost', () => {
  it.each([
    ['example.org', 'example.org'],
    ['EXAMPLE.ORG', 'example.org'],
    ['Canary-Academy.LocalHost', 'canary-academy.localhost'],
    ['localhost:3000', 'localhost'],
    ['www.stellreducation.org:443', 'www.stellreducation.org'],
    ['www.stellreducation.org.', 'www.stellreducation.org'],
    ['www.stellreducation.org.:8080', 'www.stellreducation.org'],
    ['  app.stellreducation.org  ', 'app.stellreducation.org'],
    ['xn--bcher-kva.events.stellreducation.org', 'xn--bcher-kva.events.stellreducation.org'],
    ['127.0.0.1:3000', '127.0.0.1'],
    ['example.org:65535', 'example.org'],
    ['[::1]:3000', '[::1]'],
    ['[::1]', '[::1]'],
    ['[::]', '[::]'],
    ['[2001:db8::1]:443', '[2001:db8::1]'],
    ['[::ffff:192.0.2.1]', '[::ffff:192.0.2.1]'],
    ['a'.repeat(63) + '.org', 'a'.repeat(63) + '.org'],
  ])('%s -> %s', (raw, expected) => {
    expect(normaliseHost(raw)).toBe(expected)
  })

  it.each([
    [null],
    [undefined],
    [''],
    ['   '],
    ['.'],
    ['..'],
    ['a..b'],
    ['-bad.org'],
    ['bad-.org'],
    ['under_score.org'],
    ['bücher.org'],
    ['evil.org/path'],
    ['evil.org?x=1'],
    ['user@evil.org'],
    ['evil.org:'],
    ['evil.org:abc'],
    ['evil.org:123456'],
    ['evil.org:65536'],
    ['evil.org:99999'],
    ['[::1]:99999'],
    ['[cafe.face]'],
    ['[:]'],
    ['[]'],
    ['evil.org:80:80'],
    ['a'.repeat(64) + '.org'],
    [Array.from({ length: 64 }, () => 'abc').join('.')], // 255 characters
    ['[::1'],
    ['[::1]x'],
    ['[evil.org]'],
    ['evil org'],
  ])('rejects %j', (raw) => {
    expect(normaliseHost(raw as string | null | undefined)).toBeNull()
  })
})

describe('normaliseZoneSuffix', () => {
  it.each([
    ['.events.stellreducation.org', '.events.stellreducation.org'],
    ['events.stellreducation.org', '.events.stellreducation.org'],
    ['.EVENTS.stellreducation.org.', '.events.stellreducation.org'],
    ['.localhost', '.localhost'],
    ['localhost', '.localhost'],
    ['.tenants.localhost', '.tenants.localhost'],
    ['.stellr.test', '.stellr.test'],
  ])('%s -> %s', (raw, expected) => {
    expect(normaliseZoneSuffix(raw)).toBe(expected)
  })

  it.each([
    [undefined],
    [''],
    ['.'],
    ['.org'],
    ['.stellreducation.org'], // would swallow www and app
    ['.vercel.app'],
    ['x.vercel.app'], // every host under it is a known Stellr host
    ['.X.vercel.app.'],
    ['.a.b.vercel.app'],
    ['.events.stellreducation.org:443'],
    ['.ev ents.stellreducation.org'],
  ])('refuses %j', (raw) => {
    expect(normaliseZoneSuffix(raw)).toBeNull()
  })
})

describe('tenantRoutingConfig', () => {
  it('is off unless the flag is exactly "true"', () => {
    for (const v of [undefined, '', 'false', '1', 'TRUE', 'yes', ' true']) {
      expect(tenantRoutingConfig({ TENANT_ROUTING_ENABLED: v }).enabled).toBe(false)
    }
    expect(tenantRoutingConfig({ TENANT_ROUTING_ENABLED: 'true' }).enabled).toBe(true)
  })

  it('reports a refused suffix without throwing', () => {
    const c = tenantRoutingConfig({ TENANT_ROUTING_ENABLED: 'true', TENANT_HOST_SUFFIX: '.org' })
    expect(c.suffix).toBeNull()
    expect(c.suffixError).toMatch(/TENANT_HOST_SUFFIX/)
    expect(tenantRoutingConfig({}).suffixError).toBeNull()
  })

  it('reports routing on with no suffix at all', () => {
    const c = tenantRoutingConfig({ TENANT_ROUTING_ENABLED: 'true' })
    expect(c.suffix).toBeNull()
    expect(c.suffixError).toMatch(/not set/)
  })

  it('refuses a dev zone on the real production app, and only there', () => {
    const env = { TENANT_ROUTING_ENABLED: 'true', TENANT_HOST_SUFFIX: '.localhost' }
    expect(tenantRoutingConfig(env).suffix).toBe('.localhost')

    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'prod')
    const prod = tenantRoutingConfig(env)
    expect(prod.suffix).toBeNull()
    expect(prod.suffixError).toMatch(/development zone/)
    expect(tenantRoutingConfig(PROD_ZONE).suffix).toBe('.events.stellreducation.org')

    // The dev project's own production target declares itself and may use one.
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'dev')
    expect(tenantRoutingConfig(env).suffix).toBe('.localhost')
  })

  // W7-27: the production zone guard.
  it('holds the production tenant zone in one constant, in canonical form', () => {
    expect(PRODUCTION_TENANT_ZONE).toBe('.events.stellreducation.org')
    expect(normaliseZoneSuffix(PRODUCTION_TENANT_ZONE)).toBe(PRODUCTION_TENANT_ZONE)
    expect(PRODUCTION_ZONE_FROM_PURE).toBe(PRODUCTION_TENANT_ZONE)
  })

  it('on the real production app, accepts only the production tenant zone', () => {
    onProduction()
    const ok = tenantRoutingConfig(PROD_ZONE)
    expect(ok).toEqual({ enabled: true, suffix: '.events.stellreducation.org', suffixError: null })
    // Any spelling that normalises to it.
    for (const raw of ['events.stellreducation.org', 'EVENTS.stellreducation.org.', ' .events.stellreducation.org ']) {
      expect(tenantRoutingConfig({ TENANT_HOST_SUFFIX: raw }).suffix, raw).toBe(PRODUCTION_TENANT_ZONE)
    }
    for (const raw of [
      '.devzone.stellreducation.org',
      '.x.events.stellreducation.org',
      '.events.stellreducation.org.evil.example',
      '.events.example.org',
      '.events.school.example',
    ]) {
      const c = tenantRoutingConfig({ TENANT_ROUTING_ENABLED: 'true', TENANT_HOST_SUFFIX: raw })
      expect(c.suffix, raw).toBeNull()
      expect(c.suffixError, raw).toBe(
        'TENANT_HOST_SUFFIX is not the production tenant zone; known Stellr hosts keep working and every other host answers unavailable.',
      )
      expect(c.suffixError, raw).not.toContain('stellreducation')
    }
    // The flag off does not hide it: health reads the reason either way.
    expect(tenantRoutingConfig({ TENANT_HOST_SUFFIX: '.devzone.stellreducation.org' }).suffixError).toMatch(/not the production tenant zone/)
  })

  it('on the real production app, keeps the earlier reasons for a dev zone, an unsafe suffix and none at all', () => {
    onProduction()
    for (const raw of ['.localhost', '.canary.localhost', '.example.test']) {
      const c = tenantRoutingConfig({ TENANT_ROUTING_ENABLED: 'true', TENANT_HOST_SUFFIX: raw })
      expect(c.suffix, raw).toBeNull()
      expect(c.suffixError, raw).toMatch(/development zone on production/)
    }
    for (const raw of ['.org', '.stellreducation.org', 'x.vercel.app']) {
      expect(tenantRoutingConfig({ TENANT_ROUTING_ENABLED: 'true', TENANT_HOST_SUFFIX: raw }).suffixError, raw).toMatch(/not a safe tenant zone suffix/)
    }
    expect(tenantRoutingConfig({ TENANT_ROUTING_ENABLED: 'true' }).suffixError).toMatch(/not set/)
    expect(tenantRoutingConfig({})).toEqual({ enabled: false, suffix: null, suffixError: null })
  })

  it('off production, refuses the production tenant zone and any zone under it', () => {
    const offProduction: Array<() => void> = [
      () => {}, // local and test runs: no VERCEL_ENV
      () => vi.stubEnv('VERCEL_ENV', 'preview'),
      () => {
        // stellr-web-dev's own production target declares itself dev.
        vi.stubEnv('VERCEL_ENV', 'production')
        vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'dev')
      },
    ]
    for (const set of offProduction) {
      vi.unstubAllEnvs()
      set()
      for (const raw of ['.events.stellreducation.org', 'events.stellreducation.org.', '.EVENTS.stellreducation.org', '.x.events.stellreducation.org']) {
        const c = tenantRoutingConfig({ TENANT_ROUTING_ENABLED: 'true', TENANT_HOST_SUFFIX: raw })
        expect(c.suffix, raw).toBeNull()
        expect(c.suffixError, raw).toBe(
          'TENANT_HOST_SUFFIX is the production tenant zone, which is refused off production; known Stellr hosts keep working and every other host answers unavailable.',
        )
      }
      // Everything else off production is as before.
      for (const raw of ['.devzone.stellreducation.org', '.localhost', '.example.test', '.events.example.org', '.notevents.stellreducation.org']) {
        const c = tenantRoutingConfig({ TENANT_ROUTING_ENABLED: 'true', TENANT_HOST_SUFFIX: raw })
        expect(c.suffixError, raw).toBeNull()
        expect(c.suffix, raw).toBe(normaliseZoneSuffix(raw))
      }
    }
  })

  it('fails closed for tenant hosts when the zone is refused either way, and keeps Stellr up', async () => {
    const f = fetchSpy()
    const check = async (env: Record<string, string>, tenantHost: string) => {
      const r = createTenantHostResolver({ fetch: f, env })
      expect(await r.resolve(tenantHost)).toEqual({ kind: 'unavailable', reason: 'zone-misconfigured', host: tenantHost })
      for (const host of ['www.stellreducation.org', 'app.stellreducation.org', 'stellreducation.org']) {
        expect(await r.resolve(host), host).toMatchObject({ kind: 'stellr', reason: 'outside-zone' })
      }
    }
    // The production zone on stellr-web-dev.
    await check(PROD_ZONE, 'canary.events.stellreducation.org')
    // The dev zone on production.
    onProduction()
    await check({ TENANT_ROUTING_ENABLED: 'true', TENANT_HOST_SUFFIX: '.devzone.stellreducation.org' }, 'canary.devzone.stellreducation.org')
    await check({ TENANT_ROUTING_ENABLED: 'true', TENANT_HOST_SUFFIX: '.devzone.stellreducation.org' }, 'canary.events.stellreducation.org')
    expect(f).not.toHaveBeenCalled()
  })
})

describe('isInProductionTenantZone', () => {
  it('is true for the zone apex and every host under it, in any spelling', () => {
    for (const h of [
      'events.stellreducation.org',
      'canary.events.stellreducation.org',
      'CANARY.Events.StellrEducation.org.',
      'canary.events.stellreducation.org:443',
      'a.b.events.stellreducation.org',
    ]) {
      expect(isInProductionTenantZone(h), h).toBe(true)
    }
  })

  it('is false for everything else', () => {
    for (const h of [
      'www.stellreducation.org',
      'app.stellreducation.org',
      'stellreducation.org',
      'notevents.stellreducation.org',
      'canary.devzone.stellreducation.org',
      'events.stellreducation.org.evil.example',
      'canary.localhost',
      '',
      null,
      undefined,
      'evil_host',
    ]) {
      expect(isInProductionTenantZone(h), String(h)).toBe(false)
    }
  })
})

describe('classifyHost', () => {
  it('puts only hosts with a label in front of the suffix inside the zone', () => {
    expect(classifyHost('canary.events.stellreducation.org', '.events.stellreducation.org').kind).toBe('in-zone')
    expect(classifyHost('events.stellreducation.org', '.events.stellreducation.org').kind).toBe('outside-zone')
    expect(classifyHost('notevents.stellreducation.org', '.events.stellreducation.org').kind).toBe('outside-zone')
    expect(classifyHost('localhost', '.localhost').kind).toBe('outside-zone')
    expect(classifyHost('localhost:3000', '.localhost').kind).toBe('outside-zone')
    expect(classifyHost('stellr.localhost', '.localhost').kind).toBe('in-zone')
    expect(classifyHost('[::1]:3000', '.localhost').kind).toBe('outside-zone')
    expect(classifyHost('evil_host', '.localhost').kind).toBe('invalid')
  })

  it('has no zone when the suffix is unset', () => {
    expect(classifyHost('canary.events.stellreducation.org', null).kind).toBe('outside-zone')
  })
})

describe('isStellrTrackingHost', () => {
  const zone = '.events.stellreducation.org'
  it('allows the known Stellr hosts, with or without a zone', () => {
    for (const h of [
      'www.stellreducation.org',
      'WWW.stellreducation.org.',
      'app.stellreducation.org',
      'stellreducation.org',
      'localhost',
      'localhost:3000',
      '127.0.0.1',
      '[::1]:3000',
      'x.vercel.app',
    ]) {
      expect(isStellrTrackingHost(h, zone)).toBe(true)
      expect(isStellrTrackingHost(h)).toBe(true)
      expect(isStellrTrackingHost(h, '.org')).toBe(true) // a refused zone costs www nothing
    }
  })

  it('fails closed for every tenant-zone host and for invalid hosts', () => {
    expect(isStellrTrackingHost('canary.events.stellreducation.org', zone)).toBe(false)
    expect(isStellrTrackingHost('CANARY.events.stellreducation.org.', zone)).toBe(false)
    expect(isStellrTrackingHost('stellr.localhost', '.localhost')).toBe(false)
    expect(isStellrTrackingHost('', zone)).toBe(false)
    expect(isStellrTrackingHost(null, zone)).toBe(false)
  })

  it('is false for a tenant-zone host when the zone is missing or refused', () => {
    for (const missing of [undefined, null, '', '.org', '.stellreducation.org']) {
      expect(isStellrTrackingHost('canary.events.stellreducation.org', missing)).toBe(false)
    }
    expect(isStellrTrackingHost('canary.events.stellreducation.org')).toBe(false)
  })

  it('cannot disagree with the browser, which passes no zone, over a Vercel host', () => {
    expect(isStellrTrackingHost('tenant.x.vercel.app')).toBe(true)
    expect(isStellrTrackingHost('tenant.x.vercel.app', 'x.vercel.app')).toBe(true)
    const config = tenantRoutingConfig({ TENANT_ROUTING_ENABLED: 'true', TENANT_HOST_SUFFIX: 'x.vercel.app' })
    expect(config.suffix).toBeNull()
    expect(config.suffixError).toMatch(/not a safe tenant zone suffix/)
    expect(classifyHost('tenant.x.vercel.app', config.suffix).kind).toBe('outside-zone')
  })

  it('is false for any host it does not know, including look-alikes', () => {
    for (const h of [
      'events.school.example',
      'stellr.localhost',
      'wwww.stellreducation.org',
      'www.stellreducation.org.evil.example',
      'stellreducation.org.evil.example',
      'vercel.app',
      'evilvercel.app',
    ]) {
      expect(isStellrTrackingHost(h, zone)).toBe(false)
      expect(isStellrTrackingHost(h)).toBe(false)
    }
  })
})

describe('loadTenantHostMap', () => {
  it('reads the active map with one raw PostgREST GET, key on apikey only, never cached', async () => {
    const f = fetchSpy()
    const map = await loadTenantHostMap({ fetch: f })
    expect(f).toHaveBeenCalledTimes(1)
    const [url, init] = f.mock.calls[0]
    expect(url).toBe(`${SUPABASE_URL}${HOST_MAP_QUERY}`)
    expect(url).toContain('tenants!inner(')
    expect(url).toContain('tenants.status=eq.active')
    const headers = init?.headers as Record<string, string>
    expect(headers.apikey).toBe(SECRET_PLACEHOLDER)
    expect(headers.Authorization).toBeUndefined()
    expect(init?.cache).toBe('no-store')
    expect(init?.method).toBe('GET')
    expect(map.get('canary-academy.localhost')).toEqual({ tenantId: CANARY, tenantSlug: 'canary-academy' })
    expect(map.get('stellr.localhost')).toEqual({ tenantId: STELLR_TENANT_ID, tenantSlug: 'stellr' })
  })

  it('skips a suspended tenant and malformed rows even if the filter let them through', async () => {
    const f = fetchSpy([
      ...SEED_ROWS,
      { host: 'paused.localhost', tenant_id: SUSPENDED, tenants: { slug: 'paused', status: 'suspended' } },
      { host: 'UPPER.localhost', tenant_id: CANARY, tenants: { slug: 'canary-academy', status: 'active' } },
      { host: 'noslug.localhost', tenant_id: CANARY, tenants: { status: 'active' } },
      { host: 'noid.localhost', tenants: { slug: 'x', status: 'active' } },
      null,
      'nonsense',
    ])
    const map = await loadTenantHostMap({ fetch: f })
    expect([...map.keys()].sort()).toEqual(['canary-academy.localhost', 'stellr.localhost'])
  })

  it('accepts an embedded tenant returned as a one-element array', async () => {
    const f = fetchSpy([{ host: 'canary-academy.localhost', tenant_id: CANARY, tenants: [{ slug: 'canary-academy', status: 'active' }] }])
    expect((await loadTenantHostMap({ fetch: f })).size).toBe(1)
  })

  it.each([
    ['a non-2xx answer', () => fetchSpy({ message: 'nope' }, 500)],
    ['a non-array body', () => fetchSpy({ rows: [] })],
    ['a non-JSON body', () => vi.fn(async () => new Response('<html>', { status: 200 }))],
    ['a network error', () => vi.fn(async () => { throw new Error('ECONNRESET') })],
  ])('throws TenantHostMapError on %s', async (_label, make) => {
    await expect(loadTenantHostMap({ fetch: make() })).rejects.toBeInstanceOf(TenantHostMapError)
  })

  it('gives the fetch the default timeout signal', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const f = fetchSpy()
    await loadTenantHostMap({ fetch: f })
    expect(timeout).toHaveBeenCalledWith(HOST_MAP_FETCH_TIMEOUT_MS)
    expect(f.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('throws TenantHostMapError when the fetch hangs past the timeout', async () => {
    const hang = hangingFetch()
    await expect(loadTenantHostMap({ fetch: hang, timeoutMs: 5 })).rejects.toBeInstanceOf(TenantHostMapError)
    expect(hang).toHaveBeenCalledTimes(1)
  })

  it('throws without fetching when the URL or key is missing', async () => {
    const f = fetchSpy()
    vi.stubEnv('SUPABASE_SECRET_KEY', '')
    await expect(loadTenantHostMap({ fetch: f })).rejects.toBeInstanceOf(TenantHostMapError)
    vi.stubEnv('SUPABASE_SECRET_KEY', SECRET_PLACEHOLDER)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    await expect(loadTenantHostMap({ fetch: f })).rejects.toBeInstanceOf(TenantHostMapError)
    expect(f).not.toHaveBeenCalled()
  })

  it('throws without fetching when the secret slot holds a publishable key', async () => {
    const f = fetchSpy()
    vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_publishable_placeholder_for_tests')
    await expect(loadTenantHostMap({ fetch: f })).rejects.toBeInstanceOf(TenantHostMapError)
    expect(f).not.toHaveBeenCalled()
  })
})

describe('resolver: routing disabled', () => {
  it('is Stellr for every host, without reading or validating it, with 0 fetches', async () => {
    const f = fetchSpy()
    for (const env of [{}, { TENANT_ROUTING_ENABLED: 'false', TENANT_HOST_SUFFIX: '.localhost' }]) {
      const r = createTenantHostResolver({ fetch: f, env })
      for (const host of ['canary-academy.localhost', 'nobody.localhost', 'evil_host', '', null]) {
        expect(await r.resolve(host)).toEqual({ kind: 'stellr', reason: 'routing-disabled', host: null })
      }
    }
    expect(f).not.toHaveBeenCalled()
  })
})

describe('resolver: outside the zone', () => {
  it.each([
    'www.stellreducation.org',
    'app.stellreducation.org',
    'stellreducation.org',
    'stellr-web-dev.vercel.app',
    'stellr-web-git-feature-team.vercel.app',
    'localhost',
    'localhost:3000',
    'stellr.localhost',
    '127.0.0.1:3000',
    '[::1]:3000',
    'events.stellreducation.org',
  ])('%s is Stellr with 0 fetches under the production zone', async (host) => {
    onProduction()
    const f = fetchSpy()
    const r = createTenantHostResolver({ fetch: f, env: PROD_ZONE })
    const res = await r.resolve(host)
    expect(res).toMatchObject({ kind: 'stellr', reason: 'outside-zone' })
    expect(f).not.toHaveBeenCalled()
  })

  it.each(['www.stellreducation.org', 'localhost', 'localhost:3000', 'x.vercel.app'])(
    '%s is Stellr with 0 fetches under the .localhost test zone',
    async (host) => {
      const f = fetchSpy()
      const r = createTenantHostResolver({ fetch: f, env: TEST_ZONE })
      expect(await r.resolve(host)).toMatchObject({ kind: 'stellr', reason: 'outside-zone' })
      expect(f).not.toHaveBeenCalled()
    },
  )

  it('routing on with an unset or refused suffix keeps known Stellr hosts up and fails closed for the rest', async () => {
    const f = fetchSpy()
    for (const env of [
      { TENANT_ROUTING_ENABLED: 'true' },
      { TENANT_ROUTING_ENABLED: 'true', TENANT_HOST_SUFFIX: '.stellreducation.org' },
    ]) {
      const r = createTenantHostResolver({ fetch: f, env })
      expect(await r.resolve('canary.events.stellreducation.org')).toEqual({
        kind: 'unavailable',
        reason: 'zone-misconfigured',
        host: 'canary.events.stellreducation.org',
      })
      expect(await r.resolve('stellr.localhost')).toMatchObject({ kind: 'unavailable', reason: 'zone-misconfigured' })
      for (const host of ['www.stellreducation.org', 'app.stellreducation.org', 'stellreducation.org', 'localhost:3000', 'x.vercel.app']) {
        expect(await r.resolve(host)).toMatchObject({ kind: 'stellr', reason: 'outside-zone' })
      }
    }
    expect(f).not.toHaveBeenCalled()
  })

  it('a dev zone on the real production app fails closed for real tenant hosts', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'prod')
    const f = fetchSpy()
    const r = createTenantHostResolver({ fetch: f, env: TEST_ZONE })
    expect(await r.resolve('canary.events.stellreducation.org')).toMatchObject({ kind: 'unavailable', reason: 'zone-misconfigured' })
    expect(await r.resolve('www.stellreducation.org')).toMatchObject({ kind: 'stellr', reason: 'outside-zone' })
    expect(f).not.toHaveBeenCalled()
  })

  it('a mapped host outside the zone is not consulted: custom domains are unsupported', async () => {
    const rows = [...SEED_ROWS, { host: 'events.school.example', tenant_id: CANARY, tenants: { slug: 'canary-academy', status: 'active' } }]
    onProduction()
    const f = fetchSpy(rows)
    const r = createTenantHostResolver({ fetch: f, env: PROD_ZONE })
    expect(await r.resolve('events.school.example')).toMatchObject({ kind: 'stellr', reason: 'outside-zone' })
    expect(f).not.toHaveBeenCalled()
    // Trackers stay off regardless, because the host is not a known Stellr host.
    expect(isStellrTrackingHost('events.school.example', PROD_ZONE.TENANT_HOST_SUFFIX)).toBe(false)
  })

  it('answers invalid (never Stellr) for a malformed Host when routing is on', async () => {
    onProduction()
    const f = fetchSpy()
    const r = createTenantHostResolver({ fetch: f, env: PROD_ZONE })
    for (const host of ['', null, 'evil_host', 'evil.org/x', 'a..b']) {
      expect(await r.resolve(host)).toEqual({ kind: 'invalid' })
    }
    expect(f).not.toHaveBeenCalled()
  })
})

describe('resolver: inside the zone', () => {
  it('resolves a tenant host', async () => {
    const r = createTenantHostResolver({ fetch: fetchSpy(), env: TEST_ZONE })
    expect(await r.resolve('Canary-Academy.localhost:3000')).toEqual({
      kind: 'tenant',
      host: 'canary-academy.localhost',
      tenantId: CANARY,
      tenantSlug: 'canary-academy',
    })
  })

  it('stellr.localhost: looked up (no exemption) and the platform owner takes the Stellr path', async () => {
    const f = fetchSpy()
    const r = createTenantHostResolver({ fetch: f, env: TEST_ZONE })
    expect(await r.resolve('stellr.localhost')).toEqual({ kind: 'stellr', reason: 'platform-owner', host: 'stellr.localhost' })
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('stellr.localhost is not-found, never Stellr, if the seed mapping is absent', async () => {
    const r = createTenantHostResolver({ fetch: fetchSpy([SEED_ROWS[0]]), env: TEST_ZONE })
    expect(await r.resolve('stellr.localhost')).toEqual({ kind: 'not-found', host: 'stellr.localhost' })
  })

  it('an unknown zone host is not-found, never Stellr', async () => {
    const r = createTenantHostResolver({ fetch: fetchSpy(), env: TEST_ZONE })
    expect(await r.resolve('nobody.localhost')).toEqual({ kind: 'not-found', host: 'nobody.localhost' })
    expect(await r.resolve('deep.canary-academy.localhost')).toEqual({ kind: 'not-found', host: 'deep.canary-academy.localhost' })
  })

  it('a suspended tenant is excluded: not-found', async () => {
    const rows = [...SEED_ROWS, { host: 'paused.localhost', tenant_id: SUSPENDED, tenants: { slug: 'paused', status: 'suspended' } }]
    const r = createTenantHostResolver({ fetch: fetchSpy(rows), env: TEST_ZONE })
    expect(await r.resolve('paused.localhost')).toEqual({ kind: 'not-found', host: 'paused.localhost' })
  })

  it('a failed load fails closed: unavailable, never Stellr', async () => {
    const f = vi.fn(async () => { throw new Error('down') })
    const r = createTenantHostResolver({ fetch: f, env: TEST_ZONE })
    expect(await r.resolve('canary-academy.localhost')).toEqual({ kind: 'unavailable', reason: 'host-map', host: 'canary-academy.localhost' })
    expect(await r.resolve('stellr.localhost')).toEqual({ kind: 'unavailable', reason: 'host-map', host: 'stellr.localhost' })
  })

  it('a hung fetch fails closed through the timeout', async () => {
    const hang = hangingFetch()
    const r = createTenantHostResolver({ loadMap: () => loadTenantHostMap({ fetch: hang, timeoutMs: 5 }), env: TEST_ZONE })
    expect(await r.resolve('canary-academy.localhost')).toEqual({ kind: 'unavailable', reason: 'host-map', host: 'canary-academy.localhost' })
  })

  it('a 5xx from PostgREST fails closed', async () => {
    const r = createTenantHostResolver({ fetch: fetchSpy({}, 503), env: TEST_ZONE })
    expect((await r.resolve('canary-academy.localhost')).kind).toBe('unavailable')
  })

  it('missing Supabase config fails closed for zone hosts and leaves Stellr hosts alone', async () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', '')
    const f = fetchSpy()
    const r = createTenantHostResolver({ fetch: f, env: TEST_ZONE })
    expect((await r.resolve('canary-academy.localhost')).kind).toBe('unavailable')
    expect((await r.resolve('localhost:3000')).kind).toBe('stellr')
    expect(f).not.toHaveBeenCalled()
  })
})

describe('resolver: cache', () => {
  function clock(start = 1_000_000) {
    let t = start
    return { now: () => t, advance: (ms: number) => { t += ms } }
  }

  it('N concurrent misses make 1 fetch (single-flight)', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const f = vi.fn(async () => { await gate; return jsonResponse(SEED_ROWS) })
    const r = createTenantHostResolver({ fetch: f, env: TEST_ZONE })
    const pending = Array.from({ length: 25 }, (_, i) => r.resolve(i % 2 ? 'canary-academy.localhost' : 'nobody.localhost'))
    release()
    const results = await Promise.all(pending)
    expect(f).toHaveBeenCalledTimes(1)
    expect(results.filter((x) => x.kind === 'tenant')).toHaveLength(12)
    expect(results.filter((x) => x.kind === 'not-found')).toHaveLength(13)
  })

  it('negative cache: unknown hosts within the TTL never force a reload', async () => {
    const c = clock()
    const f = fetchSpy()
    const r = createTenantHostResolver({ fetch: f, env: TEST_ZONE, now: c.now })
    for (let i = 0; i < 50; i++) {
      expect((await r.resolve(`probe-${i}.localhost`)).kind).toBe('not-found')
      c.advance(1_000)
    }
    // 50 s of probing inside a 60 s TTL: still the one initial load.
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('reloads after the TTL, serving the stale map while it refreshes', async () => {
    const c = clock()
    let rows: unknown[] = SEED_ROWS
    const f = vi.fn(async () => jsonResponse(rows))
    const r = createTenantHostResolver({ fetch: f, env: TEST_ZONE, now: c.now })

    expect((await r.resolve('new-tenant.localhost')).kind).toBe('not-found')
    expect(f).toHaveBeenCalledTimes(1)

    rows = [...SEED_ROWS, { host: 'new-tenant.localhost', tenant_id: SUSPENDED, tenants: { slug: 'new-tenant', status: 'active' } }]
    c.advance(HOST_MAP_TTL_MS - 1)
    expect((await r.resolve('new-tenant.localhost')).kind).toBe('not-found')
    expect(f).toHaveBeenCalledTimes(1)

    c.advance(2)
    // Stale: answered from the old map, refresh kicked off in the background.
    expect((await r.resolve('new-tenant.localhost')).kind).toBe('not-found')
    expect(f).toHaveBeenCalledTimes(2)
    await vi.waitFor(async () => {
      expect((await r.resolve('new-tenant.localhost')).kind).toBe('tenant')
    })
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('keeps answering from a stale map while refreshes fail, until max-stale runs out', async () => {
    const c = clock()
    let fail = false
    const f = vi.fn(async () => {
      if (fail) throw new Error('down')
      return jsonResponse(SEED_ROWS)
    })
    const r = createTenantHostResolver({ fetch: f, env: TEST_ZONE, now: c.now })
    expect((await r.resolve('canary-academy.localhost')).kind).toBe('tenant')

    fail = true
    c.advance(HOST_MAP_TTL_MS + 1)
    expect((await r.resolve('canary-academy.localhost')).kind).toBe('tenant')
    await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(2))

    c.advance(HOST_MAP_MAX_STALE_MS) // now past TTL + max-stale
    expect((await r.resolve('canary-academy.localhost')).kind).toBe('unavailable')
  })

  it('a suspended tenant stops resolving within TTL + max-stale, even on an idle instance', async () => {
    const c = clock()
    let rows: unknown[] = SEED_ROWS
    const f = vi.fn(async () => jsonResponse(rows))
    const r = createTenantHostResolver({ fetch: f, env: TEST_ZONE, now: c.now })
    expect((await r.resolve('canary-academy.localhost')).kind).toBe('tenant')

    rows = [SEED_ROWS[1]] // suspended: the filter drops it
    c.advance(HOST_MAP_TTL_MS + HOST_MAP_MAX_STALE_MS + 1)
    expect((await r.resolve('canary-academy.localhost')).kind).toBe('not-found')
    expect(HOST_MAP_TTL_MS + HOST_MAP_MAX_STALE_MS).toBeLessThanOrEqual(120_000)
  })

  it('rate-limits refreshes to one per cooldown during an outage with a stale map', async () => {
    const c = clock()
    let fail = false
    const f = vi.fn(async () => {
      if (fail) throw new Error('down')
      return jsonResponse(SEED_ROWS)
    })
    const r = createTenantHostResolver({ fetch: f, env: TEST_ZONE, now: c.now })
    await r.resolve('canary-academy.localhost')

    fail = true
    c.advance(HOST_MAP_TTL_MS + 1)
    await r.resolve('canary-academy.localhost')
    await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(2))
    await new Promise((settle) => setTimeout(settle, 0)) // let the failure land

    for (let i = 0; i < 10; i++) {
      expect((await r.resolve('canary-academy.localhost')).kind).toBe('tenant')
    }
    expect(f).toHaveBeenCalledTimes(2)

    c.advance(HOST_MAP_FAILURE_COOLDOWN_MS)
    await r.resolve('canary-academy.localhost')
    expect(f).toHaveBeenCalledTimes(3)
  })

  it('a load started before reset() cannot restore the old map or clear a newer load', async () => {
    const gates: Array<(rows: unknown[]) => void> = []
    const f = vi.fn(() => new Promise<Response>((settle) => { gates.push((rows) => settle(jsonResponse(rows))) }))
    const r = createTenantHostResolver({ fetch: f, env: TEST_ZONE })

    const beforeReset = r.resolve('canary-academy.localhost')
    await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(1))
    r.reset()

    const afterReset = r.resolve('canary-academy.localhost')
    await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(2))

    // The old load lands first, carrying the host that has since been suspended.
    gates[0](SEED_ROWS)
    await beforeReset

    // The newer load is still the one in flight: no third fetch.
    const joined = r.resolve('canary-academy.localhost')
    await new Promise((settle) => setTimeout(settle, 0))
    expect(f).toHaveBeenCalledTimes(2)

    gates[1]([SEED_ROWS[1]])
    expect((await afterReset).kind).toBe('not-found')
    expect((await joined).kind).toBe('not-found')
    expect((await r.resolve('canary-academy.localhost')).kind).toBe('not-found')
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('a failure from a load started before reset() does not start a cooldown', async () => {
    const gates: Array<() => void> = []
    const f = vi.fn(() => new Promise<Response>((_settle, reject) => { gates.push(() => reject(new Error('down'))) }))
    const r = createTenantHostResolver({ fetch: f, env: TEST_ZONE })

    const beforeReset = r.resolve('canary-academy.localhost')
    await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(1))
    r.reset()
    gates[0]()
    expect((await beforeReset).kind).toBe('unavailable')

    const next = r.resolve('canary-academy.localhost')
    await vi.waitFor(() => expect(f).toHaveBeenCalledTimes(2))
    gates[1]()
    await next
  })

  it('after a cold failure, holds off fetching for the cooldown, then retries', async () => {
    const c = clock()
    let fail = true
    const f = vi.fn(async () => {
      if (fail) throw new Error('down')
      return jsonResponse(SEED_ROWS)
    })
    const r = createTenantHostResolver({ fetch: f, env: TEST_ZONE, now: c.now })
    expect((await r.resolve('canary-academy.localhost')).kind).toBe('unavailable')
    expect(f).toHaveBeenCalledTimes(1)

    for (let i = 0; i < 10; i++) {
      expect((await r.resolve('canary-academy.localhost')).kind).toBe('unavailable')
    }
    expect(f).toHaveBeenCalledTimes(1)

    fail = false
    c.advance(HOST_MAP_FAILURE_COOLDOWN_MS)
    expect((await r.resolve('canary-academy.localhost')).kind).toBe('tenant')
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('reset() drops the cached map', async () => {
    const f = fetchSpy()
    const r = createTenantHostResolver({ fetch: f, env: TEST_ZONE })
    await r.resolve('canary-academy.localhost')
    r.reset()
    await r.resolve('canary-academy.localhost')
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('accepts an injected map loader', async () => {
    const map: TenantHostMap = new Map([['canary-academy.localhost', { tenantId: CANARY, tenantSlug: 'canary-academy' }]])
    const r = createTenantHostResolver({ loadMap: async () => map, env: TEST_ZONE })
    expect((await r.resolve('canary-academy.localhost')).kind).toBe('tenant')
  })
})

describe('resolveTenantHost (default wiring: process.env, global fetch, shared cache)', () => {
  // The default resolver is module state with no reset, so each test gets a fresh module.
  async function freshModule() {
    vi.resetModules()
    return import('./host')
  }

  it('routing off: Stellr, no fetch', async () => {
    const f = fetchSpy()
    vi.stubGlobal('fetch', f)
    const { resolveTenantHost } = await freshModule()
    expect(await resolveTenantHost('canary-academy.localhost')).toEqual({ kind: 'stellr', reason: 'routing-disabled', host: null })
    expect(f).not.toHaveBeenCalled()
  })

  it('an in-zone host resolves through the global fetch, and a second call reuses the cache', async () => {
    const f = fetchSpy()
    vi.stubGlobal('fetch', f)
    vi.stubEnv('TENANT_ROUTING_ENABLED', 'true')
    vi.stubEnv('TENANT_HOST_SUFFIX', '.localhost')
    const { resolveTenantHost } = await freshModule()

    expect(await resolveTenantHost('canary-academy.localhost:3000')).toEqual({
      kind: 'tenant',
      host: 'canary-academy.localhost',
      tenantId: CANARY,
      tenantSlug: 'canary-academy',
    })
    expect(f).toHaveBeenCalledTimes(1)
    expect((await resolveTenantHost('nobody.localhost')).kind).toBe('not-found')
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('reads the env on every call, so flipping the flag off takes effect at once', async () => {
    const f = fetchSpy()
    vi.stubGlobal('fetch', f)
    vi.stubEnv('TENANT_ROUTING_ENABLED', 'true')
    vi.stubEnv('TENANT_HOST_SUFFIX', '.localhost')
    const { resolveTenantHost } = await freshModule()
    expect((await resolveTenantHost('canary-academy.localhost')).kind).toBe('tenant')
    vi.stubEnv('TENANT_ROUTING_ENABLED', 'false')
    expect(await resolveTenantHost('canary-academy.localhost')).toEqual({ kind: 'stellr', reason: 'routing-disabled', host: null })
  })
})
