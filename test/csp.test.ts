// @vitest-environment node
import { createHash } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, type NextFetchEvent } from 'next/server'
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server'

// S1: Content-Security-Policy in Report-Only mode (lib/csp.ts, set by proxy.ts),
// HSTS (next.config.mjs), and the report endpoint (app/api/csp-report).

const state = vi.hoisted(() => ({ userId: 'user_1' as string | null }))

vi.mock('@clerk/nextjs/server', () => {
  const toRegex = (p: string) =>
    new RegExp('^' + p.replace(/:[a-z]+/gi, '[^/]+').replace(/\(\.\*\)/g, '.*') + '$')
  return {
    createRouteMatcher: (patterns: string[]) => (req: Request) =>
      patterns.some((p) => toRegex(p).test(new URL(req.url).pathname)),
    clerkMiddleware: (
      handler: (auth: unknown, req: NextRequest, event: NextFetchEvent) => Promise<Response | undefined>,
    ) => (req: NextRequest, event: NextFetchEvent) => {
      const auth = Object.assign(async () => ({ userId: state.userId, sessionClaims: { metadata: { role: 'admin' } } }), {
        protect: async () => {},
      })
      return handler(auth, req, event)
    },
  }
})
vi.mock('@/lib/env', () => ({ APP_HOST: 'localhost:3000', SITE_URL: 'http://localhost:3000' }))
vi.mock('@/lib/crawlers', () => ({ matchCrawler: () => null, recordCrawlerHit: async () => {} }))

import proxy, { config } from '@/proxy'
import nextConfig, { STRICT_TRANSPORT_SECURITY } from '../next.config.mjs'
import { ConsentMode } from '@/components/analytics/ConsentMode'
import { CSP_HEADER, clerkFrontendApi, consentModeHash, hostPolicy, noncePolicy, usesNonce } from '@/lib/csp'
import { MAX_REPORT_BYTES, formatViolation, parseCspReports, scrubUrl } from '@/lib/csp-report'
import { POST } from '@/app/api/csp-report/route'

const event = { waitUntil: () => {} } as unknown as NextFetchEvent
const hit = (path: string, headers: Record<string, string> = {}) =>
  proxy(new NextRequest(`http://localhost:3000${path}`, { headers: { host: 'localhost:3000', ...headers } }), event)

