'use client'

import { Suspense } from 'react'
import { usePathname } from 'next/navigation'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { trackingAllowedHere } from '@/lib/analytics'
import { isPrivatePath } from '@/lib/private-routes'
import { CookieConsent } from './CookieConsent'
import { GoogleTagManager } from './GoogleTagManager'
import { HubSpotTracking } from './HubSpotTracking'

/** Drop any analytics event whose URL is a private link. */
function dropPrivate<T extends { url: string }>(event: T): T | null {
  try {
    return isPrivatePath(new URL(event.url).pathname) ? null : event
  } catch {
    return event
  }
}

/**
 * Every analytics and advertising tag, plus the cookie banner.
 *
 * A page opened from a private link (a signing link, a pay or join link, a
 * credential, check-in — lib/private-routes.ts) loads none of them: its
 * address is the key to someone's agreement or registration. That used to be
 * decided on the server from a request header set by proxy.ts, which made every
 * page in the app render per request. It is decided here, in the browser, from
 * the same isPrivatePath() list, so public pages can be served from the CDN.
 *
 * Client-side navigation is covered too: moving from a public page to a
 * private one unmounts the banner and stops Vercel Analytics and Speed Insights
 * reporting the private URL (beforeSend). GTM, once loaded on a public page,
 * stays loaded — as it did before — so links into private pages from public
 * ones should be full page loads (they are emailed or scanned in practice).
 *
 * A host that is not Stellr's own (a tenant host) loads none of them either,
 * decided the same way: in the browser, before any tracker mounts. The server
 * can't tell and sends the Stellr markup, so that branch keeps the two things in
 * it that leave markup behind, or hydration would fail: the banner, which removes
 * itself, and an empty stand-in for SpeedInsights' Suspense boundary.
 */
export function SiteTracking() {
  const pathname = usePathname() ?? ''
  const isPrivate = isPrivatePath(pathname)

  if (!trackingAllowedHere()) {
    return isPrivate ? null : (
      <>
        <CookieConsent disabled />
        <Suspense fallback={null} />
      </>
    )
  }

  return (
    <>
      {!isPrivate && <GoogleTagManager />}
      {!isPrivate && <CookieConsent />}
      {/* Sets the hubspotutk cookie the lead routes pass to the Forms API for
          source attribution (see lib/hubspot.ts). */}
      {!isPrivate && <HubSpotTracking />}
      {!isPrivate && <Analytics beforeSend={dropPrivate} />}
      {/* Real-visitor Core Web Vitals (LCP, INP, CLS) by page and device. No
          cookies. */}
      {!isPrivate && <SpeedInsights beforeSend={dropPrivate} />}
    </>
  )
}
