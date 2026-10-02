'use client'

import { useEffect } from 'react'
import { NO_ADS_COOKIE } from '@/lib/no-ads'

/**
 * Marks this browser as a student's once one signs in to the member platform,
 * so advertising stays off on the public site too (Privacy Policy §9.4). The
 * cookie is shared across www and app, lasts a year, and outlives sign-out on
 * purpose: a shared family device that a child uses keeps no ads. HubSpot's
 * own do-not-track is set as well, since its script may already be loaded.
 */
export function NoAdsStudentMarker() {
  useEffect(() => {
    const host = window.location.hostname
    const domain = host.endsWith('stellreducation.org') ? '; domain=.stellreducation.org' : ''
    const secure = window.location.protocol === 'https:' ? '; secure' : ''
    document.cookie = `${NO_ADS_COOKIE}=1; path=/; max-age=31536000; samesite=lax${domain}${secure}`

    const w = window as unknown as { __stellrNoAds?: boolean; _hsq?: unknown[]; gtag?: (...a: unknown[]) => void; dataLayer?: unknown[] }
    w.__stellrNoAds = true
    w.gtag?.('consent', 'update', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' })
    ;(w.dataLayer = w.dataLayer || []).push({ stellr_no_ads: true })
    ;(w._hsq = w._hsq || []).push(['doNotTrack'])
  }, [])
  return null
}
