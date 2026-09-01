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

/* ── Lead capture ─────────────────────────────────────────────────────────── */

/** Every public route that captures a lead. */
export type LeadFormSource =
  | 'newsletter'
  | 'event_notify'
  | 'white_paper'
  | 'asset_request'
  | 'scholarship'
  | 'host_event'
  | 'contact'
  | 'join_network'
  | 'teacher_grant'

/**
 * Who the route actually speaks to. This is the switch that lets an ad tag be
 * scoped to the audience it can reach: LinkedIn is a professional network, so
 * firing it on a student scholarship application spends budget on an audience
 * that isn't there. Derived here rather than passed in at each call site, so
 * eight components can't drift into disagreeing about what a route is.
 */
export type LeadAudience = 'b2b' | 'b2c'

const LEAD_AUDIENCE: Record<LeadFormSource, LeadAudience> = {
  // Educators, schools, sponsors, mentors, media.
  white_paper: 'b2b',
  asset_request: 'b2b',
  host_event: 'b2b',
  join_network: 'b2b',
  contact: 'b2b',
  teacher_grant: 'b2b',
  // Students and parents.
  newsletter: 'b2c',
  event_notify: 'b2c',
  scholarship: 'b2c',
}

/**
 * Fire when a lead form has been accepted by the server — not on click, and not
 * on a validation failure. This is the conversion every ad platform optimises
 * against, so a false positive here trains the bidding on nothing.
 *
 * Carries no PII by construction: the signature takes a route name, not the
 * submitted values. `detail` exists for non-identifying context such as a
 * competition slug; the PII rule at the top of this file applies to it in full.
 */
export function trackLeadSubmitted(
  source: LeadFormSource,
  detail?: Record<string, string | number | undefined>,
): void {
  pushDataLayer({
    event: 'lead_submitted',
    lead_source: source,
    audience: LEAD_AUDIENCE[source],
    ...(detail
      ? Object.fromEntries(Object.entries(detail).filter(([, v]) => v !== undefined))
      : {}),
  })
}

declare global {
  interface Window {
    dataLayer: unknown[]
  }
}
