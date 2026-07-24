// ── Analytics dataLayer helpers ──────────────────────────────────────────────
// Thin wrapper around GTM's dataLayer. GA4 and every event tag are configured by
// the owner in the GTM UI — this file only pushes privacy-safe events.
//
// HARD RULE: never push PII. No names, emails, phones, addresses, DOB, school,
// student names, Discord handles, or medical/dietary data. Only non-identifying
// values (competition slug, participation_type, an opaque registration ref).

export type ParticipationType = 'competition' | 'event' | 'campaign'

export interface DataLayerEvent {
  event: string
  [key: string]: unknown
}

/**
 * Push an event onto the GTM dataLayer. No-op during SSR. Safe if GTM hasn't
 * loaded yet — GTM drains any queued pushes once its snippet runs.
 */
export function pushDataLayer(payload: DataLayerEvent): void {
  if (typeof window === 'undefined') return
  window.dataLayer = window.dataLayer || []
  window.dataLayer.push(payload)
}

/**
 * Map a Sanity event document's activityType to a funnel participation_type.
 * Live events (in-person or virtual) → 'event'; campaigns → 'campaign'.
 */
export function participationTypeFor(activityType?: string): ParticipationType {
  return activityType === 'campaign' ? 'campaign' : 'event'
}

declare global {
  interface Window {
    dataLayer: unknown[]
  }
}
