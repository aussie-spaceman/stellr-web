// @vitest-environment node
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { NextRequest, type NextFetchEvent } from 'next/server'
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ROUTE_MANIFEST } from '@/lib/security/route-manifest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { TENANT_ID_HEADER, TENANT_SLUG_HEADER, isKnownStellrHost } from '@/lib/tenancy/host'
import { TENANT_HOST_ROBOTS_TXT, isInternalTenantTreePath, tenantHostRoute } from '@/lib/tenancy/tenant-surface'

// S5, slice B5: tenant routing in proxy.ts. Clerk is stubbed as in proxy.test.ts,
// with an admin claim on the session, so a /admin denial below cannot be down to a
// missing role. The host map comes through a stubbed global fetch. That same stub
// proves a Stellr host never reaches it.

const state = vi.hoisted(() => ({ userId: 'user_1' as string | null, clerkRuns: 0, crawlerHits: 0, protects: 0 }))

vi.mock('@clerk/nextjs/server', () => {
  const toRegex = (p: string) => new RegExp('^' + p.replace(/:[a-z]+/gi, '[^/]+').replace(/\(\.\*\)/g, '.*') + '$')
  return {
    createRouteMatcher: (patterns: string[]) => (req: Request) =>
      patterns.some((p) => toRegex(p).test(new URL(req.url).pathname)),
    clerkMiddleware:
      (handler: (auth: unknown, req: NextRequest, event: NextFetchEvent) => Promise<Response | undefined>) =>
      (req: NextRequest, event: NextFetchEvent) => {
        state.clerkRuns += 1
        const session = { userId: state.userId, sessionClaims: { metadata: { role: 'admin' } } }
        const auth = Object.assign(async () => session, {
          protect: async () => {
            state.protects += 1
          },
        })
        return handler(auth, req, event)
      },
  }
})
vi.mock('@/lib/env', () => ({
  APP_HOST: 'app.stellreducation.org',
  SITE_URL: 'https://www.stellreducation.org',
  isProductionDeployment: () => false,
}))
vi.mock('@/lib/crawlers', () => ({
  matchCrawler: () => 'bot',
  recordCrawlerHit: async () => {
    state.crawlerHits += 1
  },
}))

import proxy, { config } from '@/proxy'
import { stellrHostsPattern } from '../next.config.mjs'

const CANARY = '11111111-1111-4111-8111-111111111111'
const HOST_ROWS = [
  { host: 'canary-academy.localhost', tenant_id: CANARY, tenants: { slug: 'canary-academy', status: 'active' } },
  { host: 'stellr.localhost', tenant_id: STELLR_TENANT_ID, tenants: { slug: 'stellr', status: 'active' } },
]

const TENANT = 'canary-academy.localhost'
const fetchStub = vi.fn()
const event = { waitUntil: (p: Promise<unknown>) => void p } as unknown as NextFetchEvent

/** A request carrying exactly this Host header and raw path. */
function request(host: string, rawPath: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`https://${host}${rawPath}`, { headers: { host, ...headers } })
}
const hit = (host: string, rawPath: string, headers: Record<string, string> = {}) =>
  proxy(request(host, rawPath, headers), event)

const flagOff = () => vi.stubEnv('TENANT_ROUTING_ENABLED', undefined)
const flagOn = () => {
  vi.stubEnv('TENANT_ROUTING_ENABLED', 'true')
  vi.stubEnv('TENANT_HOST_SUFFIX', '.localhost')
}

/** The headers Next would forward to the route, as the proxy left them. */
function forwarded(res: Response, name: string): string | null {
  return res.headers.get(`x-middleware-request-${name}`)
}
/** The rewrite target's path, or null. */
function rewritten(res: Response): string | null {
  const to = res.headers.get('x-middleware-rewrite')
  return to ? new URL(to).pathname : null
}

