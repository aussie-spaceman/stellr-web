'use client'

import { usePathname } from 'next/navigation'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'
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
 */
export function SiteTracking() {
  const pathname = usePathname() ?? ''
  const isPrivate = isPrivatePath(pathname)

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
