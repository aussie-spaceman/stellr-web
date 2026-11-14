import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server'
import { APP_HOST, SITE_URL } from '@/lib/env'
import { STRICT_REGION_COOKIE, isStrictRegion } from '@/lib/consent'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'
import { matchCrawler, recordCrawlerHit } from '@/lib/crawlers'
import { PRIVATE_ROUTE_HEADER, isPrivatePath } from '@/lib/private-routes'
import { IMPERSONATION_COOKIE } from '@/lib/impersonation-cookie'
import { authPath } from '@/lib/auth-path'
import { safeNext } from '@/lib/safe-next'
import { isStaffHiddenAdminPath, portalRoleFromClaims } from '@/lib/authz/decide'
import { CSP_HEADER, ENFORCING_CSP_HEADER, NONCE_HEADER, applyCsp, applyEnforcingCsp, createNonce, cspFor, tenantApiPolicy, tenantPagePolicy } from '@/lib/csp'
import {
  TENANT_ID_HEADER,
  TENANT_ROUTING_FLAG,
  TENANT_SLUG_HEADER,
  resolveTenantHost,
  type TenantHostResolution,
} from '@/lib/tenancy/host'
import { TENANT_HOST_ROBOTS_TXT, isInternalTenantTreePath, tenantHostRoute } from '@/lib/tenancy/tenant-surface'

const isProtectedRoute = createRouteMatcher(['/account(.*)', '/admin(.*)'])
const isAdminRoute = createRouteMatcher(['/admin(.*)'])
// Competitions admin (formerly /admin/events — the old path 307s in next.config).
const isAdminEventsRoute = createRouteMatcher(['/admin/competitions(.*)', '/admin/events(.*)'])
// Member-only app surfaces that require a signed-in user (Home dashboard + the
// community portal). Unauthenticated hits are bounced to sign-in, whose card
// links on to sign-up: anyone can create an account (decision 24).
const isCommunityRoute = createRouteMatcher(['/community(.*)', '/home(.*)'])
// Community pages meant for people who are new to Stellr (the /academy
// "Book a mentoring session" CTA deep-links here). Guests go straight to
// sign-up, whose card links back to sign-in.
const isNewMemberRoute = createRouteMatcher(['/community/mentoring/discover'])
const isAuthRoute = createRouteMatcher(['/sign-in(.*)', '/sign-up(.*)'])

// Pages that live on www only — redirect away from app subdomain
const isPublicOnlyRoute = createRouteMatcher([
  '/about(.*)',
  '/contact(.*)',
  '/donate(.*)',
  '/events(.*)',
  '/membership(.*)',
  '/news(.*)',
  '/why-stellr(.*)',
  '/register(.*)',
  '/privacy(.*)',
  // The credential URL on a LinkedIn profile must be the www one, always.
  '/credentials(.*)',
])
// Public credential pages: unauthenticated, keyed by a number. Numbers are
// unguessable and pages default to private, so enumeration yields nothing —
// but it should not be free either. Same per-instance limiter as the forms.
const isCredentialRoute = createRouteMatcher(['/credentials/(.*)'])

const WWW = SITE_URL

// Production splits the site across two hostnames — www for the public site,
// app for the member portal — and everything below keys off which one served
// the request.
//
// A dev or preview deployment has only ONE hostname, so both variables point at
// it. Without this check that single host matches APP_HOST, every request is
// treated as the member app, and the public-only redirect below sends /about to
// WWW/about — the same URL — which loops until the browser gives up. Observed on
// the dev deployment on 10 Sept.
//
// Production is unaffected: its two hosts differ, so this is false there.
const IS_SINGLE_HOST = APP_HOST === new URL(WWW).host

// Marketing pages on www that never read a session: no auth(), no Clerk
// components. Clerk's middleware is skipped for them, so a signed-in visitor
// browsing them doesn't pay for Clerk's session check or "handshake" redirect,
// and the pages stay plain cacheable documents. Everything else — the app
// host, the API, sign-in, the member area, registration and every private
// link — goes through Clerk as before. A page added here must not call auth().
// (/grant is left out on purpose: it pre-fills the application from the
// signed-in teacher's full record, which is read on the server.)
const isMarketingRoute = createRouteMatcher([
  '/',
  '/about',
  '/academy',
  '/competitions',
  '/contact',
  '/curriculum(.*)',
  '/donate',
  '/educate',
  '/educators',
  '/events',
  '/events/:slug',
  '/guides/(.*)',
  '/host-an-event',
  '/impact',
  '/lp/(.*)',
  '/membership',
  '/mentors',
  '/network',
  '/news',
  '/news/:slug',
  '/privacy',
  '/scholarship',
  '/school-data-terms',
  '/students',
  '/terms',
  '/volunteer',
  '/why-stellr',
])

