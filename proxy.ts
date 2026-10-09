import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { APP_HOST, SITE_URL } from '@/lib/env'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'
import { matchCrawler, recordCrawlerHit } from '@/lib/crawlers'
import { PRIVATE_ROUTE_HEADER, isPrivatePath } from '@/lib/private-routes'
import { IMPERSONATION_COOKIE } from '@/lib/impersonation-cookie'

const isProtectedRoute = createRouteMatcher(['/account(.*)', '/admin(.*)'])
const isAdminRoute = createRouteMatcher(['/admin(.*)'])
// Competitions admin (formerly /admin/events — the old path 307s in next.config).
const isAdminEventsRoute = createRouteMatcher(['/admin/competitions(.*)', '/admin/events(.*)'])
// Member-only app surfaces that require a signed-in user (Home dashboard + the
// community portal). Unauthenticated hits are bounced to sign-up.
const isCommunityRoute = createRouteMatcher(['/community(.*)', '/home(.*)'])
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

export default clerkMiddleware(async (auth, req, event) => {
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
    return NextResponse.redirect(new URL('/home', req.url))
  }

  if (isCommunityRoute(req) && !userId) {
    // Preserve the intended destination so the guest resumes here after
    // sign-up + onboarding (e.g. an /academy "Book a mentoring session" CTA
    // deep-links straight into /community/mentoring/discover). The sign-up
    // page validates ?next with safeNext (same-origin relative paths only).
    const signUp = new URL('/sign-up', req.url)
    signUp.searchParams.set('next', url.pathname + url.search)
    return NextResponse.redirect(signUp)
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
  return NextResponse.next({ request: { headers } })
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
