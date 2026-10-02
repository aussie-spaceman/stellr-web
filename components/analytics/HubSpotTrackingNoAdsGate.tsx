'use client'

import { useEffect, useState } from 'react'
import { hasNoAdsCookie } from '@/lib/no-ads'

/**
 * HubSpot's tracking is marketing analytics, which a child under 13 does not
 * get (Privacy Policy §9.4). A browser where a student has signed in carries
 * the no-ads cookie; there the script is never rendered. Renders nothing until
 * mounted, because the cookie is a browser fact.
 */
export function HubSpotTrackingNoAdsGate({ children }: { children: React.ReactNode }) {
  const [allowed, setAllowed] = useState(false)
  useEffect(() => setAllowed(!hasNoAdsCookie()), [])
  return allowed ? <>{children}</> : null
}
