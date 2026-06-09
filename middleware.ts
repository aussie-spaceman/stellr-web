import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

const isProtectedRoute = createRouteMatcher([
  '/account(.*)',
  '/admin(.*)',
])

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

  if (isAppSubdomain) {
    // Root of app subdomain → members area (or sign-in if not logged in)
    if (url.pathname === '/') {
      const { userId } = await auth()
      const dest = userId ? '/account' : '/sign-in'
      return NextResponse.redirect(new URL(dest, req.url))
    }

    // Public-only pages on app subdomain → redirect to www
    if (isPublicOnlyRoute(req)) {
      return NextResponse.redirect(
        new URL(url.pathname + url.search, WWW),
        308,
      )
    }
  }

  // Already-signed-in users visiting auth pages → send to account
  if (url.pathname.startsWith('/sign-in') || url.pathname.startsWith('/sign-up')) {
    const { userId } = await auth()
    if (userId) {
      return NextResponse.redirect(new URL('/account', req.url))
    }
  }

  if (isProtectedRoute(req)) {
    await auth.protect()
  }
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
