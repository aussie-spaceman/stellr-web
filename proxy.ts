import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

const isProtectedRoute = createRouteMatcher(['/account(.*)', '/admin(.*)'])
const isAdminRoute = createRouteMatcher(['/admin(.*)'])
const isAdminEventsRoute = createRouteMatcher(['/admin/events(.*)'])
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
])

const WWW = 'https://www.stellreducation.org'

export default clerkMiddleware(async (auth, req) => {
  const host = req.headers.get('host') ?? ''
  const isAppSubdomain = host === 'app.stellreducation.org'
  const url = new URL(req.url)

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
    if (isPublicOnlyRoute(req)) {
      return NextResponse.redirect(new URL(url.pathname + url.search, WWW), 308)
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

  // Event Managers may only enter the Events section of the admin portal;
  // the admin layout handles redirecting everyone else without a role.
  if (isAdminRoute(req) && !isAdminEventsRoute(req)) {
    const { sessionClaims } = await auth()
    const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role
    if (role === 'event_manager') {
      return NextResponse.redirect(new URL('/admin/events', req.url))
    }
  }
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
