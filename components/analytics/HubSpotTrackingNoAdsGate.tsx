'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { hasNoAdsCookie, isNoAdsPath } from '@/lib/no-ads'

/**
 * HubSpot's tracking is marketing analytics, which a child under 13 does not
 * get (Privacy Policy §9.4). Suppressed in two cases:
 *  - the browser carries the no-ads cookie (a student has signed in here); and
 *  - the current path is a no-ads path (register, check-in, credentials,
 *    sign-up, the member app, admin) — a child registering on a fresh browser,
 *    or a guardian on the family credential link, has no cookie yet but must
 *    still not be tracked (deep review MP-3). This matches the path rule Google
 *    Consent Mode already uses.
 * Renders nothing until mounted, because the cookie is a browser fact.
 */
export function HubSpotTrackingNoAdsGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [cookieAllows, setCookieAllows] = useState(false)
  useEffect(() => setCookieAllows(!hasNoAdsCookie()), [])
  const pathAllows = !isNoAdsPath(pathname ?? '')
  return cookieAllows && pathAllows ? <>{children}</> : null
}
