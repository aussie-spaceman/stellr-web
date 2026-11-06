// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server'
import { describe, expect, it } from 'vitest'
import { config as proxyConfig } from '@/proxy'
import { ROUTE_MANIFEST, type RouteClass } from '@/lib/security/route-manifest'
import {
  TENANT_HOST_ROBOTS_TXT,
  TENANT_SURFACE_ALLOW,
  TENANT_SURFACE_BYPASS,
  TENANT_SURFACE_DENY,
  TENANT_SURFACE_DENY_FALLBACK,
  TENANT_SURFACE_PENDING,
  allowedTenantFiles,
  classifyTenantSurface,
  isAllowedOnTenantHost,
  tenantHostRoute,
  tenantSurfaceDecision,
  tenantSurfaceMatches,
  urlPatternForFile,
  type TenantSurfaceDecision,
} from '@/lib/tenancy/tenant-surface'

// S5 (multi-tenant plan), slice B2: the tenant-host route allow-list as data.
// proxy.ts consults it from slice B5 (test/proxy-tenant-routing.test.ts). This test pins
//   1. the manifest it classifies (493 entries, by class, as measured);
//   2. that every manifest entry has exactly one decision, and no rule is stale;
//   3. the SMMA rule: no community, home, store or academy route is allowed on
//      a tenant host, and neither is admin, cron or a webhook;
//   4. that isAllowedOnTenantHost() admits only the URLs of allowed files.
// These prove route reachability only. What an allowed page renders, and whether
// a handler checks the resource's tenant, are for the import-closure lint (B8)
// and the cross-tenant ratchet.

const FILES = Object.keys(ROUTE_MANIFEST)
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

// The manifest as measured on 4 Nov 2026 (dev 37cd2f7b), plus the 2 tenant tree
// pages from B5 and the 16 from B5b. A new route changes these numbers, and that
// change must come with its tenant-host decision.
const MANIFEST_CLASS_COUNTS: Record<RouteClass, number> = {
  platform_admin: 0,
  tenant_staff: 0,
  participant: 126,
  public: 129,
  webhook: 12,
  cron: 23,
  stellr_only: 203,
}
const MANIFEST_TOTAL = 493

// The decisions. Moving a route between them is a deliberate diff here.
const DECISION_COUNTS: Record<TenantSurfaceDecision, number> = {
  allow: 49,
  // members 32, schools 2, privacy request pages 2 and APIs 2, and the 4 held
  // files pinned under 'routes held back' below
  pending: 42,
  bypass: 4,
  deny: 398,
}

/** A concrete URL a manifest file serves, with sample values for its params. */
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

describe('the manifest this classifies', () => {
  it('has the measured class counts, 493 in total', () => {
    expect(FILES).toHaveLength(MANIFEST_TOTAL)
    const counts = Object.fromEntries(Object.keys(MANIFEST_CLASS_COUNTS).map((c) => [c, 0])) as Record<
      RouteClass,
      number
    >
    for (const cls of Object.values(ROUTE_MANIFEST)) counts[cls] += 1
    expect(counts).toEqual(MANIFEST_CLASS_COUNTS)
  })
})

describe('every manifest entry has one tenant-host decision', () => {
  it('classifies every entry', () => {
    const unclassified = FILES.filter((f) => classifyTenantSurface(f) === null)
    expect(unclassified).toEqual([])
  })

  it('matches at most one explicit rule per entry', () => {
    const overlaps = FILES.map((f) => ({ f, n: tenantSurfaceMatches(f).length })).filter((x) => x.n > 1)
    expect(overlaps).toEqual([])
  })

  it('pins the decision counts', () => {
    const counts: Record<TenantSurfaceDecision, number> = { allow: 0, pending: 0, bypass: 0, deny: 0 }
    for (const f of FILES) counts[tenantSurfaceDecision(f) as TenantSurfaceDecision] += 1
    expect(counts).toEqual(DECISION_COUNTS)
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(MANIFEST_TOTAL)
  })

  it('has no stale rule: every rule matches a manifest entry', () => {
    const rules = [
      ...TENANT_SURFACE_ALLOW,
      ...TENANT_SURFACE_PENDING,
      ...TENANT_SURFACE_BYPASS,
      ...TENANT_SURFACE_DENY,
      TENANT_SURFACE_DENY_FALLBACK,
    ]
    const stale = rules
      .filter((r) => !FILES.some((f) => (r.match.endsWith('/') ? f.startsWith(r.match) : f === r.match)))
      .map((r) => r.match)
    expect(stale).toEqual([])
  })

  it('gives every rule a reason', () => {
    for (const r of [
      ...TENANT_SURFACE_ALLOW,
      ...TENANT_SURFACE_PENDING,
      ...TENANT_SURFACE_BYPASS,
      ...TENANT_SURFACE_DENY,
      TENANT_SURFACE_DENY_FALLBACK,
    ]) {
      expect(r.reason.trim().length, r.match).toBeGreaterThan(5)
    }
  })

  it('allows only by exact file, never by directory prefix', () => {
    expect(TENANT_SURFACE_ALLOW.filter((r) => r.match.endsWith('/'))).toEqual([])
    expect(new Set(TENANT_SURFACE_ALLOW.map((r) => r.match)).size).toBe(TENANT_SURFACE_ALLOW.length)
  })
})

