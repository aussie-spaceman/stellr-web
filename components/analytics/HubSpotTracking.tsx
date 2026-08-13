import Script from 'next/script'
import { headers } from 'next/headers'
import { isStrictRegion } from '@/lib/consent'
import { HubSpotTrackingConsented } from './HubSpotTrackingConsented'

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
 * That policy was written down, but never implemented here: this component
 * loaded unconditionally, so the stricter regions got the looser treatment.
 *
 * Google's tags enforce the regional split themselves via Consent Mode's
 * `region` parameter. HubSpot's script has no such mechanism, so the split has
 * to be made here — by not rendering the script at all until consent, since it
 * sets its cookie the instant it runs.
 *
 * Region comes from Vercel's `x-vercel-ip-country`. Where that is absent
 * (local dev, another host) `isStrictRegion` returns false, matching the
 * non-strict Consent Mode default rather than silently disabling tracking
 * wherever geo cannot be resolved.
 *
 * Attribution cost, stated plainly: an EEA/UK/CH visitor who declines — or who
 * never answers the banner — submits a form with no `hubspotutk`, and HubSpot
 * files that lead under Direct traffic. That is the correct trade, not a bug.
 *
 * Gated on NEXT_PUBLIC_HUBSPOT_PORTAL_ID so preview and local builds don't
 * pollute the portal's analytics with non-visitor traffic.
 */
export async function HubSpotTracking() {
  const portalId = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID
  if (!portalId) return null

  const country = (await headers()).get('x-vercel-ip-country')

  if (isStrictRegion(country)) {
    return <HubSpotTrackingConsented portalId={portalId} />
  }

  return (
    <Script
      id="hs-script-loader"
      strategy="afterInteractive"
      src={`https://js.hs-scripts.com/${portalId}.js`}
    />
  )
}