/** Tell browser code whether this visitor is in a strict-consent region (see lib/consent). */
function withRegionCookie(req: NextRequest, res: Response): Response {
  const strict = isStrictRegion(req.headers.get('x-vercel-ip-country'))
  const current = req.cookies.get(STRICT_REGION_COOKIE)?.value
  if (strict && current !== '1') {
    res.headers.append('Set-Cookie', `${STRICT_REGION_COOKIE}=1; Path=/; Max-Age=2592000; SameSite=Lax; Secure`)
  } else if (!strict && current) {
    res.headers.append('Set-Cookie', `${STRICT_REGION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure`)
  }
  return res
}

/**
 * NextResponse init that drops client-sent tenant headers, or undefined when the
 * request has none. The usual request has none, and then the response is exactly
 * what it was before tenant routing existed: no request-header override at all.
 */
function withoutClientTenantHeaders(req: NextRequest): { request: { headers: Headers } } | undefined {
  if (!req.headers.has(TENANT_ID_HEADER) && !req.headers.has(TENANT_SLUG_HEADER)) return undefined
  const headers = new Headers(req.headers)
  headers.delete(TENANT_ID_HEADER)
  headers.delete(TENANT_SLUG_HEADER)
  return { request: { headers } }
}

function plainResponse(body: string, status: number, extra: Record<string, string> = {}): NextResponse {
  return new NextResponse(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', ...extra },
  })
}

const tenantHostNotFound = () => plainResponse('Not found', 404)

/** Request headers with nothing a client sent to choose a tenant, a nonce or a policy. */
function tenantRequestHeaders(req: NextRequest): Headers {
  const headers = new Headers(req.headers)
  headers.delete(TENANT_ID_HEADER)
  headers.delete(TENANT_SLUG_HEADER)
  headers.delete(PRIVATE_ROUTE_HEADER)
  headers.delete(ENFORCING_CSP_HEADER)
  headers.delete(CSP_HEADER)
  headers.delete(NONCE_HEADER)
  return headers
}

/**
 * Mints this request's enforcing policy (S5, B6; lib/csp.ts, tenantPagePolicy). Next reads
 * the nonce from the policy on the request headers, and x-nonce takes it to the Clerk
 * layouts, as on Stellr's routes. Returns the policy for the response.
 */
function setTenantPagePolicy(headers: Headers): string {
  const nonce = createNonce()
  const policy = tenantPagePolicy(nonce)
  headers.set(ENFORCING_CSP_HEADER, policy)
  headers.set(NONCE_HEADER, nonce)
  return policy
}