describe('SMMA and the Stellr-only surface', () => {
  const allowed = allowedTenantFiles()

  it('allows no community, home, store or academy route on a tenant host', () => {
    const smma = FILES.filter((f) =>
      /^app\/(?:\(member\)\/community\/|api\/community\/|\(member\)\/home\/|\(public\)\/store\/|api\/store\/|\(public\)\/academy\/)/.test(
        f,
      ),
    )
    // 39 community pages + 40 community APIs + home + 4 store pages + 3 store APIs + 2 academy pages.
    expect(smma).toHaveLength(89)
    for (const f of smma) expect(tenantSurfaceDecision(f), f).toBe('deny')
    expect(allowed.filter((f) => /community|\/home\/|\/store\/|academy/.test(f))).toEqual([])
  })

  it('denies all 80 community and home entries', () => {
    const community = FILES.filter((f) =>
      /^app\/(?:\(member\)\/community\/|api\/community\/|\(member\)\/home\/)/.test(f),
    )
    expect(community).toHaveLength(80)
    for (const f of community) expect(tenantSurfaceDecision(f), f).toBe('deny')
  })

  it('denies every admin page, admin API, cron and webhook', () => {
    const mustDeny = FILES.filter(
      (f) =>
        f.startsWith('app/(admin)/') ||
        f.startsWith('app/api/admin/') ||
        ROUTE_MANIFEST[f] === 'cron' ||
        ROUTE_MANIFEST[f] === 'webhook' ||
        ROUTE_MANIFEST[f] === 'stellr_only',
    )
    expect(mustDeny.length).toBeGreaterThan(230)
    for (const f of mustDeny) expect(tenantSurfaceDecision(f), f).toBe('deny')
  })

  it('allows only participant or public routes', () => {
    for (const f of allowed) expect(['participant', 'public'], f).toContain(ROUTE_MANIFEST[f])
  })

  it('answers robots.txt on a tenant host with disallow-all', () => {
    expect(tenantSurfaceDecision('app/robots.ts')).toBe('deny')
    expect(TENANT_HOST_ROBOTS_TXT).toMatch(/^User-agent: \*\nDisallow: \/\n$/)
    expect(isAllowedOnTenantHost('/robots.txt')).toBe(false)
  })
})

describe('routes held back from allow', () => {
  // Each passes the path and route-class checks, so only a reading of the
  // handler or page shows why it is not ready. Pinned so none drifts back.
  it.each([
    ['app/api/registrations/[id]/spreadsheet/route.ts', /anyone-can-edit/],
    ['app/api/uploads/sign/route.ts', /per-purpose/],
    ['app/(member)/account/page.tsx', /community directory/],
    ['app/api/consent/request/route.ts', /membership consent/],
  ])('keeps %s pending, with the reason', (file, reason) => {
    const match = classifyTenantSurface(file)
    expect(match?.decision).toBe('pending')
    expect(match?.rule.reason).toMatch(reason)
  })

  it('finds no direct community import or public Drive link in an allowed file', () => {
    // Direct imports only: B8 walks the full import closure.
    const offenders = allowedTenantFiles().filter((f) =>
      /@\/components\/community|@\/app\/\(member\)\/community|type:\s*'anyone'/.test(
        readFileSync(`${REPO_ROOT}${f}`, 'utf8'),
      ),
    )
    expect(offenders).toEqual([])
  })
})

describe('proxy-bypass routes', () => {
  const proxyMatchesOn = (host: string, url: string) =>
    unstable_doesMiddlewareMatch({ config: proxyConfig, url: `https://${host}${url}`, headers: { host } })
  const proxyMatches = (url: string) => proxyMatchesOn('www.stellreducation.org', url)

  it('lists exactly the manifest routes whose URL the proxy matcher skips, each with a reason', () => {
    const skipped = FILES.filter((f) => !proxyMatches(sampleUrl(f))).sort()
    expect(skipped).toEqual(TENANT_SURFACE_BYPASS.map((r) => r.match).sort())
    expect(skipped).toEqual([
      'app/api/csp-report/route.ts',
      'app/api/img/route.ts',
      'app/app.webmanifest/route.ts',
      'app/manifest.ts',
    ])
  })

  // Matcher behaviour on Stellr hosts is unchanged by tenant routing. Every other
  // host has the entry keyed on the host (B5), and the allow-list then denies these.
  it.each(['/events/nevada.html', '/join/x.png', '/studio/a.js'])('leaves the matcher on a Stellr host unchanged for %s', (url) => {
    expect(proxyMatches(url)).toBe(false)
  })

  it.each([
    '/community/x.png',
    '/community/x.png/members',
    '/admin/competitions/x.png/check-in',
    '/events/nevada.html',
    '/join/x.png',
    '/studio/a.js',
  ])('reaches the proxy on a tenant host for %s, which denies it', (url) => {
    expect(proxyMatchesOn('canary-academy.localhost', url)).toBe(true)
    expect(tenantHostRoute(url)).toBe('denied')
  })

  it('takes a dot in an allowed route\'s param into the tenant tree, on a tenant host', () => {
    expect(proxyMatchesOn('canary-academy.localhost', '/credentials/a.png')).toBe(true)
    expect(tenantHostRoute('/credentials/a.png')).toBe('page')
  })

  it('keeps API URLs in the proxy even with a listed extension', () => {
    expect(proxyMatches('/api/community/x.png')).toBe(true)
    expect(proxyMatches('/api/admin/x.png/members')).toBe(true)
  })
})

