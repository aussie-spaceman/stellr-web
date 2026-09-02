'use client'

import { Button } from '@stellr/web-ui'
import { pushDataLayer } from '@/lib/analytics'
import type { LpAudience } from '@/content/lp/types'

/**
 * The landing-page-specific dataLayer events, minus the conversion.
 *
 * The conversion is deliberately not here: it fires as `lead_submitted` through
 * lib/analytics.ts so it joins the same funnel every other lead route feeds,
 * and so the ad platforms keep optimising against one event rather than two.
 * `lp_view` is emitted by the shared <TrackEvent> component from the page.
 *
 * `lp_booking_click` is the important one. With no prefill available on the
 * Motion calendar, it is the only signal between "submitted" and "actually
 * booked" — without it, making the call mandatory is unmeasurable.
 *
 * Each of these needs a Custom Event trigger and a GA4 tag built by hand in
 * GTM-WXBRWSH. `flyer_download` shipped without one and has been silently
 * untracked ever since, so an event pushed here is not yet an event recorded.
 */

export type CtaLocation = 'hero' | 'cta_block'

export interface LpDims {
  audience: LpAudience
  pageSlug: string
}

export function lpDims({ audience, pageSlug }: LpDims) {
  return { lp_audience: audience, page_slug: pageSlug }
}

/** A CTA that reports where on the page it was clicked from. */
export function LpCta({
  audience, pageSlug, location, href, children, variant = 'primary',
}: LpDims & {
  location: CtaLocation
  href: string
  children: React.ReactNode
  variant?: 'primary' | 'outlineWhite'
}) {
  return (
    <Button
      href={href}
      variant={variant}
      onClick={() =>
        pushDataLayer({ event: 'lp_cta_click', location, ...lpDims({ audience, pageSlug }) })
      }
    >
      {children}
    </Button>
  )
}

/** Reports the hand-off to Motion. See the note above about why this matters. */
export function trackBookingClick(dims: LpDims): void {
  pushDataLayer({ event: 'lp_booking_click', ...lpDims(dims) })
}