const nonceOf = (policy: string | null) => /'nonce-([^']+)'/.exec(policy ?? '')?.[1] ?? null
// NextResponse.next({ request: { headers } }) hands Next the request headers this way.
const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`)

beforeEach(() => {
  state.userId = 'user_1'
})

describe('Report-Only CSP from proxy.ts', () => {
  it('is on pages and API responses, and never as the enforcing header', async () => {
    for (const path of ['/', '/about', '/events/x', '/account', '/admin/members', '/register/x/group', '/api/register/group', '/api/check-in']) {
      const res = await hit(path)
      expect(res.headers.get(CSP_HEADER), path).toMatch(/report-uri \/api\/csp-report; report-to csp-endpoint/)
      expect(res.headers.get('content-security-policy'), path).toBeNull()
      expect(res.headers.get('reporting-endpoints'), path).toBe('csp-endpoint="http://localhost:3000/api/csp-report"')
    }
  })

  it('gives per-request routes a fresh nonce each time', async () => {
    const a = nonceOf((await hit('/account')).headers.get(CSP_HEADER))
    const b = nonceOf((await hit('/account')).headers.get(CSP_HEADER))
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/)
    expect(b).toMatch(/^[A-Za-z0-9+/]{22}==$/)
    expect(a).not.toBe(b)
  })

  it('hands Next the same nonce on the request headers, so it reaches the inline scripts', async () => {
    const res = await hit('/register/x/group')
    const sent = res.headers.get(CSP_HEADER)
    expect(forwarded(res, 'content-security-policy-report-only')).toBe(sent)
    expect(nonceOf(sent)).toBeTruthy()
  })

  it('hands the layouts the nonce as x-nonce, for clerk-js', async () => {
    state.userId = null // a signed-in visitor is sent on from /sign-in
    const res = await hit('/sign-in')
    expect(forwarded(res, 'x-nonce')).toBe(nonceOf(res.headers.get(CSP_HEADER)))
    expect(forwarded(res, 'x-nonce')).toBeTruthy()
  })

  it('drops an x-nonce the client sent, on every route', async () => {
    const own = await hit('/account', { 'x-nonce': 'chosen' })
    expect(forwarded(own, 'x-nonce')).toBe(nonceOf(own.headers.get(CSP_HEADER)))
    const pub = await hit('/grant', { 'x-nonce': 'chosen' })
    expect(forwarded(pub, 'x-nonce')).toBeNull()
  })

  it('ignores a policy the client sent, so a visitor cannot pick the nonce', async () => {
    const res = await hit('/account', { 'content-security-policy-report-only': "script-src 'nonce-chosen'" })
    expect(forwarded(res, 'content-security-policy-report-only')).not.toContain('chosen')
    const pub = await hit('/grant', { 'content-security-policy': "script-src 'nonce-chosen'" })
    expect(forwarded(pub, 'content-security-policy')).toBeNull()
  })

  it('gives prerendered public pages the host policy, with no nonce', async () => {
    for (const path of ['/', '/about', '/grant']) {
      const policy = (await hit(path)).headers.get(CSP_HEADER)
      expect(nonceOf(policy), path).toBeNull()
      expect(policy).toContain("script-src 'self' 'unsafe-inline'")
    }
  })

  it('does not run the proxy for the report endpoint', () => {
    expect(unstable_doesMiddlewareMatch({ config, url: '/api/csp-report' })).toBe(false)
    expect(unstable_doesMiddlewareMatch({ config, url: '/api/csp-reports-other' })).toBe(true)
  })
})

describe('lib/csp policies', () => {
  const env = {
    NODE_ENV: 'production',
    NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
    NEXT_PUBLIC_MEDIA_BASE_URL: 'https://media.test/media',
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_live_${Buffer.from('clerk.example.org$').toString('base64')}`,
    NEXT_PUBLIC_SANITY_PROJECT_ID: 'proj1',
  }

  it('nonce policy: nonce, strict-dynamic, the ConsentMode hash, no eval in production', () => {
    const p = noncePolicy('abc', env)
    expect(p).toMatch(/^script-src 'nonce-abc' 'strict-dynamic' 'sha256-[A-Za-z0-9+/=]+' 'wasm-unsafe-eval' https: 'unsafe-inline';/)
    expect(p).not.toContain("'unsafe-eval'")
  })

  it('covers Supabase (https and wss), media, Clerk, Turnstile, Sanity and the tag hosts', () => {
    const p = hostPolicy(env)
    expect(p).toContain('https://abc.supabase.co wss://abc.supabase.co')
    expect(p).toContain('media-src \'self\' blob: https://media.test https://abc.supabase.co')
    expect(p).toContain('https://clerk.example.org')
    expect(p).toContain('https://challenges.cloudflare.com')
    expect(p).toContain('wss://proj1.api.sanity.io')
    expect(p).toContain('https://www.googletagmanager.com')
    expect(p).toContain('https://js.hs-scripts.com')
    expect(p).toContain('https://8x8.vc https://meet.jit.si')
    expect(p).toContain("object-src 'none'")
    expect(p).toContain("frame-ancestors 'self'")
  })

  it('names the hosts of the ad tags live in GTM (Meta, LinkedIn, Apollo; docs/RUNBOOK-no-ads-students.md)', () => {
    const p = hostPolicy(env)
    const directive = (name: string) => p.split('; ').find((d) => d.startsWith(`${name} `)) ?? ''
    for (const host of ['https://connect.facebook.net', 'https://snap.licdn.com', 'https://assets.apollo.io']) {
      expect(directive('script-src'), host).toContain(host)
    }
    for (const host of ['https://www.facebook.com', 'https://connect.facebook.net', 'https://px.ads.linkedin.com', 'https://*.apollo.io']) {
      expect(directive('connect-src'), host).toContain(host)
    }
  })

  it('falls back to the Clerk development host when the key is missing or odd', () => {
    expect(clerkFrontendApi(undefined)).toBe('https://*.clerk.accounts.dev')
    expect(clerkFrontendApi(`pk_test_${Buffer.from('bad host$').toString('base64')}`)).toBe('https://*.clerk.accounts.dev')
  })

  it('the ConsentMode hash matches the script the root layout renders', () => {
    const html = renderToStaticMarkup(ConsentMode())
    const inner = /^<script>([\s\S]*)<\/script>$/.exec(html)?.[1] ?? ''
    expect(inner.length).toBeGreaterThan(100)
    expect(consentModeHash()).toBe(`'sha256-${createHash('sha256').update(inner, 'utf8').digest('base64')}'`)
  })

  it('every per-request route group is on the nonce list, and no public page is', () => {
    const top = (group: string) =>
      readdirSync(`app/(stellr)/${group}`, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => `/${d.name}`)
    for (const group of ['(admin)', '(member)', '(auth)', '(flow)']) {
      for (const path of top(group)) expect(usesNonce(path), path).toBe(true)
    }
    for (const path of top('(public)')) expect(usesNonce(path), path).toBe(false)
    expect(usesNonce('/api/anything')).toBe(true)
    expect(usesNonce('/studio')).toBe(false)
    expect(usesNonce('/signage')).toBe(false)
  })
})

