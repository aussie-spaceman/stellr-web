import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

const isProtectedRoute = createRouteMatcher(['/account(.*)', '/admin(.*)'])
const isAdminRoute = createRouteMatcher(['/admin(.*)'])
const isAdminEventsRoute = createRouteMatcher(['/admin/events(.*)'])
const isCommunityRoute = createRouteMatcher(['/community(.*)'])
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
      return NextResponse.redirect(new URL(userId ? '/account' : '/sign-in', req.url))
    }
    if (isPublicOnlyRoute(req)) {
      return NextResponse.redirect(new URL(url.pathname + url.search, WWW), 308)
    }
  }

  if (isAuthRoute(req) && userId) {
    return NextResponse.redirect(new URL('/account', req.url))
  }

  if (isCommunityRoute(req) && !userId) {
    return NextResponse.redirect(new URL('/sign-up', req.url))
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
