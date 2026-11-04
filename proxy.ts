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
import { NONCE_HEADER, applyCsp, cspFor } from '@/lib/csp'

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

export default async function proxy(req: NextRequest, event: NextFetchEvent) {
  const host = req.headers.get('host') ?? ''
  const isAppSubdomain = !IS_SINGLE_HOST && host === APP_HOST
  if (!isAppSubdomain && isMarketingRoute(req)) {
    // AEO measurement (see below), without Clerk.
    if (req.method === 'GET') {
      const bot = matchCrawler(req.headers.get('user-agent'))
      if (bot) event.waitUntil(recordCrawlerHit(bot, req.nextUrl.pathname))
    }
    // Report-Only CSP (lib/csp.ts): marketing pages are prerendered, so the host policy.
    return applyCsp(withRegionCookie(req, NextResponse.next()), cspFor(req.nextUrl.pathname).value, req.url)
  }
  // Clerk returns nothing when it has nothing to add; that means carry on.
  return withRegionCookie(req, (await clerkHandler(req, event)) || NextResponse.next())
}

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
      return NextResponse.rewrite(new URL('/community/events', req.url))
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

  if (isCredentialRoute(req)) {
    const rl = checkRateLimit(`credentials:${clientIp(req)}`, { limit: 60, windowMs: 60_000 })
    if (!rl.ok) {
      return new NextResponse('Too many requests', {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfterSeconds) },
      })
    }
  }

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
    const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role
    if (role !== 'admin' && role !== 'event_manager') {
      return NextResponse.redirect(new URL('/account', req.url))
    }
    // Event Managers may only enter the Events/Competitions section.
    if (role === 'event_manager' && !isAdminEventsRoute(req)) {
      return NextResponse.redirect(new URL('/admin/competitions', req.url))
    }
  }

  // Tell the root layout to load no tracking on a private-link page. Set here,
  // overwriting anything the client sent, so it cannot be spoofed to switch
  // tracking off elsewhere (or on here).
  const headers = new Headers(req.headers)
  headers.delete(PRIVATE_ROUTE_HEADER)
  if (privateRoute) headers.set(PRIVATE_ROUTE_HEADER, '1')

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
export const config = {
  matcher: [
    '/((?!_next|api/img(?:/|$)|api/csp-report(?:/|$)|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|wasm)).*)',
    '/((?!api/img(?:/|$)|api/csp-report(?:/|$))(?:api|trpc).*)',
  ],
}