describe('isAllowedOnTenantHost', () => {
  it.each([
    '/register/nevada-sdc',
    '/register/nevada-sdc/individual',
    '/register/nevada-sdc/pay/tok_1',
    '/register/nevada-sdc/join/tok_1/',
    '/check-in',
    '/check-in/nevada-sdc/code',
    '/sign',
    '/sign/copy',
    '/survey/tok_1',
    '/survey/event/nevada-sdc',
    '/team-profile/tok_1',
    '/sign-in',
    '/sign-in/factor-one',
    '/sign-up/verify-email-address',
    '/credentials/SC-0001',
    '/credentials/SC-0001/badge',
    '/credentials/SC-0001/opengraph-image',
    '/credentials/SC-0001/opengraph-image-abc123',
    '/privacy',
    '/terms',
    '/account/onboarding',
    '/api/register/individual',
    '/api/sign/submit',
    '/api/survey/tok_1/submit',
    '/api/check-in',
    '/api/check-in-desk/manifest',
    '/api/email/unsubscribe',
    '/api/credentials/SC-0001/pdf',
  ])('allows %s', (path) => {
    expect(isAllowedOnTenantHost(path)).toBe(true)
  })

  it.each([
    '/',
    '/events',
    '/events/nevada-sdc',
    '/community',
    '/community/events',
    '/community/some-space/members',
    '/home',
    '/store',
    '/store/cart',
    '/academy',
    '/join',
    '/campaigns',
    '/admin',
    '/admin/members',
    '/studio',
    '/studio/desk',
    '/api/admin/members',
    '/api/community/posts',
    '/api/cron/surveys',
    '/api/webhooks/clerk',
    '/api/stripe/webhook',
    '/api/members/me',
    '/api/schools/search',
    '/privacy/request',
    '/sitemap.xml',
    '/llms.txt',
    '/robots.txt',
    '/_t/canary/register/nevada-sdc',
    '/_t',
    '/%5Ft/canary/register/x',
    '/%5ft/canary/register/x',
    '/register/x/../../admin',
    '/register/./x',
    '/register//x',
    '/register/x%2f..%2fadmin',
    '/register/x?y=1',
    '/register\\x',
    'register/x',
    '',
    // Held back: pending, so refused.
    '/account',
    '/api/uploads/sign',
    '/api/consent/request',
    '/api/registrations/x1/spreadsheet',
    // The catch-all matches any segments, so only the guards refuse these.
    '/sign-in/../admin',
    '/sign-in/./x',
    '/sign-in/%2e%2e/admin',
    '/sign-in/%2E%2E/admin',
    '/sign-in/x%2fadmin',
    '/sign-in/x%5cadmin',
    '/sign-in/x\\y',
    '/sign-in/x#y',
    '/sign-in/x?y=1',
  ])('refuses %s', (path) => {
    expect(isAllowedOnTenantHost(path)).toBe(false)
  })

  it('admits the sample URL of every allowed file', () => {
    for (const f of allowedTenantFiles()) expect(isAllowedOnTenantHost(sampleUrl(f)), f).toBe(true)
  })

  it('refuses the sample URL of every file that is not allowed', () => {
    const leaks = FILES.filter((f) => tenantSurfaceDecision(f) !== 'allow').filter((f) =>
      isAllowedOnTenantHost(sampleUrl(f)),
    )
    expect(leaks).toEqual([])
  })

  it('builds URL patterns for route groups and catch-alls', () => {
    expect(urlPatternForFile('app/(auth)/sign-in/[[...sign-in]]/page.tsx')).toBe('^/sign-in(?:/[^/]+)*$')
    expect(urlPatternForFile('app/(flow)/register/[slug]/page.tsx')).toBe('^/register/[^/]+$')
    expect(urlPatternForFile('app/api/community/media/[...path]/route.ts')).toBe(
      '^/api/community/media(?:/[^/]+)+$',
    )
    expect(urlPatternForFile('app/(public)/page.tsx')).toBe('^/$')
    expect(() => urlPatternForFile('app/robots.ts')).toThrow()
  })
})
