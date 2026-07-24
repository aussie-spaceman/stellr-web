// ── Schema.org JSON-LD builders ──────────────────────────────────────────────
// Program metadata only — never personal data. Dates in ISO 8601. Fields that
// don't exist in the source are omitted (JSON.stringify drops `undefined`).
//
// Domain model:
//   Competition → EventSeries (the theme, e.g. "Space Design Challenge")
//   Event (live_event, in-person) → Event + OfflineEventAttendanceMode + Place
//   Event (live_event, virtual)   → Event + OnlineEventAttendanceMode + VirtualLocation
//   Campaign (activityType campaign) → Event + OnlineEventAttendanceMode + VirtualLocation
// Events/Campaigns link up to their Competition via `superEvent`.

import { urlFor, type StellarEvent } from '@/lib/sanity'
import { getCampaignDates, type CampaignSeason } from '@/lib/campaigns'

const WWW = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

const ORGANIZER = {
  '@type': 'Organization',
  name: 'Stellr Education',
  url: WWW,
}

/** The event/campaign's competition theme as an EventSeries, for superEvent. */
export function competitionSeries(type?: string) {
  return {
    '@type': 'EventSeries',
    name: type || 'Stellr Design Competition',
    url: `${WWW}/competitions`,
  }
}

type SchemaEvent = StellarEvent & {
  setting?: string
  stripePriceId?: string
}

/** JSON-LD for a live Event detail page (/events/[slug]). In-person or virtual. */
export function buildEventJsonLd(event: SchemaEvent, slug: string) {
  const url = `${WWW}/events/${slug}`
  const isVirtual = event.setting === 'virtual'

  const offer: Record<string, unknown> = {
    '@type': 'Offer',
    availability: 'https://schema.org/InStock',
    url: `${WWW}/register/${slug}`,
    validFrom: event.registrationOpenDate,
  }
  // Fee is stored as a Stripe price ID, not a number. Free events (no price ID)
  // advertise price 0; paid events omit price rather than inventing one.
  if (!event.stripePriceId) {
    offer.price = '0'
    offer.priceCurrency = 'USD'
  }

  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.title,
    description: event.tagline,
    startDate: event.date,
    endDate: event.endDate ?? event.date,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: isVirtual
      ? 'https://schema.org/OnlineEventAttendanceMode'
      : 'https://schema.org/OfflineEventAttendanceMode',
    location: isVirtual
      ? { '@type': 'VirtualLocation', url }
      : {
          '@type': 'Place',
          name: event.venue || event.city,
          address: {
            '@type': 'PostalAddress',
            addressLocality: event.city,
            addressRegion: event.state,
            addressCountry: 'US',
          },
        },
    superEvent: event.type ? competitionSeries(event.type) : undefined,
    organizer: ORGANIZER,
    image: event.image ? urlFor(event.image).width(1200).height(630).url() : undefined,
    offers: offer,
    url,
  }
}

/** JSON-LD for a Campaign (remote/online, free) rendered at /events/[slug]. */
export function buildCampaignJsonLd(event: SchemaEvent, slug: string) {
  const url = `${WWW}/events/${slug}`
  const dates =
    event.season && event.campaignYear
      ? getCampaignDates(event.season as CampaignSeason, event.campaignYear)
      : null

  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: event.title,
    description: event.tagline,
    startDate: dates?.startDate,
    endDate: dates?.endDate,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
    location: { '@type': 'VirtualLocation', url },
    superEvent: event.type ? competitionSeries(event.type) : undefined,
    organizer: ORGANIZER,
    image: event.image ? urlFor(event.image).width(1200).height(630).url() : undefined,
    // Campaigns are always free to join.
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
      url,
    },
    url,
  }
}

/** The two competition themes as EventSeries, for the /competitions page. */
export function buildCompetitionSeriesJsonLd() {
  const series = (name: string, description: string) => ({
    '@context': 'https://schema.org',
    '@type': 'EventSeries',
    name,
    description,
    organizer: ORGANIZER,
    url: `${WWW}/competitions`,
  })
  return [
    series(
      'Space Design Challenge',
      'A Stellr industry-simulation STEM competition where student teams tackle real-world space and aerospace design challenges mentored by industry professionals.'
    ),
    series(
      'Environmental Design Challenge',
      'A Stellr industry-simulation STEM competition where student teams tackle real-world environmental and sustainability design challenges mentored by industry professionals.'
    ),
  ]
}