/** The URL a manifest file serves, with sample params. */
function sampleUrl(file: string): string {
  const special: Record<string, string> = {
    'app/robots.ts': '/robots.txt',
    'app/sitemap.ts': '/sitemap.xml',
    'app/manifest.ts': '/manifest.webmanifest',
  }
  if (special[file]) return special[file]
  const parts = file.replace(/^app\//, '').split('/')
  const leaf = parts.pop() ?? ''
  const segs: string[] = []
  for (const p of parts) {
    if (/^\(.+\)$/.test(p)) continue
    if (/^\[\[\.\.\..+\]\]$/.test(p)) continue
    if (/^\[\.\.\..+\]$/.test(p)) segs.push('a', 'b')
    else if (/^\[.+\]$/.test(p)) segs.push('x1')
    else segs.push(p)
  }
  if (/^opengraph-image\.tsx?$/.test(leaf)) segs.push('opengraph-image')
  return '/' + segs.join('/')
}

beforeEach(() => {
  state.userId = 'user_1'
  state.clerkRuns = 0
  state.crawlerHits = 0
  state.protects = 0
  fetchStub.mockReset()
  fetchStub.mockImplementation(async () => new Response(JSON.stringify(HOST_ROWS), { status: 200 }))
  vi.stubGlobal('fetch', fetchStub)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://db.test')
  vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_TESTONLY')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('a Stellr host answers the same with the flag off and on', () => {
  const STELLR_HOSTS = ['www.stellreducation.org', 'app.stellreducation.org', 'localhost:3000']
  // Every manifest URL the proxy matches on that host, tree excluded (it is a 404
  // either way, and pinned below). With 476 entries on 3 hosts this is the
  // table the scoping asked for: all pages, plus every API rather than a sample.
  const urls = Object.keys(ROUTE_MANIFEST)
    .filter((f) => !f.startsWith('app/%5Ft/'))
    .map(sampleUrl)

  // A nonce differs per request; the header name is what must not change.
  const shape = (res: Response) => ({
    status: res.status,
    location: res.headers.get('location'),
    rewrite: res.headers.get('x-middleware-rewrite'),
    next: res.headers.get('x-middleware-next'),
    csp: res.headers.has('content-security-policy-report-only'),
    enforcingCsp: res.headers.has('content-security-policy'),
    cookie: res.headers.get('set-cookie'),
  })

  it.each(STELLR_HOSTS)('on %s', async (host) => {
    expect(urls.length).toBeGreaterThan(470)
    flagOff()
    const off = []
    for (const url of urls) off.push(shape(await hit(host, url)))
    flagOn()
    const on = []
    for (const url of urls) on.push(shape(await hit(host, url)))
    expect(on).toEqual(off)
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('makes no database call on a Stellr host, flag off or on, with any zone', async () => {
    for (const set of [flagOff, flagOn]) {
      set()
      for (const host of STELLR_HOSTS) {
        for (const url of ['/', '/events', '/community', '/api/members/me']) await hit(host, url)
      }
    }
    vi.stubEnv('TENANT_ROUTING_ENABLED', 'true')
    vi.stubEnv('TENANT_HOST_SUFFIX', '.events.stellreducation.org')
    for (const host of STELLR_HOSTS) await hit(host, '/')
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('with the flag off, serves a tenant-zone host the Stellr path, without reading the map', async () => {
    flagOff()
    vi.stubEnv('TENANT_HOST_SUFFIX', '.localhost')
    const res = await hit(TENANT, '/')
    expect(res.status).toBe(200)
    expect(rewritten(res)).toBeNull()
    expect(fetchStub).not.toHaveBeenCalled()
  })

  it('leaves an ordinary marketing response with no request-header override', async () => {
    for (const set of [flagOff, flagOn]) {
      set()
      const res = await hit('www.stellreducation.org', '/about')
      expect(res.headers.get('x-middleware-override-headers')).toBeNull()
    }
  })
})

describe('client-sent tenant headers are stripped on every Stellr branch', () => {
  const CLIENT_SENT = { [TENANT_ID_HEADER]: CANARY, [TENANT_SLUG_HEADER]: 'canary-academy' }
  const expectStripped = (res: Response) => {
    const overrides = res.headers.get('x-middleware-override-headers')
    expect(overrides).not.toBeNull()
    expect(overrides).not.toContain(TENANT_ID_HEADER)
    expect(overrides).not.toContain(TENANT_SLUG_HEADER)
    expect(forwarded(res, TENANT_ID_HEADER)).toBeNull()
    expect(forwarded(res, TENANT_SLUG_HEADER)).toBeNull()
  }

  describe.each([
    ['off', flagOff],
    ['on', flagOn],
  ])('flag %s', (_name, set) => {
    beforeEach(() => set())

    it.each([
      ['the marketing fast path', 'www.stellreducation.org', '/about'],
      ['a page through Clerk', 'www.stellreducation.org', '/grant'],
      ['the member area', 'app.stellreducation.org', '/community'],
      ['an API', 'www.stellreducation.org', '/api/register/group'],
      ['the app-host /events rewrite', 'app.stellreducation.org', '/events'],
    ])('on %s', async (_label, host, url) => {
      expectStripped(await hit(host, url, CLIENT_SENT))
    })
  })

  it('routes a Stellr host the same whatever tenant header the client sends', async () => {
    flagOn()
    const res = await hit('www.stellreducation.org', '/', CLIENT_SENT)
    expect(res.status).toBe(200)
    expect(rewritten(res)).toBeNull()
  })
})

describe('the tenant tree answers 404 to a direct request, on every host', () => {
  const PATHS = [
    '/_t',
    '/_t/',
    '/_t/canary-academy',
    '/_t/stellr',
    '/%5Ft/canary-academy',
    '/%5ft/canary-academy',
    '/_%74/canary-academy',
    '/_%54/canary-academy',
    '/%5F%74/canary-academy',
    '/%255Ft/canary-academy',
    '/_T/canary-academy',
    '/_t/canary-academy/x.html',
    '/%5Ft/acme/sign/abc.png',
    '/%5ft/acme/sign/x.css/y',
    '/_t/acme/x.pngfoo',
    '/%5Ft/%ZZ/x',
  ]

  describe.each([
    ['off', flagOff],
    ['on', flagOn],
  ])('flag %s', (_name, set) => {
    it.each(['www.stellreducation.org', 'app.stellreducation.org', 'localhost:3000', TENANT, 'stellr.localhost', 'nobody.localhost'])(
      'on %s',
      async (host) => {
        set()
        for (const url of PATHS) {
          const res = await hit(host, url)
          expect(res.status, url).toBe(404)
          expect(rewritten(res), url).toBeNull()
          // The check comes before Clerk and before any map read.
          expect(state.clerkRuns, url).toBe(0)
        }
        expect(fetchStub).not.toHaveBeenCalled()
      },
    )
  })

  it('reaches the proxy for every spelling, dotted paths included, whatever the host', () => {
    for (const url of PATHS) {
      expect(
        unstable_doesMiddlewareMatch({ config, url: `http://localhost:3000${url}`, headers: { host: 'localhost:3000' } }),
        url,
      ).toBe(true)
    }
  })

  it.each([
    '/_t', '/_t/x', '/%5Ft/x', '/%5ft', '/_%74/x', '/_%54', '/%5f%74/x', '/%255Ft/x', '/%2F_t/x', '/_T', '/_t%2Fx',
    '//_t/x', '/%5Ft/%ZZ',
  ])('names %s as the tree', (p) => {
    expect(isInternalTenantTreePath(p)).toBe(true)
  })

  it.each(['/', '/_next/static/a.js', '/_tree', '/_t.png', '/t', '/%5Fnext/x', '/%2E', '/about', '/%ZZ'])(
    'does not name %s as the tree',
    (p) => {
      expect(isInternalTenantTreePath(p)).toBe(false)
    },
  )
})

describe('the matcher stays as it was on Stellr hosts', () => {
  const matchesOn = (host: string, url: string) =>
    unstable_doesMiddlewareMatch({ config, url: `https://${host}${url}`, headers: { host } })

  it('skips the same static and bypass URLs on each Stellr host', () => {
    for (const host of ['www.stellreducation.org', 'stellreducation.org', 'app.stellreducation.org', 'localhost:3000', '127.0.0.1:3000', 'stellr-web-git-x.vercel.app']) {
      for (const url of ['/_next/static/a.js', '/images/logo.png', '/manifest.webmanifest', '/api/img', '/api/csp-report', '/events/nevada.html', '/_vercel/insights/script.js']) {
        expect(matchesOn(host, url), `${host}${url}`).toBe(false)
      }
      expect(matchesOn(host, '/')).toBe(true)
    }
  })

  // The host list in proxy.ts must be a literal, so it cannot import the set. A host
  // missing from it only costs extra proxy runs, and the Stellr path still answers.
  it('names the hosts host-pure treats as Stellr, apart from the local [::1]', () => {
    for (const host of ['www.stellreducation.org', 'stellreducation.org', 'app.stellreducation.org', 'localhost', '127.0.0.1', 'a.vercel.app']) {
      expect(isKnownStellrHost(host), host).toBe(true)
      expect(matchesOn(host, '/x.png'), host).toBe(false)
    }
    // Next compares the host up to its first colon, so an IPv6 literal cannot match.
    expect(isKnownStellrHost('[::1]')).toBe(true)
    expect(matchesOn('[::1]:3000', '/x.png')).toBe(true)
    for (const host of ['canary.events.stellreducation.org', 'stellr.localhost', 'evil.org', 'stellreducation.org.evil.org', 'wwwxstellreducation.org', 'vercel.app']) {
      expect(isKnownStellrHost(host), host).toBe(false)
      expect(matchesOn(host, '/x.png'), host).toBe(true)
    }
  })

  // next.config.mjs's fallback rewrite starts from the same list. A Stellr host missing
  // from it would answer a mistyped URL with the tenant tree's 404 instead of Stellr's.
  describe('the hosts that keep Stellr’s own 404', () => {
    const matches = (pattern: string, host: string) => new RegExp(`^${pattern}$`).test(host)

    it('names the same hosts as the matcher', () => {
      const entry = config.matcher.find((m) => typeof m !== 'string') as { missing: { value: string }[] }
      expect(stellrHostsPattern({})).toBe(entry.missing[0].value)
    })

    it('adds the hosts this deployment is built for, exactly', () => {
      const pattern = stellrHostsPattern({
        NEXT_PUBLIC_SITE_URL: 'https://www.example-site.test',
        NEXT_PUBLIC_AUTH_APP_URL: 'http://app.example-site.test:3000/x',
      })
      expect(matches(pattern, 'www.stellreducation.org')).toBe(true)
      expect(matches(pattern, 'www.example-site.test')).toBe(true)
      expect(matches(pattern, 'app.example-site.test')).toBe(true)
      for (const host of ['appxexample-site.test', 'a.app.example-site.test', 'canary-academy.localhost', 'evil.org']) {
        expect(matches(pattern, host), host).toBe(false)
      }
    })

    it('ignores a URL it cannot read', () => {
      expect(stellrHostsPattern({ NEXT_PUBLIC_SITE_URL: 'not a url', NEXT_PUBLIC_AUTH_APP_URL: '' })).toBe(stellrHostsPattern({}))
    })
  })

  it('runs on a dotted path on a tenant host, except _next and the two bypass routes', () => {
    for (const url of ['/community/x.png', '/community/x.png/members', '/admin/competitions/x.png/check-in', '/register/x.html', '/studio/a.js', '/credentials/a.png']) {
      expect(matchesOn(TENANT, url), url).toBe(true)
    }
    for (const url of ['/_next/static/a.js', '/_next/image', '/api/img', '/api/img/x', '/api/csp-report']) {
      expect(matchesOn(TENANT, url), url).toBe(false)
    }
  })
})

describe('on a tenant host (flag on)', () => {
  beforeEach(() => flagOn())

  it('rewrites an allowed page into the tree and keeps the query', async () => {
    const res = await hit(TENANT, '/register/nevada-sdc/individual?ref=abc')
    expect(rewritten(res)).toBe('/_t/canary-academy/register/nevada-sdc/individual')
    expect(new URL(res.headers.get('x-middleware-rewrite')!).search).toBe('?ref=abc')
    expect(res.status).toBe(200)
  })

  it('serves `/` from the tree, not the marketing home', async () => {
    const res = await hit(TENANT, '/')
    expect(rewritten(res)).toBe('/_t/canary-academy')
    expect(state.crawlerHits).toBe(0)
  })

  it('runs Clerk on a page, so a session works there', async () => {
    await hit(TENANT, '/sign-in')
    expect(state.clerkRuns).toBe(1)
  })

  it('never counts a crawler on a tenant host', async () => {
    for (const url of ['/', '/sign-in', '/register/x', '/community']) await hit(TENANT, url)
    expect(state.crawlerHits).toBe(0)
  })

  it('gives a page no tenant headers: its tenant comes from the URL', async () => {
    const res = await hit(TENANT, '/register/x', { [TENANT_ID_HEADER]: 'client-sent', [TENANT_SLUG_HEADER]: 'client-sent' })
    expect(forwarded(res, TENANT_ID_HEADER)).toBeNull()
    expect(forwarded(res, TENANT_SLUG_HEADER)).toBeNull()
    expect(res.headers.get('x-middleware-override-headers')).not.toContain(TENANT_ID_HEADER)
  })

  it('forwards an allowed API with the trusted headers, replacing a client-sent pair', async () => {
    const res = await hit(TENANT, '/api/register/individual', {
      [TENANT_ID_HEADER]: STELLR_TENANT_ID,
      [TENANT_SLUG_HEADER]: 'stellr',
    })
    expect(rewritten(res)).toBeNull()
    expect(forwarded(res, TENANT_ID_HEADER)).toBe(CANARY)
    expect(forwarded(res, TENANT_SLUG_HEADER)).toBe('canary-academy')
  })

  it('ignores X-Forwarded-Host and Forwarded when choosing the tenant', async () => {
    const res = await hit('www.stellreducation.org', '/about', {
      'x-forwarded-host': TENANT,
      forwarded: `host=${TENANT}`,
    })
    expect(rewritten(res)).toBeNull()
    const other = await hit(TENANT, '/', { 'x-forwarded-host': 'www.stellreducation.org' })
    expect(rewritten(other)).toBe('/_t/canary-academy')
  })

  it.each([
    '/admin',
    '/admin/members',
    '/community',
    '/community/x',
    '/home',
    '/store',
    '/academy',
    '/join',
    '/campaigns',
    '/events',
    '/events/nevada',
    '/about',
    '/studio',
    '/account',
    '/api/admin/members',
    '/api/community/posts',
    '/api/cron/surveys',
    '/api/webhooks/clerk',
    '/api/members/me',
    '/sitemap.xml',
    '/llms.txt',
    // A file extension does not make these static files on this host.
    '/community/x.png',
    '/community/x.png/members',
    '/COMMUNITY/x.png',
    '/admin/x.html',
    '/events/nevada.html',
    '/studio/a.js',
    '/x.pngfoo',
    '/images/a.png/b',
    '/%63ommunity/x.png',
    '/%69mages/a.png',
  ])('denies %s with a 404, with an admin session on it', async (url) => {
    const res = await hit(TENANT, url)
    expect(res.status).toBe(404)
    expect(rewritten(res)).toBeNull()
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(state.clerkRuns).toBe(0)
  })

  // A dot in a param of an allowed route is still that route: it goes into the tree
  // with the same checks, never to the Stellr page and never out as a static file.
  it.each(['/register/x.png', '/credentials/a.png', '/sign-in/x.css'])('rewrites %s into the tree', async (url) => {
    const res = await hit(TENANT, url)
    expect(rewritten(res)).toBe(`/_t/canary-academy${url}`)
  })

  it.each(['/images/logo.png', '/fonts/a.woff2', '/favicon.ico', '/icon.png', '/manifest.webmanifest', '/app.webmanifest', '/check-in-desk-sw.js', '/vendor/zxing_reader.wasm'])(
    'passes the static file %s through, with no session and no tenant headers',
    async (url) => {
      const res = await hit(TENANT, url, { [TENANT_ID_HEADER]: 'client-sent' })
      expect(res.status).toBe(200)
      expect(res.headers.get('x-middleware-next')).toBe('1')
      expect(forwarded(res, TENANT_ID_HEADER)).toBeNull()
      expect(state.clerkRuns).toBe(0)
    },
  )

  it('answers robots.txt with disallow-all', async () => {
    const res = await hit(TENANT, '/robots.txt')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(TENANT_HOST_ROBOTS_TXT)
  })

  it('still requires a session on /account/onboarding', async () => {
    await hit(TENANT, '/account/onboarding')
    expect(state.protects).toBe(1)
  })

  it('still limits credential lookups', async () => {
    const headers = { 'x-real-ip': '203.0.113.77' }
    let last = 0
    for (let i = 0; i < 61; i += 1) last = (await hit(TENANT, '/credentials/SC-0001', headers)).status
    expect(last).toBe(429)
  })

  it('sends the nonce to a page that renders per request', async () => {
    const res = await hit(TENANT, '/register/x')
    expect(forwarded(res, 'x-nonce')).toBeTruthy()
    expect(res.headers.get('content-security-policy')).toContain(`'nonce-${forwarded(res, 'x-nonce')}'`)
  })

  it('never rewrites the platform owner host into the tree', async () => {
    const res = await hit('stellr.localhost', '/about')
    expect(rewritten(res)).toBeNull()
    expect(res.status).toBe(200)
  })

  it('answers 404, never Stellr, for an unknown zone host and an invalid host', async () => {
    for (const host of ['nobody.localhost']) {
      for (const url of ['/', '/about', '/admin', '/images/a.png']) {
        const res = await hit(host, url)
        expect(res.status, url).toBe(404)
        expect(rewritten(res)).toBeNull()
      }
    }
    // A bad Host header: Next would not build this URL, so the header alone is bad.
    const req = new NextRequest('https://www.stellreducation.org/', { headers: { host: 'bad_host!' } })
    expect((await proxy(req, event)).status).toBe(404)
    expect(state.clerkRuns).toBe(0)
  })
})

// The S5 gate "0 community routes on tenant hosts" (B9), through the proxy itself. The
// control is the same URLs on Stellr's app host, where this session reaches each one.
describe('community and home are unreachable on tenant hosts (flag on)', () => {
  beforeEach(flagOn)

  const COMMUNITY_AND_HOME = Object.keys(ROUTE_MANIFEST).filter((f) =>
    /^app\/(?:\(stellr\)\/\(member\)\/community\/|api\/community\/|\(stellr\)\/\(member\)\/home\/)/.test(f),
  )

  it('covers all 80 entries, as pages and as APIs', () => {
    expect(COMMUNITY_AND_HOME).toHaveLength(80)
    expect(COMMUNITY_AND_HOME.filter((f) => f.endsWith('/page.tsx'))).toHaveLength(40)
    expect(COMMUNITY_AND_HOME.filter((f) => /\/route\.tsx?$/.test(f))).toHaveLength(40)
  })

  it.each(COMMUNITY_AND_HOME)('%s', async (file) => {
    const url = sampleUrl(file)
    const denied = await hit(TENANT, url)
    expect(denied.status, `tenant host ${url}`).toBe(404)
    expect(rewritten(denied)).toBeNull()
    expect(state.clerkRuns).toBe(0)

    // An unknown host in the zone fails closed, and naming a real host does not help.
    const unknown = await hit('nobody.localhost', url, {
      'x-forwarded-host': TENANT,
      forwarded: `host=${TENANT}`,
      [TENANT_ID_HEADER]: CANARY,
      [TENANT_SLUG_HEADER]: 'canary-academy',
    })
    expect(unknown.status, `unknown host ${url}`).toBe(404)
    expect(rewritten(unknown)).toBeNull()

    // The control: if this were also a 404, the assertions above would prove nothing.
    const stellr = await hit('app.stellreducation.org', url)
    expect(stellr.status, `Stellr host ${url}`).toBe(200)
    expect(stellr.headers.get('x-middleware-next'), `Stellr host ${url}`).toBe('1')
  })
})

describe('when the tenant zone or map cannot be trusted (flag on)', () => {
  it('answers 503 no-store for a zone host when the map cannot load, never Stellr', async () => {
    flagOn()
    // Unique modules: the default resolver caches per instance.
    vi.resetModules()
    const fresh = (await import('@/proxy')).default
    fetchStub.mockImplementation(async () => new Response('nope', { status: 500 }))
    const res = await fresh(request('fresh-failure.localhost', '/'), event)
    expect(res.status).toBe(503)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(rewritten(res)).toBeNull()
    expect(state.clerkRuns).toBe(0)
  })

  it('with a bad zone setting, keeps Stellr hosts up and answers 503 elsewhere', async () => {
    vi.stubEnv('TENANT_ROUTING_ENABLED', 'true')
    vi.stubEnv('TENANT_HOST_SUFFIX', '.stellreducation.org')
    expect((await hit('www.stellreducation.org', '/about')).status).toBe(200)
    const res = await hit('canary.events.stellreducation.org', '/')
    expect(res.status).toBe(503)
    expect(fetchStub).not.toHaveBeenCalled()
  })
})

describe('the credential limit on a Stellr host', () => {
  it.each([
    ['off', flagOff],
    ['on', flagOn],
  ])('limits per visitor, flag %s', async (name, set) => {
    set()
    const lookup = (ip: string) => hit('www.stellreducation.org', '/credentials/SC-0001', { 'x-real-ip': ip })
    const ip = name === 'off' ? '203.0.113.10' : '203.0.113.11'
    for (let i = 0; i < 60; i += 1) expect((await lookup(ip)).status).toBe(200)
    const limited = await lookup(ip)
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
    // One bucket per address, not one for all visitors.
    const other = name === 'off' ? '203.0.113.20' : '203.0.113.21'
    expect((await lookup(other)).status).toBe(200)
  })
})

describe('tenantHostRoute', () => {
  it.each([
    ['/', 'home'],
    ['/robots.txt', 'robots'],
    ['/register/x', 'page'],
    ['/sign-in', 'page'],
    ['/privacy', 'page'],
    ['/api/register/group', 'api'],
    ['/api/check-in', 'api'],
    ['/images/a.png', 'static'],
    ['/manifest.webmanifest', 'static'],
    ['/about', 'denied'],
    ['/_t/x', 'denied'],
    ['/%5Ft/x.png', 'denied'],
    ['/api/x.png', 'denied'],
    ['/images/../community/x.png', 'denied'],
    ['/images//a.png', 'denied'],
    ['/register/x.json', 'page'],
  ])('%s is %s', (p, route) => {
    expect(tenantHostRoute(p)).toBe(route)
  })

  it('keeps every first segment of public/ apart from the routes, so assets are not denied', () => {
    for (const dir of ['email', 'fonts', 'icons', 'images', 'team']) {
      expect(tenantHostRoute(`/${dir}/a.png`), dir).toBe('static')
    }
  })

  // A dynamic first segment would make every dotted URL a page, and the static rule
  // would hand it to Next with no check.
  it('relies on there being no dynamic route at the root', () => {
    const roots = Object.keys(ROUTE_MANIFEST).filter((f) =>
      /^\[/.test(f.replace(/^app\//, '').split('/').filter((p) => !/^\(.+\)$/.test(p))[0] ?? ''),
    )
    expect(roots).toEqual([])
  })
})

// Import walk: the routes the proxy skips must not reach requestTenant(), whose
// headers only the proxy can vouch for. And proxy.ts itself stays free of it.
const ROOT = process.cwd()
const EXTENSIONS = ['', '.ts', '.tsx', '.mts', '.js', '.mjs', '/index.ts', '/index.tsx']

function importsOf(file: string, src: string): string[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true)
  const out: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier)) {
      out.push(node.moduleSpecifier.text)
    } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      out.push(node.moduleSpecifier.text)
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      out.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/** The static import closure of a file. Pass `seen` to share one walk across entries. */
function closure(entry: string, seen = new Set<string>()): Set<string> {
  const queue = [entry]
  while (queue.length) {
    const file = queue.pop() as string
    if (seen.has(file)) continue
    seen.add(file)
    const src = readFileSync(path.join(ROOT, file), 'utf8')
    for (const spec of importsOf(file, src)) {
      let base: string
      if (spec.startsWith('@/')) base = spec.slice(2)
      else if (spec.startsWith('.')) base = path.posix.join(path.posix.dirname(file), spec)
      else continue
      for (const ext of EXTENSIONS) {
        const candidate = `${base}${ext}`
        if (/\.(tsx?|mts|m?js)$/.test(candidate) && existsSync(path.join(ROOT, candidate))) {
          queue.push(candidate)
          break
        }
      }
    }
  }
  return seen
}

/** Whether a file's code (not its comments) names requestTenant, beyond its own module. */
function namesRequestTenant(file: string, src: string): boolean {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true)
  let found = false
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === 'requestTenant') found = true
    if (!found) ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

describe('requestTenant() runs only on routes the proxy matches', () => {
  const REQUEST_TENANT = 'lib/tenancy/request-tenant.ts'
  const allHosts = ['www.stellreducation.org', TENANT]

  it('is out of reach of everything under app/ that is not an API route', () => {
    const entries = readdirSync(path.join(ROOT, 'app'), { recursive: true, encoding: 'utf8' })
      .map((f) => `app/${f.split(path.sep).join('/')}`)
      .filter((f) => /\.(tsx?|mts|m?js)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith('app/api/'))
    // Layouts, not-found files and the tenant tree count too, not only manifest routes.
    expect(entries).toContain('app/(stellr)/layout.tsx')
    expect(entries).toContain('app/%5Ft/[tenant]/layout.tsx')
    expect(entries.length).toBeGreaterThan(150)

    const walked = new Set<string>()
    for (const entry of entries) closure(entry, walked)
    const offenders = [...walked].filter(
      (file) => file !== REQUEST_TENANT && namesRequestTenant(file, readFileSync(path.join(ROOT, file), 'utf8')),
    )
    expect(offenders).toEqual([])
    // The walk really does get as far as this module, through tenantFromParams.
    expect(walked.has(REQUEST_TENANT)).toBe(true)
  })

  it('tells a call to requestTenant from a comment that mentions it', () => {
    expect(namesRequestTenant('a.ts', 'const t = await requestTenant()')).toBe(true)
    expect(namesRequestTenant('a.ts', "import { requestTenant } from './request-tenant'")).toBe(true)
    expect(namesRequestTenant('a.ts', '// requestTenant is for API routes\nconst a = 1')).toBe(false)
  })

  it('reaches the proxy on a Stellr host for every API route, whatever a param holds', () => {
    const apis = Object.keys(ROUTE_MANIFEST).filter(
      (f) => f.startsWith('app/api/') && f !== 'app/api/img/route.ts' && f !== 'app/api/csp-report/route.ts',
    )
    expect(apis.length).toBeGreaterThan(200)
    for (const file of apis) {
      for (const url of [sampleUrl(file), `${sampleUrl(file)}.png`, sampleUrl(file).replace(/x1/g, 'x1.png')]) {
        const reached = unstable_doesMiddlewareMatch({
          config,
          url: `https://www.stellreducation.org${url}`,
          headers: { host: 'www.stellreducation.org' },
        })
        expect(reached, url).toBe(true)
      }
    }
  })

  it('leaves member identity independent of the tenant', () => {
    expect(closure('lib/community.ts').has(REQUEST_TENANT)).toBe(false)
  })

  it('finds which manifest routes the proxy skips on some host', () => {
    const skipped = Object.keys(ROUTE_MANIFEST).filter((file) =>
      allHosts.some(
        (host) =>
          !unstable_doesMiddlewareMatch({ config, url: `https://${host}${sampleUrl(file)}`, headers: { host } }),
      ),
    )
    expect(skipped.sort()).toEqual([
      'app/api/csp-report/route.ts',
      'app/api/img/route.ts',
      'app/app.webmanifest/route.ts',
      'app/manifest.ts',
    ])
    for (const file of skipped) expect(closure(file).has(REQUEST_TENANT), file).toBe(false)
  })

  it('keeps next/headers and the Supabase client out of the proxy bundle', () => {
    const proxyFiles = closure('proxy.ts')
    expect(proxyFiles.has('lib/tenancy/host.ts')).toBe(true)
    expect(proxyFiles.has(REQUEST_TENANT)).toBe(false)
    expect(proxyFiles.has('lib/supabase.ts')).toBe(false)
    expect(proxyFiles.has('lib/community.ts')).toBe(false)
  })
})
