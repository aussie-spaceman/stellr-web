'use client'

import { useEffect, useState } from 'react'
import Script from 'next/script'
import { STRICT_REGION_COOKIE } from '@/lib/consent'
import { HubSpotTrackingConsented } from './HubSpotTrackingConsented'
import { HubSpotTrackingNoAdsGate } from './HubSpotTrackingNoAdsGate'

/**
 * HubSpot tracking script.
 *
 * Its job here is narrow but load-bearing: it sets the `hubspotutk` cookie,
 * which the lead routes read and pass to the Forms API as submission context.
 * Without it every capture attributes to Direct rather than to the search,
 * campaign or referrer that actually produced the lead.
 *
 * Consent
 * -------
 * lib/consent.ts draws the line deliberately: advertising tags are gated
 * everywhere, while first-party aggregate analytics — this script included —
 * are disclosed in the privacy policy and not gated outside the EEA/UK/CH.
 *
 * Google's tags enforce the regional split themselves via Consent Mode's
 * `region` parameter. HubSpot's script has no such mechanism, so the split is
 * made here — by not rendering the script at all until consent, since it sets
 * its cookie the instant it runs.
 *
 * Region: proxy.ts sets STRICT_REGION_COOKIE from Vercel's
 * `x-vercel-ip-country`. Reading it here, in the browser, rather than reading
 * the request header on the server keeps the public pages cacheable. With no
 * cookie (local dev, another host) the visitor is treated as non-strict,
 * matching the Consent Mode default.
 *
 * Attribution cost, stated plainly: an EEA/UK/CH visitor who declines — or who
 * never answers the banner — submits a form with no `hubspotutk`, and HubSpot
 * files that lead under Direct traffic. That is the correct trade, not a bug.
 *
 * Loading: `lazyOnload`. The cookie only matters when a form is submitted, and
 * HubSpot's analytics script was the single costliest file on a mid-range phone
 * (~1.6s of main-thread work) when it ran as the page became interactive.
 *
 * Gated on NEXT_PUBLIC_HUBSPOT_PORTAL_ID so preview and local builds don't
 * pollute the portal's analytics with non-visitor traffic.
 */
export function HubSpotTracking() {
  const portalId = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID
  const [strict, setStrict] = useState<boolean | null>(null)

  useEffect(() => {
    setStrict(document.cookie.split(';').some((c) => c.trim() === `${STRICT_REGION_COOKIE}=1`))
  }, [])

  if (!portalId || strict === null) return null

  // Never in a browser where a student has signed in (§9.4).
  return (
    <HubSpotTrackingNoAdsGate>
      {strict ? (
        <HubSpotTrackingConsented portalId={portalId} />
      ) : (
        <Script id="hs-script-loader" strategy="lazyOnload" src={`https://js.hs-scripts.com/${portalId}.js`} />
      )}
    </HubSpotTrackingNoAdsGate>
  )
}
