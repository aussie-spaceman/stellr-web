import Script from 'next/script'

/**
 * HubSpot tracking script.
 *
 * Its job here is narrow but load-bearing: it sets the `hubspotutk` cookie,
 * which the lead routes read and pass to the Forms API as submission context.
 * Without it every capture attributes to "Offline Sources" and the Original /
 * Latest Traffic Source properties stay useless — you can see that a lead
 * arrived but never how they found us.
 *
 * Gated on NEXT_PUBLIC_HUBSPOT_PORTAL_ID so preview and local builds don't
 * pollute the portal's analytics with non-visitor traffic. `afterInteractive`
 * keeps it off the critical path; the cookie is set well before anyone has
 * filled in a form.
 */
export function HubSpotTracking() {
  const portalId = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID
  if (!portalId) return null

  return (
    <Script
      id="hs-script-loader"
      strategy="afterInteractive"
      src={`https://js.hs-scripts.com/${portalId}.js`}
    />
  )
}
