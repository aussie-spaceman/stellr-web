// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { NextRequest, type NextFetchEvent } from 'next/server'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { importClosureOf, readRepoFile } from './import-closure'

// S5, B6: the enforcing policy on a tenant host's pages, and what it must leave alone.
// A browser runs it in e2e/tenancy/tenant-csp.spec.ts. This holds the header's shape,
// where it goes, what a tenant page's code asks of it, and Stellr's two policies.

vi.mock('@clerk/nextjs/server', () => {
  const toRegex = (p: string) => new RegExp('^' + p.replace(/:[a-z]+/gi, '[^/]+').replace(/\(\.\*\)/g, '.*') + '$')
  return {
    createRouteMatcher: (patterns: string[]) => (req: Request) =>
      patterns.some((p) => toRegex(p).test(new URL(req.url).pathname)),
    clerkMiddleware:
      (handler: (auth: unknown, req: NextRequest, event: NextFetchEvent) => Promise<Response | undefined>) =>
      (req: NextRequest, event: NextFetchEvent) => {
        const session = { userId: null, sessionClaims: {} }
        return handler(Object.assign(async () => session, { protect: async () => {} }), req, event)
      },
  }
})
vi.mock('@/lib/env', () => ({
  APP_HOST: 'app.stellreducation.org',
  SITE_URL: 'https://www.stellreducation.org',
  isProductionDeployment: () => false,
}))
vi.mock('@/lib/crawlers', () => ({ matchCrawler: () => null, recordCrawlerHit: async () => {} }))

import proxy from '@/proxy'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { TENANT_HTML_APIS, consentModeHash, hostPolicy, noncePolicy, tenantPagePolicy } from '@/lib/csp'
import { allowedTenantFiles } from '@/lib/tenancy/tenant-surface'
import nextConfig, { stellrHostsPattern } from '../next.config.mjs'

const CANARY = '11111111-1111-4111-8111-111111111111'
const TENANT = 'canary-academy.localhost'
const HOST_ROWS = [
  { host: TENANT, tenant_id: CANARY, tenants: { slug: 'canary-academy', status: 'active' } },
  { host: 'stellr.localhost', tenant_id: STELLR_TENANT_ID, tenants: { slug: 'stellr', status: 'active' } },
]

const event = { waitUntil: (p: Promise<unknown>) => void p } as unknown as NextFetchEvent
const hit = (host: string, rawPath: string, headers: Record<string, string> = {}) =>
  proxy(new NextRequest(`https://${host}${rawPath}`, { headers: { host, ...headers } }), event)
const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`)
const ENFORCING = 'content-security-policy'
const REPORT_ONLY = 'content-security-policy-report-only'
const nonceOf = (policy: string | null) => /'nonce-([^']+)'/.exec(policy ?? '')?.[1] ?? null

const flagOff = () => vi.stubEnv('TENANT_ROUTING_ENABLED', undefined)
const flagOn = () => {
  vi.stubEnv('TENANT_ROUTING_ENABLED', 'true')
  vi.stubEnv('TENANT_HOST_SUFFIX', '.localhost')
}

const ENV = {
  NODE_ENV: 'production',
  NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
  NEXT_PUBLIC_MEDIA_BASE_URL: 'https://media.test/media',
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_live_${Buffer.from('clerk.example.org$').toString('base64')}`,
  NEXT_PUBLIC_SANITY_PROJECT_ID: 'proj1',
}