describe('HSTS (next.config.mjs)', () => {
  it('is one year with subdomains on every path, no preload', async () => {
    expect(STRICT_TRANSPORT_SECURITY).toBe('max-age=31536000; includeSubDomains')
    const rules = (await nextConfig.headers!()) as { source: string; headers: { key: string; value: string }[] }[]
    const base = rules.find((r) => r.source === '/:path*' && r.headers.some((h) => h.key === 'Strict-Transport-Security'))
    expect(base?.headers.find((h) => h.key === 'Strict-Transport-Security')?.value).toBe(STRICT_TRANSPORT_SECURITY)
    // No later rule overrides it.
    expect(rules.filter((r) => r.headers.some((h) => h.key === 'Strict-Transport-Security'))).toHaveLength(1)
  })
})

describe('report parsing (lib/csp-report)', () => {
  it('reads the report-uri shape and strips queries, referrer, samples and private paths', () => {
    const [v] = parseCspReports({
      'csp-report': {
        'document-uri': 'https://www.stellreducation.org/register/nv/pay/tok123?email=a@b.c',
        referrer: 'https://mail.example/inbox?id=1',
        'violated-directive': 'script-src-elem',
        'effective-directive': 'script-src-elem',
        'blocked-uri': 'https://evil.example/x.js?uid=42#frag',
        'source-file': 'https://www.stellreducation.org/_next/static/a.js?v=1',
        'line-number': 12,
        'script-sample': 'alert("secret")',
        disposition: 'report',
      },
    })
    const line = formatViolation(v)
    expect(line).toBe(
      '[csp] report script-src-elem blocked=https://evil.example/x.js doc=https://www.stellreducation.org/[private] src=https://www.stellreducation.org/_next/static/a.js:12',
    )
    expect(line).not.toMatch(/tok123|email|uid|secret|mail\.example/)
  })

  it('reads the Reporting API shape and skips other report types', () => {
    const vs = parseCspReports([
      { type: 'csp-violation', url: 'https://x', body: { documentURL: 'https://app.test/home?x=1', blockedURL: 'inline', effectiveDirective: 'script-src-elem', disposition: 'report', sample: 'x' } },
      { type: 'deprecation', body: { message: 'm' } },
    ])
    expect(vs).toEqual([{ directive: 'script-src-elem', blocked: 'inline', document: 'https://app.test/home', source: '', disposition: 'report' }])
  })

  it('returns nothing for junk', () => {
    expect(parseCspReports(null)).toEqual([])
    expect(parseCspReports({ foo: 1 })).toEqual([])
    expect(parseCspReports('x')).toEqual([])
    expect(scrubUrl('data:text/html,hi')).toBe('data')
  })
})

describe('/api/csp-report', () => {
  let n = 0
  const post = (body: string, type = 'application/csp-report', ip = `10.0.0.${++n}`) =>
    POST(new Request('https://www.test/api/csp-report', { method: 'POST', headers: { 'content-type': type, 'x-forwarded-for': ip }, body }))
  const legacy = JSON.stringify({ 'csp-report': { 'document-uri': 'https://www.test/', 'blocked-uri': 'inline', 'effective-directive': 'script-src-elem' } })

  it('logs one compact line per violation and answers 204', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await post(legacy)
    expect(res.status).toBe(204)
    expect(warn).toHaveBeenCalledWith('[csp] report script-src-elem blocked=inline doc=https://www.test/')
    warn.mockRestore()
  })

  it('accepts the Reporting API content type', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await post(JSON.stringify([{ type: 'csp-violation', body: { documentURL: 'https://www.test/', blockedURL: 'eval', effectiveDirective: 'script-src' } }]), 'application/reports+json')
    expect(res.status).toBe(204)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('drops anything over 16 KB, other content types and bad JSON', async () => {
    const big = JSON.stringify({ 'csp-report': { pad: 'x'.repeat(MAX_REPORT_BYTES) } })
    expect((await post(big)).status).toBe(413)
    expect((await post(legacy, 'text/plain')).status).toBe(415)
    expect((await post('{not json')).status).toBe(400)
  })

  it('rate-limits each IP to 30 a minute', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const statuses: number[] = []
    for (let i = 0; i < 31; i++) statuses.push((await post(legacy, 'application/csp-report', '192.0.2.77')).status)
    expect(statuses.slice(0, 30).every((s) => s === 204)).toBe(true)
    expect(statuses[30]).toBe(429)
    expect((await post(legacy, 'application/csp-report', '192.0.2.78')).status).toBe(204)
    warn.mockRestore()
  })
})
