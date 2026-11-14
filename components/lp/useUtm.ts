'use client'

import { useEffect, useState } from 'react'

// Shared by every landing-page form: the booking-call LeadForm and the
// curriculum-request form. Moved out of LeadForm.tsx unchanged.

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const
const UTM_STORE = 'stellr_lp_utm'

/**
 * Capture attribution once and keep it.
 *
 * Read on mount and persisted to sessionStorage, because the visitor will click
 * "Reserve a spot" or "Learn More" — both anchors — and a scroll-and-return can
 * lose the query string. Falls back to the referrer host for `utm_source`,
 * which is how an untagged social post still attributes to somewhere.
 */
export function useUtm(): Record<string, string> {
  const [utm, setUtm] = useState<Record<string, string>>({})

  useEffect(() => {
    let stored: Record<string, string> = {}
    try {
      stored = JSON.parse(sessionStorage.getItem(UTM_STORE) ?? '{}')
    } catch {
      // A private window or blocked storage is not a reason to lose the form.
      stored = {}
    }

    const params = new URLSearchParams(window.location.search)
    const fresh: Record<string, string> = {}
    for (const key of UTM_KEYS) {
      const value = params.get(key)
      if (value) fresh[key] = value
    }
    if (!fresh.utm_source && !stored.utm_source && document.referrer) {
      try {
        fresh.utm_source = new URL(document.referrer).hostname
      } catch {
        /* a malformed referrer is not worth a throw */
      }
    }

    const merged = { ...stored, ...fresh }
    setUtm(merged)
    try {
      sessionStorage.setItem(UTM_STORE, JSON.stringify(merged))
    } catch {
      /* nothing to do — the values still ride this page's submission */
    }
  }, [])

  return utm
}
