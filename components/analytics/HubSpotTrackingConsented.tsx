'use client'

import Script from 'next/script'
import { useEffect, useState } from 'react'
import { CONSENT_OPEN_EVENT, readConsent } from '@/lib/consent'

/**
 * The EEA/UK/CH half of <HubSpotTracking />: load the tracking script only
 * once the visitor has actively consented.
 *
 * Google's tags get this behaviour free from Consent Mode's `region`
 * parameter. HubSpot's script has no equivalent — it sets `hubspotutk` the
 * moment it runs — so the only way to withhold it is not to load it, which
 * makes this a client component: the decision lives in localStorage and is
 * therefore unknowable at render time on the server.
 *
 * Rendering nothing until consent is the point. There is no "load it but
 * suppress the cookie" mode.
 */
export function HubSpotTrackingConsented({ portalId }: { portalId: string }) {
  const [granted, setGranted] = useState(false)

  useEffect(() => {
    const sync = () => setGranted(readConsent()?.ads === true)
    sync()

    // Re-check when the banner is reopened from the footer link, so granting
    // consent starts tracking on the same page rather than the next one — and,
    // more importantly, so withdrawing it is visible without a reload.
    window.addEventListener(CONSENT_OPEN_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(CONSENT_OPEN_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  if (!granted) return null

  return (
    <Script
      id="hs-script-loader"
      strategy="afterInteractive"
      src={`https://js.hs-scripts.com/${portalId}.js`}
    />
  )
}