/** Answers a request on a host that is not Stellr's. Never falls through to the Stellr path. */
async function respondOnNonStellrHost(
  req: NextRequest,
  event: NextFetchEvent,
  resolution: Exclude<TenantHostResolution, { kind: 'stellr' }>,
): Promise<Response> {
  if (resolution.kind === 'unavailable') return plainResponse('Service unavailable', 503, { 'Retry-After': '30' })
  if (resolution.kind !== 'tenant') return tenantHostNotFound()
  switch (tenantHostRoute(req.nextUrl.pathname)) {
    case 'denied':
      return tenantHostNotFound()
    case 'robots':
      return new NextResponse(TENANT_HOST_ROBOTS_TXT, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    case 'static': {
      // With no such file, next.config.mjs's fallback rewrite renders the tenant tree's
      // 404 here, so this needs the page policy. On a real file it changes nothing: the
      // only script under public/ is the check-in desk's service worker, which only the
      // desk registers, on Stellr's admin pages.
      const headers = tenantRequestHeaders(req)
      const policy = setTenantPagePolicy(headers)
      return applyEnforcingCsp(NextResponse.next({ request: { headers } }), policy, req.url)
    }
    default:
      return (await tenantClerkHandler(req, event)) || tenantHostNotFound()
  }
}

export default async function proxy(req: NextRequest, event: NextFetchEvent) {
  // Always on, on every host: the tenant tree is reached only through the rewrite below.
  if (isInternalTenantTreePath(req.nextUrl.pathname)) return plainResponse('Not found', 404)

  // Tenant routing (S5, B5). This comes before the marketing fast path and the
  // crawler count, because `/` and /events would otherwise serve Stellr's marketing
  // on a tenant host. With the flag off it is this one string comparison. With it
  // on, a host outside the tenant zone is string work too: only a host inside the
  // zone can reach the cached host map, so a Stellr host never adds a database call.
  if (process.env[TENANT_ROUTING_FLAG] === 'true') {
    const resolution = await resolveTenantHost(req.headers.get('host'))
    if (resolution.kind !== 'stellr') return respondOnNonStellrHost(req, event, resolution)
  }

  const host = req.headers.get('host') ?? ''
  const isAppSubdomain = !IS_SINGLE_HOST && host === APP_HOST
  if (!isAppSubdomain && isMarketingRoute(req)) {
    // AEO measurement (see below), without Clerk.
    if (req.method === 'GET') {
      const bot = matchCrawler(req.headers.get('user-agent'))
      if (bot) event.waitUntil(recordCrawlerHit(bot, req.nextUrl.pathname))
    }
    // Report-Only CSP (lib/csp.ts): marketing pages are prerendered, so the host policy.
    return applyCsp(withRegionCookie(req, NextResponse.next(withoutClientTenantHeaders(req))), cspFor(req.nextUrl.pathname).value, req.url)
  }
  // Clerk returns nothing when it has nothing to add; that means carry on.
  return withRegionCookie(req, (await clerkHandler(req, event)) || NextResponse.next(withoutClientTenantHeaders(req)))
}

/** The per-instance limit on public credential pages, on every host that serves them. */
function credentialRateLimited(req: NextRequest): NextResponse | null {
  if (!isCredentialRoute(req)) return null
  const rl = checkRateLimit(`credentials:${clientIp(req)}`, { limit: 60, windowMs: 60_000 })
  if (rl.ok) return null
  return new NextResponse('Too many requests', {
    status: 429,
    headers: { 'Retry-After': String(rl.retryAfterSeconds) },
  })
}

// A tenant host's allowed pages and APIs. Clerk runs so that a session and its
// handshake work there, but none of the Stellr handler's host logic does: no
// app-host redirects, no www 308s, no crawler count, and no /admin role check,
// because /admin never gets this far (the allow-list denies it, since a Clerk role
// is valid on every host until lib/authz checks tenant membership).
const tenantClerkHandler = clerkMiddleware(async (auth, req) => {
  // The cached map again: a clerkMiddleware handler takes no extra argument.
  const resolution = await resolveTenantHost(req.headers.get('host'))
  if (resolution.kind !== 'tenant') return tenantHostNotFound()

  const limited = credentialRateLimited(req)
  if (limited) return limited
  if (isProtectedRoute(req)) await auth.protect()

  const pathname = req.nextUrl.pathname
  const headers = tenantRequestHeaders(req)
  if (isPrivatePath(pathname)) headers.set(PRIVATE_ROUTE_HEADER, '1')

  // An API cannot live in the tenant tree, so it gets the trusted headers
  // (lib/tenancy/request-tenant.ts). A page gets the tenant from its URL instead,
  // which keeps the tenant in the cache key, so it never sees these headers.
  //
  // An API keeps the Report-Only policy, so the enforcing header it may have from
  // next.config.mjs stands: an enforcing 'object-src' on a PDF can stop the browser's
  // own viewer. The one API that draws an HTML page also gets a fixed enforcing policy
  // of its own (lib/csp.ts, tenantApiPolicy).
  if (tenantHostRoute(pathname) === 'api') {
    const csp = cspFor(pathname)
    if (csp.nonce) {
      headers.set('content-security-policy-report-only', csp.value)
      headers.set(NONCE_HEADER, csp.nonce)
    }
    headers.set(TENANT_ID_HEADER, resolution.tenantId)
    headers.set(TENANT_SLUG_HEADER, resolution.tenantSlug)
    const res = applyCsp(NextResponse.next({ request: { headers } }), csp.value, req.url)
    const enforcing = tenantApiPolicy(pathname)
    if (enforcing) res.headers.set(ENFORCING_CSP_HEADER, enforcing)
    return res
  }

  const policy = setTenantPagePolicy(headers)
  const target = req.nextUrl.clone()
  target.pathname = `/_t/${resolution.tenantSlug}${pathname === '/' ? '' : pathname}`
  return applyEnforcingCsp(NextResponse.rewrite(target, { request: { headers } }), policy, req.url)
})

const clerkHandler = clerkMiddleware(async (auth, req, event) => {
  const host = req.headers.get('host') ?? ''
  const isAppSubdomain = !IS_SINGLE_HOST && host === APP_HOST
  const url = new URL(req.url)

  const privateRoute = isPrivatePath(url.pathname)

  // AEO measurement: count public-site page requests from search and AI
  // crawlers (lib/crawlers.ts). waitUntil, so the write never delays or fails
  // the response the crawler receives. Never for a private link: its path is
  // the key to someone's registration or agreement.
  if (!isAppSubdomain && !privateRoute && req.method === 'GET' && !url.pathname.startsWith('/api/')) {
    const bot = matchCrawler(req.headers.get('user-agent'))
    if (bot) event.waitUntil(recordCrawlerHit(bot, url.pathname))
  }

  // Resolve auth once and reuse across all branches
  const needsUserId = isAppSubdomain || isAuthRoute(req) || isCommunityRoute(req)
  const { userId } = needsUserId ? await auth() : { userId: null }

  if (isAppSubdomain) {
    if (url.pathname === '/') {
      return NextResponse.redirect(new URL(userId ? '/home' : '/sign-in', req.url))
    }
    // The events *list* lives in-app on the app subdomain (the member-facing
    // event/campaign catalog). Serve the member portal page at /events without
    // changing the URL. Event *detail* and registration still belong to www and
    // fall through to the public-only redirect below.
    if (url.pathname === '/events') {
      return NextResponse.rewrite(new URL('/community/events', req.url), withoutClientTenantHeaders(req))
    }
    // Admin view-as is a host-only cookie on app, so on www the credential page
    // resolves the admin, not the member, and says "This credential is
    // private". Keep it on app while viewing as someone; the page re-checks the
    // cookie and the admin claim, and its canonical URL stays www.
    const viewAsCredential = isCredentialRoute(req) && req.cookies.has(IMPERSONATION_COOKIE)
    if (isPublicOnlyRoute(req) && !viewAsCredential) {
      return NextResponse.redirect(new URL(url.pathname + url.search, WWW), 308)
    }
  }

  const limited = credentialRateLimited(req)
  if (limited) return limited

  if (isAuthRoute(req) && userId) {
    // Already signed in. With a ?next, go through onboarding, which sends an
    // onboarded member straight on to it and makes anyone else finish their
    // profile (and its age checks) first. That is the case of a form that read
    // a community API's 401 as "guest": the API refuses an account that has
    // not onboarded (lib/onboarded-member). Without ?next, /home as before.
    const next = safeNext(url.searchParams.get('next'))
    return NextResponse.redirect(new URL(next ? `/account/onboarding?next=${encodeURIComponent(next)}` : '/home', req.url))
  }

  if (isCommunityRoute(req) && !userId) {
    // Anyone can create an account (decision 24, 3 Nov 2026). Guests get a page
    // that offers both: Clerk's sign-in card with its "Sign up" link, or the
    // sign-up card (linking back to sign-in) for pages meant for new members.
    // Preserve the intended destination so they resume here afterwards. The
    // auth pages validate ?next with safeNext (same-origin relative paths only).
    const mode = isNewMemberRoute(req) ? 'sign-up' : 'sign-in'
    return NextResponse.redirect(new URL(authPath(url.pathname + url.search, mode), req.url))
  }

  if (isProtectedRoute(req)) {
    await auth.protect()
  }

  // Admin portal authorisation (deep review C-2). The (admin) layout also
  // redirects, but a redirect thrown in a layout does NOT stop the page segment
  // beneath it from rendering and serialising its data: a signed-in member who
  // requests the RSC payload of /admin/members directly still received the full
  // member list (minors' rows included). Middleware runs BEFORE the render, so
  // the decision has to be here. This gates the admin PAGES only — /api/admin/*
  // routes keep their own per-handler admin guards and are not matched by
  // isAdminRoute (they live under /api).
  if (isAdminRoute(req)) {
    const { sessionClaims } = await auth()
    const role = portalRoleFromClaims(sessionClaims)
    if (!role) {
      return NextResponse.redirect(new URL('/account', req.url))
    }
    // Event Managers may only enter the Events/Competitions section.
    if (role === 'event_manager' && !isAdminEventsRoute(req)) {
      return NextResponse.redirect(new URL('/admin/competitions', req.url))
    }
    // Staff read the whole portal except view-as and the role and privacy
    // pages (lib/authz/decide.ts STAFF_HIDDEN_ADMIN_PATHS).
    if (role === 'staff' && isStaffHiddenAdminPath(req.nextUrl.pathname)) {
      return NextResponse.redirect(new URL('/admin', req.url))
    }
  }

  // Tell the root layout to load no tracking on a private-link page. Set here,
  // overwriting anything the client sent, so it cannot be spoofed to switch
  // tracking off elsewhere (or on here).
  const headers = new Headers(req.headers)
  headers.delete(PRIVATE_ROUTE_HEADER)
  if (privateRoute) headers.set(PRIVATE_ROUTE_HEADER, '1')
  // Only the tenant handler above sets these, on a host mapped to a tenant.
  headers.delete(TENANT_ID_HEADER)
  headers.delete(TENANT_SLUG_HEADER)

  // ── Content-Security-Policy, Report-Only (S1; lib/csp.ts) ──────────────────
  // A route that renders per request gets a fresh nonce. Next reads it from the
  // policy on the request headers and stamps it on its own scripts and every
  // next/script. Anything the client sent under these names is dropped first,
  // so it can't choose the nonce.
  // The nonce also goes to the layouts as x-nonce, for the clerk-js tag Clerk
  // renders in the HTML (lib/request-nonce.ts).
  headers.delete('content-security-policy')
  headers.delete('content-security-policy-report-only')
  headers.delete(NONCE_HEADER)
  const csp = cspFor(url.pathname)
  if (csp.nonce) {
    headers.set('content-security-policy-report-only', csp.value)
    headers.set(NONCE_HEADER, csp.nonce)
  }
  return applyCsp(NextResponse.next({ request: { headers } }), csp.value, req.url)
  // ── end CSP ────────────────────────────────────────────────────────────────
})

// /api/img (the Sanity watermarker) is left out of both entries: it reads no
// session, and a page with a gallery fetches dozens of its URLs, each one a
// proxy run on Vercel's metered CPU even when the CDN already has the image
// (the proxy was 37% of the team's Active CPU on 21 Oct 2026). The check-in
// desk's scanner reader (/vendor/zxing_reader.wasm) is a static file too.
// /api/csp-report (browser CSP reports) is skipped for the same reason: it reads
// no session, and a page can send several reports.
//
// /_vercel/ (Vercel's analytics beacons) is also left out: it reads no session, and
// otherwise takes the slower Clerk path. Add an exact path like this one, not an
// extension: skipping .txt or .xml would also let /admin/x.txt or /credentials/x.txt
// past the admin check, rate limit and private-route header.
//
// The first entry leaves out URLs with a static file extension. That test looks at the
// whole path and has no end boundary, so /admin/members/x.css and /admin/x.js/y match
// it. Those paths are safe today only because auth() throws without this proxy and each
// page has its own guard. A client can forge a signed-out Clerk header on a skipped path
// to stop the throw, which would leave only the page guards, so the third entry always
// runs the proxy under the gated prefixes. No real file is served from them, so normal
// traffic gains no runs. /check-in-desk-sw.js is a root file, not under /check-in/. A new
// gated route group needs its prefix added here.
//
// The last two entries are for tenant routing (S5, B5), and neither adds a proxy run for
// normal Stellr traffic:
//   - A first segment starting with `%`, or `_t` or an encoded `_t`. The tenant tree
//     must 404 by every spelling, with or without an extension, on every host. The
//     proxy compares the decoded segment; anything else starting `%` just carries on.
//   - Any host that is not one of Stellr's own (lib/tenancy/host-pure.ts, and
//     test/proxy-tenant-routing.test.ts keeps the two in step). On those hosts every
//     path must reach the tenant-host allow-list. The Stellr hosts are named literally
//     because Next reads this config statically, and naming them means this entry does
//     not depend on the zone setting. Attaching a new Stellr domain means adding it
//     here and in host-pure.ts, or each of its static files runs the proxy and Clerk.
export const config = {
  matcher: [
    '/((?!_next|_vercel/|api/img(?:/|$)|api/csp-report(?:/|$)|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|wasm)).*)',
    '/((?!api/img(?:/|$)|api/csp-report(?:/|$))(?:api|trpc).*)',
    '/((?:admin|account|community|home|campaigns|credentials|team-profile|survey|register|sign|check-in|scholarship/offer)(?:/.*)?)',
    '/((?:%|_(?:[tT](?:/|$)|%)).*)',
    {
      source: '/((?!_next(?:/|$)|api/img(?:/|$)|api/csp-report(?:/|$)).*)',
      missing: [
        {
          type: 'host',
          value: '(?:(?:www\\.|app\\.)?stellreducation\\.org|localhost|127\\.0\\.0\\.1|.+\\.vercel\\.app)',
        },
      ],
    },
  ],
}
