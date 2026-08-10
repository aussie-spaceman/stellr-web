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

/** Stable node ids so every graph on the site resolves to one entity. */
export const ORG_ID = `${WWW}/#organization`
export const SITE_ID = `${WWW}/#website`

/**
 * Reference to the Organization node declared in the root layout. Carries
 * @type and name as well as @id so each script tag stays self-describing —
 * validators shouldn't have to resolve across script tags to make sense of it.
 */
const ORGANIZER = {
  '@type': 'Organization',
  '@id': ORG_ID,
  name: 'Stellr Education',
  url: WWW,
}

/**
 * The root Organization node. Typed as both EducationalOrganization and NGO:
 * the first is what Stellr does, the second is what it is, and answer engines
 * use both to disambiguate "Stellr" from the unrelated software and fintech
 * companies of the same name.
 */
export function buildOrganizationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': ['EducationalOrganization', 'NGO'],
    '@id': ORG_ID,
    name: 'Stellr Education',
    alternateName: 'Stellr',
    url: WWW,
    logo: {
      '@type': 'ImageObject',
      url: `${WWW}/images/stellr-logo.png`,
    },
    description:
      'Stellr Education is a US 501(c)(3) nonprofit running industry-simulation STEM design competitions that connect middle and high school students with practising aerospace, engineering and environmental professionals. Competitions are free for students to enter and the classroom curriculum is free to download.',
    foundingDate: '2021-05',
    nonprofitStatus: 'https://schema.org/Nonprofit501c3',
    areaServed: { '@type': 'Country', name: 'United States' },
    audience: {
      '@type': 'EducationalAudience',
      educationalRole: 'student',
      audienceType: 'Middle and high school students, college students, and educators',
    },
    // The topics we want to be retrieved for — not just the brand name.
    knowsAbout: [
      'STEM education',
      'STEM design competitions',
      'aerospace engineering education',
      'space settlement design',
      'environmental and sustainability design challenges',
      'project-based learning',
      'career and technical education',
      'NGSS-aligned curriculum',
      'ISTE standards',
      'student mentoring by industry professionals',
    ],
    contactPoint: {
      '@type': 'ContactPoint',
      email: 'hello@stellreducation.org',
      contactType: 'customer service',
      areaServed: 'US',
      availableLanguage: 'English',
    },
    sameAs: [
      'https://www.linkedin.com/company/stellreducation/',
      'https://x.com/stellreducation',
      'https://www.instagram.com/stellreducation/',
      'https://www.facebook.com/stellreducation',
      'https://www.youtube.com/@StellrEducation',
    ],
  }
}

/** The site itself, so Article/Event nodes have a publisher to hang off. */
export function buildWebSiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': SITE_ID,
    url: WWW,
    name: 'Stellr Education',
    inLanguage: 'en-US',
    publisher: { '@id': ORG_ID },
  }
}

/**
 * FAQPage for a page whose visible copy already answers these questions.
 * Answers must be plain text (schema.org allows limited inline HTML, but the
 * React nodes we render can't be serialised), and must match what a reader
 * sees — mismatched FAQ markup is treated as spam.
 */
export function buildFaqJsonLd(faqs: readonly { q: string; text: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.text },
    })),
  }
}

type SchemaNewsPost = {
  title: string
  excerpt?: string
  publishedAt?: string
  _updatedAt?: string
  author?: string
  category?: string
  coverImage?: { asset: { _ref: string } }
}

/**
 * NewsArticle for /news/[slug]. Provenance — who wrote it and when — is what
 * decides whether an answer engine will cite editorial content at all.
 */
export function buildArticleJsonLd(post: SchemaNewsPost, slug: string) {
  const url = `${WWW}/news/${slug}`
  return {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    '@id': `${url}#article`,
    headline: post.title,
    description: post.excerpt,
    datePublished: post.publishedAt,
    dateModified: post._updatedAt ?? post.publishedAt,
    // Falls back to the organisation until a post has a named author.
    author: post.author ? { '@type': 'Person', name: post.author } : ORGANIZER,
    publisher: ORGANIZER,
    articleSection: post.category,
    image: post.coverImage
      ? urlFor(post.coverImage).width(1200).height(630).url()
      : undefined,
    isPartOf: { '@id': SITE_ID },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    inLanguage: 'en-US',
    url,
  }
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

/**
 * Participation figures on /impact, as a Dataset of named measurements.
 *
 * Answer engines discard undated, unattributed claims, so every figure carries
 * its collection period and method here as well as in the visible copy. Keep
 * this in sync with PARTICIPATION_2026 on the /impact page — if a number
 * changes there and not here, the markup becomes a liability rather than a help.
 */
export function buildImpactDatasetJsonLd(
  stats: readonly { name: string; value?: number; minValue?: number; maxValue?: number; unitText: string; description: string }[]
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    '@id': `${WWW}/impact#participation-2026`,
    name: 'Stellr Education participation and outcomes, 2026',
    description:
      'Participant demographics and post-secondary outcomes across Stellr Education competition events held in 2026, drawn from participant-reported registration data.',
    temporalCoverage: '2026',
    measurementTechnique: 'Participant-reported registration data collected at competition sign-up',
    creator: ORGANIZER,
    publisher: ORGANIZER,
    isAccessibleForFree: true,
    url: `${WWW}/impact`,
    variableMeasured: stats.map((s) => ({
      '@type': 'PropertyValue',
      name: s.name,
      description: s.description,
      unitText: s.unitText,
      ...(s.value !== undefined ? { value: s.value } : {}),
      ...(s.minValue !== undefined ? { minValue: s.minValue } : {}),
      ...(s.maxValue !== undefined ? { maxValue: s.maxValue } : {}),
    })),
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