const directive = (policy: string, name: string) =>
  policy.split('; ').find((d) => d.startsWith(`${name} `))?.split(' ').slice(1) ?? []

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(HOST_ROWS), { status: 200 })))
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://db.test')
  vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_TESTONLY')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('a page on a tenant host', () => {
  beforeEach(() => flagOn())

  // Everything the tree answers, `/` and a path with no page in it included. On Stellr
  // `/` and /privacy get the host policy with no nonce: here that would stop every script.
  const PAGES = ['/', '/register/x', '/sign', '/sign/copy', '/check-in', '/survey/x', '/team-profile/x', '/privacy', '/terms', '/sign-in', '/credentials/SC-1', '/account/onboarding']

  it.each(PAGES)('%s gets the enforcing policy and no Report-Only one', async (page) => {
    const res = await hit(TENANT, page)
    const nonce = nonceOf(res.headers.get(ENFORCING))
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/)
    expect(res.headers.get(ENFORCING)).toBe(tenantPagePolicy(nonce as string))
    expect(res.headers.get(REPORT_ONLY)).toBeNull()
    expect(res.headers.get('reporting-endpoints')).toBe(`csp-endpoint="https://${TENANT}/api/csp-report"`)
  })

  it.each(PAGES)('%s hands Next and the layouts that same nonce', async (page) => {
    const res = await hit(TENANT, page)
    // Next reads the policy from the request headers, whichever of the two names it has.
    expect(forwarded(res, ENFORCING)).toBe(res.headers.get(ENFORCING))
    expect(forwarded(res, REPORT_ONLY)).toBeNull()
    expect(forwarded(res, 'x-nonce')).toBe(nonceOf(res.headers.get(ENFORCING)))
  })

  it('mints a new nonce for each request', async () => {
    const a = nonceOf((await hit(TENANT, '/sign')).headers.get(ENFORCING))
    const b = nonceOf((await hit(TENANT, '/sign')).headers.get(ENFORCING))
    expect(a).not.toBe(b)
  })

  it('takes no nonce or policy from the client', async () => {
    const res = await hit(TENANT, '/sign', {
      'x-nonce': 'chosen',
      [ENFORCING]: "script-src 'nonce-chosen'",
      [REPORT_ONLY]: "script-src 'nonce-chosen'",
    })
    expect(res.headers.get(ENFORCING)).not.toContain('chosen')
    expect(forwarded(res, ENFORCING)).not.toContain('chosen')
    expect(forwarded(res, 'x-nonce')).not.toBe('chosen')
    expect(forwarded(res, REPORT_ONLY)).toBeNull()
  })
})

describe('on a tenant host, what is not a page', () => {
  beforeEach(() => flagOn())

  // next.config.mjs sets its own enforcing header on /api/sign/**. A proxy header of that
  // name would replace it, and 'object-src' on a PDF can stop the browser's own viewer.
  it.each(['/api/sign/document', '/api/sign/context', '/api/credentials/SC-1/pdf', '/api/check-in'])(
    '%s sends no enforcing header of its own',
    async (api) => {
      const res = await hit(TENANT, api)
      expect(res.headers.get(ENFORCING)).toBeNull()
      expect(forwarded(res, ENFORCING)).toBeNull()
      expect(res.headers.get(REPORT_ONLY)).toContain("'nonce-")
    },
  )

  it('/api/email/unsubscribe, which draws request values into HTML, enforces a policy with no script', async () => {
    const res = await hit(TENANT, '/api/email/unsubscribe')
    expect(res.headers.get(ENFORCING)).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'; report-uri /api/csp-report; report-to csp-endpoint",
    )
    // A route handler has no scripts for Next to stamp, so Next is not told of it.
    expect(forwarded(res, ENFORCING)).toBeNull()
  })

  it('no other allowed API answers with HTML', () => {
    const html = allowedTenantFiles().filter(
      (file) => file.startsWith('app/api/') && /['"]?Content-Type['"]?\s*:\s*['"]text\/html/i.test(readFileSync(file, 'utf8')),
    )
    expect(html).toEqual(['app/api/email/unsubscribe/route.ts'])
    expect([...TENANT_HTML_APIS]).toEqual(['/api/email/unsubscribe'])
  })

  // A miss here renders the tree's 404 through next.config.mjs's fallback rewrite.
  it.each(['/images/a.png', '/no-such-file.html', '/no-such-file.js', '/manifest.webmanifest'])(
    '%s gets the page policy and hands Next its nonce',
    async (url) => {
      const res = await hit(TENANT, url, { 'x-nonce': 'chosen', [ENFORCING]: "script-src 'nonce-chosen'", [REPORT_ONLY]: 'x' })
      const nonce = nonceOf(res.headers.get(ENFORCING))
      expect(res.headers.get(ENFORCING)).toBe(tenantPagePolicy(nonce as string))
      expect(res.headers.get(REPORT_ONLY)).toBeNull()
      expect(nonce).not.toBe('chosen')
      expect(forwarded(res, ENFORCING)).toBe(res.headers.get(ENFORCING))
      expect(forwarded(res, 'x-nonce')).toBe(nonce)
      expect(forwarded(res, REPORT_ONLY)).toBeNull()
    },
  )

  it('a static file takes no tenant from the client', async () => {
    const res = await hit(TENANT, '/images/a.png', { 'x-stellr-tenant-id': CANARY, 'x-stellr-tenant-slug': 'x' })
    expect(forwarded(res, 'x-stellr-tenant-id')).toBeNull()
    expect(forwarded(res, 'x-stellr-tenant-slug')).toBeNull()
  })

  // That policy reaches a real file too. A worker's own response governs the worker.
  it('the only script under public/ is one no tenant page registers', () => {
    const scripts = readdirSync('public', { recursive: true, encoding: 'utf8' }).filter((file) => /\.(?:m?js|html?)$/.test(file))
    expect(scripts).toEqual(['check-in-desk-sw.js'])
    expect(readFileSync('components/admin/CheckInLive.tsx', 'utf8')).toContain("scope: '/admin/competitions/'")
  })

  it.each(['/robots.txt', '/community', '/admin'])('%s gets no policy', async (url) => {
    const res = await hit(TENANT, url)
    expect(res.headers.get(ENFORCING)).toBeNull()
    expect(res.headers.get(REPORT_ONLY)).toBeNull()
  })

  // These skip the proxy, and a miss reaches the same 404.
  describe('what skips the proxy', () => {
    const rules = async () => ((await nextConfig.headers?.()) ?? []).filter((rule) => rule.missing)

    it('has a policy with no script rule, on any host but Stellr’s', async () => {
      const found = await rules()
      expect(found.map((rule) => rule.source)).toEqual(['/_next/:path*', '/api/img/:path*', '/api/csp-report/:path*'])
      for (const rule of found) {
        expect(rule.missing).toEqual([{ type: 'host', value: stellrHostsPattern() }])
        expect(rule.headers).toEqual([{ key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'none'; object-src 'none'" }])
      }
    })

    // The rule in next.config.mjs can name no script source: those scripts carry no nonce.
    it('keeps the tree’s 404 free of anything from the request', () => {
      expect(readFileSync(`app/%5Ft/[tenant]/[...rest]/page.tsx`, 'utf8')).toMatch(/TenantUnmatchedPage\(\): never \{\s*notFound\(\)\s*\}/)
      const layout = readFileSync('app/%5Ft/[tenant]/layout.tsx', 'utf8')
      expect(layout).not.toMatch(/next\/headers|headers\(\)|cookies\(\)|searchParams/)
      expect(layout).toContain('TenantLayout({ children }:')
    })
  })
})

describe('Stellr’s hosts', () => {
  // The whole string for one fixed environment, so a change to either policy shows here.
  // The harness compares the real headers: e2e/tenancy/flag-parity.spec.ts with routing
  // on and off, and stellr-document.spec.ts against the committed capture.
  it('keep both policies, byte for byte', () => {
    const shared = [
      "default-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "media-src 'self' blob: https://media.test https://abc.supabase.co",
      "connect-src 'self' https://abc.supabase.co wss://abc.supabase.co https://media.test https://clerk.example.org https://clerk-telemetry.com https://challenges.cloudflare.com https://proj1.api.sanity.io https://proj1.apicdn.sanity.io wss://proj1.api.sanity.io https://api.sanity.io https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://*.g.doubleclick.net https://www.google.com https://*.hubspot.com https://*.hs-banner.com https://*.hscollectedforms.net https://*.hsforms.com https://*.hs-analytics.net https://www.facebook.com https://connect.facebook.net https://px.ads.linkedin.com https://*.apollo.io https://va.vercel-scripts.com",
      "frame-src 'self' https: blob:",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
      'report-uri /api/csp-report',
      'report-to csp-endpoint',
    ].join('; ')
    expect(noncePolicy('abc', ENV)).toBe(
      `script-src 'nonce-abc' 'strict-dynamic' ${consentModeHash()} 'wasm-unsafe-eval' https: 'unsafe-inline'; ${shared}`,
    )
    expect(hostPolicy(ENV)).toBe(
      `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://clerk.example.org https://challenges.cloudflare.com https://www.googletagmanager.com https://*.googletagmanager.com https://www.googleadservices.com https://googleads.g.doubleclick.net https://www.google.com https://js.hs-scripts.com https://js.hs-analytics.net https://js.hs-banner.com https://js.hscollectedforms.net https://js.hsadspixel.net https://js.usemessages.com https://connect.facebook.net https://snap.licdn.com https://assets.apollo.io https://8x8.vc https://meet.jit.si https://va.vercel-scripts.com; ${shared}`,
    )
  })

  describe.each([
    ['off', flagOff],
    ['on', flagOn],
  ])('with routing %s', (_name, set) => {
    beforeEach(() => set())
    const HOSTS = ['www.stellreducation.org', 'app.stellreducation.org', 'localhost:3000', 'stellr.localhost']

    it.each(HOSTS)('%s never sends an enforcing header from the proxy', async (host) => {
      for (const page of ['/', '/about', '/sign', '/check-in', '/register/x', '/account', '/api/check-in', '/api/email/unsubscribe', '/images/a.png']) {
        const res = await hit(host, page)
        expect(res.headers.get(ENFORCING), page).toBeNull()
        expect(forwarded(res, ENFORCING), page).toBeNull()
      }
    })

    it.each(HOSTS)('%s sends the Report-Only policy it always did', async (host) => {
      const page = await hit(host, '/sign')
      const nonce = nonceOf(page.headers.get(REPORT_ONLY)) as string
      expect(page.headers.get(REPORT_ONLY)).toBe(noncePolicy(nonce))
      const grant = await hit(host, '/grant')
      expect(grant.headers.get(REPORT_ONLY)).toBe(hostPolicy())
    })
  })

  it('a host in the zone with routing off gets the Stellr path, so no enforcing header', async () => {
    flagOff()
    vi.stubEnv('TENANT_HOST_SUFFIX', '.localhost')
    expect((await hit(TENANT, '/sign')).headers.get(ENFORCING)).toBeNull()
  })
})

describe('the policy', () => {
  const policy = tenantPagePolicy('abc', ENV)

  // The whole string, as for Stellr's above. A browser test does not hold every source: no
  // harness page renders the check-in code, whose QR code needs img-src's data:.
  it('is this, byte for byte', () => {
    expect(policy).toBe(
      [
        "script-src 'nonce-abc' 'strict-dynamic' https: 'unsafe-inline'",
        "default-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https://img.clerk.com",
        "font-src 'self'",
        "connect-src 'self' https://clerk.example.org https://img.clerk.com https://clerk-telemetry.com https://*.clerk-telemetry.com https://*.protect.clerk.com:*",
        "frame-src 'self' https://challenges.cloudflare.com https://*.protect.clerk.com",
        "worker-src 'self' blob:",
        "manifest-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        'report-uri /api/csp-report',
        'report-to csp-endpoint',
      ].join('; '),
    )
  })

  it('allows script by this nonce only, in any browser that reads nonces', () => {
    expect(directive(policy, 'script-src')).toEqual(["'nonce-abc'", "'strict-dynamic'", 'https:', "'unsafe-inline'"])
    expect(policy.startsWith("script-src 'nonce-abc' 'strict-dynamic'")).toBe(true)
  })

  it('allows eval only under next dev', () => {
    expect(policy).not.toContain('unsafe-eval')
    expect(tenantPagePolicy('abc', { ...ENV, NODE_ENV: 'development' })).toContain("'unsafe-eval'")
  })

  it('has no hash, because the tree has no ConsentMode or GTM script to allow', () => {
    expect(policy).not.toContain("'sha256-")
  })

  it('names no host a tag or a beacon would use, and nothing else the tree does not call', () => {
    for (const host of ['google', 'doubleclick', 'hubspot', 'hs-', 'facebook', 'linkedin', 'licdn', 'apollo', 'usemessages', 'vercel', 'sanity', 'supabase', 'media.test', '8x8', 'jit.si']) {
      expect(policy, host).not.toContain(host)
    }
  })

  it('does not fall back to any https: host outside script-src', () => {
    for (const name of ['img-src', 'frame-src', 'connect-src', 'font-src', 'style-src', 'worker-src']) {
      expect(directive(policy, name), name).not.toContain('https:')
    }
  })

  it('cannot be framed, takes no plugin and no <base>, and posts only to itself', () => {
    expect(directive(policy, 'frame-ancestors')).toEqual(["'none'"])
    expect(directive(policy, 'object-src')).toEqual(["'none'"])
    expect(directive(policy, 'base-uri')).toEqual(["'none'"])
    expect(directive(policy, 'form-action')).toEqual(["'self'"])
    expect(directive(policy, 'default-src')).toEqual(["'self'"])
  })

  it('still reports what it blocks', () => {
    expect(policy).toContain('report-uri /api/csp-report; report-to csp-endpoint')
  })

  it('takes Clerk’s host from the key', () => {
    expect(directive(policy, 'connect-src')).toContain('https://clerk.example.org')
    expect(directive(tenantPagePolicy('abc', {}), 'connect-src')).toContain('https://*.clerk.accounts.dev')
  })

  // The Report-Only policy has no such check, because a miss there only reports. Here a
  // miss stops a sign-in, so a Clerk upgrade that adds a host has to fail this first.
  describe('and what Clerk says it needs', () => {
    // No tenant page uses Clerk's billing or address components. Checkout is a
    // top-level navigation, which the policy does not govern.
    const NOT_USED = new Set([
      'https://api.stripe.com',
      'https://maps.googleapis.com',
      'https://*.js.stripe.com',
      'https://js.stripe.com',
      'https://hooks.stripe.com',
    ])

    it.each(['connect-src', 'frame-src', 'img-src', 'style-src', 'worker-src', 'form-action', 'default-src'])('%s', async (name) => {
      // Not in the package's exports map, so by path, found through the package's
      // own resolution (a worktree without its own node_modules finds its parent's).
      const file = path.join(path.dirname(createRequire(import.meta.url).resolve('@clerk/nextjs')), '..', '..', 'dist/esm/server/content-security-policy.js')
      const { createContentSecurityPolicyHeaders } = (await import(/* @vite-ignore */ file)) as {
        createContentSecurityPolicyHeaders: (host: string, options: { strict: boolean }) => { headers: [string, string][] }
      }
      const clerks = createContentSecurityPolicyHeaders('https://clerk.example.org', { strict: true }).headers
      const header = clerks.find(([key]) => key.toLowerCase() === 'content-security-policy')?.[1] ?? ''
      const asked = directive(header, name).filter((source) => !NOT_USED.has(source))
      expect(asked.length).toBeGreaterThan(0)
      const ours = directive(policy, name)
      expect(asked.filter((source) => !ours.includes(source))).toEqual([])
    })
  })
})

// A policy is only as good as what the pages under it do. Each kind of thing below would
// be blocked at run time, or could be if its value came from elsewhere, so a new one has
// to be named here and allowed on purpose.
describe('what the tenant tree’s own code asks of the policy', () => {
  const TREE = 'app/%5Ft'

  function treeFiles(): string[] {
    return readdirSync(path.join(process.cwd(), TREE), { recursive: true, encoding: 'utf8' })
      .map((rel) => path.posix.join(TREE, rel.split(path.sep).join('/')))
      .filter((rel) => /\.tsx?$/.test(rel) && !/\.test\.tsx?$/.test(rel))
  }

  // One line at a time, in .tsx only: .ts files in the closure hold email HTML.
  const BLOCKED_BY_POLICY: [string, RegExp][] = [
    ['an inline or un-nonced script', /<script\b|<Script\b|from ['"]next\/script['"]/],
    ['injected HTML', /dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML/],
    ['an inline handler or javascript: URL', /setAttribute\(\s*['"]on|javascript:/],
    ['eval', /\beval\(|new Function\(/],
    ['a plugin', /<object\b|<embed\b/],
    ['a frame', /<iframe\b|createElement\(\s*['"]iframe['"]/],
    ['an image from another host', /url\(\s*['"]?https?:/],
    ['the browser Supabase client', /lib\/supabase-browser|createBrowserClient/],
  ]

  const sameOrigin = (text: string) => /^\/(?!\/)/.test(text) || text.startsWith('data:')
  const isElsewhere = (text: string) => /^(?:https?|wss?):|^\/\//.test(text)

  /** The text a URL argument starts with, or null when a value decides all of it. */
  function leadingText(node: ts.Node | undefined): string | null {
    if (!node) return null
    if (ts.isStringLiteralLike(node)) return node.text
    if (ts.isTemplateExpression(node)) return node.head.text
    if (ts.isJsxExpression(node) || ts.isParenthesizedExpression(node)) return leadingText(node.expression)
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return leadingText(node.left)
    return null
  }

  const REMOTE_MEDIA = new Set(['img', 'Image', 'source', 'video', 'audio', 'track'])
  const NETWORK_CALLS = new Set(['fetch', 'sendBeacon'])
  const NETWORK_CONSTRUCTORS = new Set(['EventSource', 'WebSocket', 'Worker', 'SharedWorker'])

  /** What only the syntax tree shows: JSX over several lines, and a URL that comes from a value. */
  function syntaxFindings(file: string, src: string, inBrowser: boolean): string[] {
    const found: string[] = []
    const jsx = file.endsWith('x')
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, jsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const network = (arg: ts.Node | undefined) => {
      const text = leadingText(arg)
      if (text === null || text === '') found.push('a call to a host from a value')
      else if (!sameOrigin(text)) found.push(isElsewhere(text) ? 'a call to another host' : 'a call to a host from a value')
    }
    const visit = (node: ts.Node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(sf)
        for (const attr of node.attributes.properties) {
          if (!ts.isJsxAttribute(attr) || !attr.initializer) continue
          const name = attr.name.getText(sf)
          const text = leadingText(attr.initializer)
          if (REMOTE_MEDIA.has(tag) && name === 'src') {
            if (text === null || text === '') found.push('an image from a value')
            else if (!sameOrigin(text)) found.push('an image from another host')
          }
          if (tag === 'form' && name === 'action' && text !== null && isElsewhere(text)) found.push('a form that posts elsewhere')
        }
      }
      if (ts.isCallExpression(node)) {
        const callee = node.expression
        const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : ''
        const first = node.arguments[0]
        // In any file, .ts included: 'strict-dynamic' trusts a script a running script adds.
        if (name === 'createElement' && first && leadingText(first) === 'script') found.push('an inline or un-nonced script')
        if (callee.kind === ts.SyntaxKind.ImportKeyword && first && isElsewhere(leadingText(first) ?? '')) found.push('an inline or un-nonced script')
        if (name === 'importScripts' || (name.startsWith('write') && ts.isPropertyAccessExpression(callee) && callee.expression.getText(sf) === 'document')) {
          found.push('an inline or un-nonced script')
        }
        if (inBrowser && NETWORK_CALLS.has(name)) network(first)
      }
      if (ts.isNewExpression(node) && inBrowser && ts.isIdentifier(node.expression) && NETWORK_CONSTRUCTORS.has(node.expression.text)) {
        network(node.arguments?.[0])
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
    return found
  }

  // `browser` says which files run there. A call on the server is not this policy's business.
  function scan(files: Iterable<string>, read: (file: string) => string | null, browser: ReadonlySet<string> | null = null): string[] {
    const found: string[] = []
    for (const file of files) {
      const src = read(file) ?? ''
      for (const what of syntaxFindings(file, src, browser?.has(file) ?? true)) found.push(`${file}: ${what}`)
      if (!file.endsWith('.tsx')) continue
      for (const line of src.split('\n')) {
        if (/^\s*(?:\/\/|\/?\*|\{\/\*)/.test(line)) continue
        for (const [what, re] of BLOCKED_BY_POLICY) {
          if (re.test(line)) found.push(`${file}: ${what}`)
        }
      }
    }
    return found.sort()
  }

  // Not reached by the import walk, which stops at a package name.
  function webUiFiles(): string[] {
    return readdirSync('packages/web-ui/src', { recursive: true, encoding: 'utf8' })
      .map((rel) => path.posix.join('packages/web-ui/src', rel.split(path.sep).join('/')))
      .filter((rel) => /\.tsx?$/.test(rel) && !/\.(?:test|stories)\.tsx?$/.test(rel))
  }

  // Walks every page's closure, as test/tenant-tree-no-analytics.test.ts does. What a file
  // in node_modules does is not walked: test below reads Clerk's list for what Clerk needs.
  it('is only what lib/csp.ts lists', () => {
    const closure = [...importClosureOf(treeFiles(), readRepoFile), ...webUiFiles()]
    const clientEntries = closure.filter((file) => /^\s*['"]use client['"]/m.test(readRepoFile(file) ?? ''))
    const browser = importClosureOf(clientEntries, readRepoFile)
    expect(browser.size).toBeGreaterThan(0)
    expect(scan(closure, readRepoFile, browser)).toEqual([
      // The QR code: a data: URL from the encoder. See below.
      'app/(stellr)/(flow)/check-in/[slug]/code/page.tsx: an image from a value',
      // /api/register/pay, or /api/register/pay-seat from its one other caller.
      'app/(stellr)/(flow)/register/[slug]/pay/[token]/PayNowButton.tsx: a call to a host from a value',
      // /api/sign/document, from its one caller.
      'components/esign/PdfViewer.tsx: a call to a host from a value',
      // Its own post() helper, whose callers each pass an /api/sign/ path.
      'components/esign/SigningApp.tsx: a call to a host from a value',
      // Its text version: srcdoc inherits this policy, and frame-src does not govern it.
      // It has sandbox="", so nothing in it runs. The browser test opens it.
      'components/esign/SigningApp.tsx: a frame',
      // apiBase, which the survey page sets to /api/survey/<token>.
      'components/survey/SurveyApp.tsx: a call to a host from a value',
      'components/survey/SurveyApp.tsx: a call to a host from a value',
      'components/survey/SurveyLoader.tsx: a call to a host from a value',
    ])
  }, 60_000)

  it('keeps that one frame sandboxed', () => {
    const src = readFileSync('components/esign/SigningApp.tsx', 'utf8')
    expect(src.match(/<iframe\b[^>]*>/g)).toEqual([expect.stringMatching(/\bsandbox=""[^>]*\bsrcDoc=/)])
  })

  it('has no QR code or image the policy would stop', () => {
    // A data: URL from the encoder, which img-src allows.
    const src = readFileSync('app/(stellr)/(flow)/check-in/[slug]/code/page.tsx', 'utf8')
    expect(src).toContain('src={qr}')
    expect(src).toContain('data:')
    expect(directive(tenantPagePolicy('abc', ENV), 'img-src')).toContain('data:')
  })

  describe('the check itself', () => {
    it.each([
      ['<script>x()</script>', 'an inline or un-nonced script'],
      ["import Script from 'next/script'", 'an inline or un-nonced script'],
      ['<div dangerouslySetInnerHTML={{ __html: x }} />', 'injected HTML'],
      ['<a href="javascript:x()">', 'an inline handler or javascript: URL'],
      ['new Function(x)', 'eval'],
      ['<object data={x} />', 'a plugin'],
      ['<iframe src={x} />', 'a frame'],
      ['<form action="https://x.example">', 'a form that posts elsewhere'],
      ['<img src="https://x.example/a.gif" />', 'an image from another host'],
      ["fetch('https://x.example')", 'a call to another host'],
      ["import { x } from '@/lib/supabase-browser'", 'the browser Supabase client'],
      ["document.createElement('script')", 'an inline or un-nonced script'],
      ['<img\n  alt=""\n  src="https://x.example/a.gif"\n/>', 'an image from another host'],
      ['<img src={String(slug)} />', 'an image from a value'],
      ['<img src={url} />', 'an image from a value'],
      ['<form\n  method="post"\n  action="https://x.example"\n/>', 'a form that posts elsewhere'],
      ['<div style={{ backgroundImage: "url(https://x.example/a.png)" }} />', 'an image from another host'],
      ['fetch(String(process.env.NEXT_PUBLIC_MEDIA_BASE_URL))', 'a call to a host from a value'],
      ['fetch(`${base}/x`)', 'a call to a host from a value'],
      ['navigator.sendBeacon("https://x.example")', 'a call to another host'],
      ['new WebSocket("wss://x.example")', 'a call to another host'],
    ])('fires on %s', (line, what) => {
      expect(scan(['a.tsx'], () => line)).toEqual([`a.tsx: ${what}`])
    })

    it.each([
      ["document.createElement('script')", 'an inline or un-nonced script'],
      ["document.createElement(\n  'script',\n)", 'an inline or un-nonced script'],
      ["await import('https://x.example/a.js')", 'an inline or un-nonced script'],
      ["document.write('x')", 'an inline or un-nonced script'],
      ["fetch('https://x.example')", 'a call to another host'],
    ])('fires on %s in a .ts file', (line, what) => {
      expect(scan(['a.ts'], () => line)).toEqual([`a.ts: ${what}`])
    })

    it('leaves email HTML in a .ts file alone, and a server’s call', () => {
      expect(scan(['a.ts'], () => "const html = '<img src=\"https://x.example\"><script>'\nfetch('https://x.example')", new Set())).toEqual([])
    })

    it('leaves a comment alone, a same-origin call, and an image from this origin or data:', () => {
      expect(scan(['a.tsx'], () => "// <script>\nfetch('/api/sign/context')\nfetch(`/api/sign/${x}`)\n<img src=\"/a.png\" />\n<img src={`data:image/png;base64,${x}`} />")).toEqual([])
    })
  })

  it('renders every page per request, so each can hold a nonce', () => {
    const layout = readFileSync(`${TREE}/[tenant]/layout.tsx`, 'utf8')
    expect(layout).toMatch(/^export const dynamic = 'force-dynamic'$/m)
    // A page can opt back in to caching only by naming it, and none may.
    for (const file of treeFiles()) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/export const (?:revalidate|generateStaticParams|dynamic = '(?:force-static|error)')|export (?:async )?function generateStaticParams/)
    }
  })
})
