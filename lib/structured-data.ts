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
//
// `EventSeries` is a SUBTYPE of Event, so Google validates a series node
// against the full Event spec — the bare `{ name, url }` stub this file used to
// emit for `superEvent`, and the dateless series on /competitions, are what
// Search Console reported as missing description/image/offers/eventStatus. Both
// are now built from the events that actually make up the series (see
// `competitionSeries`), never from placeholder values.

import { urlFor, type StellarEvent } from '@/lib/sanity'
import type { EventPrice } from '@/lib/event-pricing'
import { getCampaignDates, type CampaignSeason } from '@/lib/campaigns'
import { normaliseState } from '@/lib/locations'
import { registrationStatus, todayInAppZone } from '@/lib/utils'

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

// ── Event graph helpers ──────────────────────────────────────────────────────

type SchemaEvent = StellarEvent & {
  setting?: string
  stripePriceId?: string
}

/**
 * Recursively drop null/undefined, and objects left with nothing but their
 * @type, before a graph is serialised.
 *
 * `JSON.stringify` drops `undefined` — but GROQ answers a field the document
 * doesn't set with *null*, and null serialises. Production shipped
 * `"startDate": null` and an all-null PostalAddress for the Uruguay event,
 * which reads to a validator as a malformed entity rather than an absent field.
 */
export function prune<T>(node: T): T {
  return pruneValue(node) as T
}

function pruneValue(node: unknown): unknown {
  if (node === null || node === undefined) return undefined
  if (Array.isArray(node)) {
    const kept = node.map(pruneValue).filter((v) => v !== undefined)
    return kept.length > 0 ? kept : undefined
  }
  if (typeof node !== 'object') return node
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const kept = pruneValue(value)
    if (kept !== undefined) out[key] = kept
  }
  // `{ '@type': 'PostalAddress' }` describes nothing, so it goes; `{ '@id': … }`
  // is a legitimate reference to a node declared elsewhere, so @id is content.
  const describes = Object.keys(out).some((k) => k !== '@type' && k !== '@context')
  return describes ? out : undefined
}

/** Schema.org requires eventStatus to track reality, so it is authored in Sanity. */
const EVENT_STATUS: Record<string, string> = {
  scheduled: 'https://schema.org/EventScheduled',
  cancelled: 'https://schema.org/EventCancelled',
  postponed: 'https://schema.org/EventPostponed',
  rescheduled: 'https://schema.org/EventRescheduled',
  moved_online: 'https://schema.org/EventMovedOnline',
}

export function eventStatusUrl(status?: string): string {
  return EVENT_STATUS[status ?? ''] ?? EVENT_STATUS.scheduled
}

const IN_STOCK = 'https://schema.org/InStock'
const PRE_ORDER = 'https://schema.org/PreOrder'
const SOLD_OUT = 'https://schema.org/SoldOut'

const ONLINE_MODE = 'https://schema.org/OnlineEventAttendanceMode'
const OFFLINE_MODE = 'https://schema.org/OfflineEventAttendanceMode'
const MIXED_MODE = 'https://schema.org/MixedEventAttendanceMode'

/**
 * Offer availability, mirroring the status pill the visitor sees. An event that
 * is closed, cancelled or postponed while its markup still says InStock is the
 * kind of contradiction between page and schema that gets structured data
 * ignored — and it is the same `registrationStatus()` the pill and the
 * registration API gate on, so the three cannot disagree.
 */
function availabilityFor(event: SchemaEvent): string {
  if (event.status === 'cancelled' || event.status === 'postponed') return SOLD_OUT
  const reg = registrationStatus(event.registrationOpenDate, event.registrationCloseDate)
  if (reg === 'closed') return SOLD_OUT
  if (reg === 'coming-soon') return PRE_ORDER
  return IN_STOCK
}

/**
 * A Sanity date ("YYYY-MM-DD") plus an optional "HH:mm" as ISO 8601, with no
 * offset: authored times are venue-local, and a local date-time is read as the
 * event's own timezone rather than being reinterpreted as UTC. Date-only is
 * valid on its own — it just can't show a start time in Search.
 */
function dateTime(date?: string, time?: string): string | undefined {
  if (!date) return undefined
  return /^\d{2}:\d{2}$/.test(time ?? '') ? `${date}T${time}` : date
}

/** An event moved online is virtual regardless of the venue still on the document. */
function isVirtual(event: SchemaEvent): boolean {
  return event.setting === 'virtual' || event.status === 'moved_online'
}

function attendanceModeFor(event: SchemaEvent): string {
  return isVirtual(event) ? ONLINE_MODE : OFFLINE_MODE
}

function eventUrl(slug: string): string {
  return `${WWW}/events/${slug}`
}

function eventLocation(event: SchemaEvent, url: string) {
  if (isVirtual(event)) return { '@type': 'VirtualLocation', url }
  // A US state normalises to the USPS code Google documents. Anything else —
  // "Departamento de Maldonado" — is passed through as authored, and the country
  // is read from the CMS instead of being assumed: hard-coding 'US' had put a
  // Uruguayan venue in the United States.
  const stateCode = normaliseState(event.state)
  return {
    '@type': 'Place',
    name: event.venue || event.city,
    address: {
      '@type': 'PostalAddress',
      addressLocality: event.city,
      addressRegion: stateCode ?? event.state,
      addressCountry: stateCode ? 'US' : event.country,
    },
    geo:
      typeof event.latitude === 'number' && typeof event.longitude === 'number'
        ? { '@type': 'GeoCoordinates', latitude: event.latitude, longitude: event.longitude }
        : undefined,
  }
}

/**
 * Google recommends an image on every Event, and a node without one is one of
 * the warnings this file exists to clear. An event whose hero image hasn't been
 * loaded into the CMS yet falls back to the site's own social card — the same
 * 1200×630 image its share preview already uses, so nothing is invented.
 */
const DEFAULT_IMAGE = `${WWW}/images/og-default.jpg`

function imageFor(image?: { asset: { _ref: string } }): string {
  return image ? urlFor(image).width(1200).height(630).url() : DEFAULT_IMAGE
}

/**
 * The registration fee as Offer fields.
 *
 * Fee is stored as a Stripe price ID, not a number, so the caller resolves it
 * against Stripe and passes the result in. Advertise a price only when we know
 * it: the resolved amount, or 0 for an event configured with an explicit $0
 * price. An event whose fee simply isn't set yet, or one whose price we
 * couldn't resolve, omits the field rather than inventing a number — schema
 * that disagrees with the visible page reads as spam, and "free" is a claim
 * we'd have to honour at checkout.
 */
function priceFields(price?: EventPrice): Record<string, string> {
  if (price?.kind === 'priced') {
    return { price: (price.cents / 100).toFixed(2), priceCurrency: price.currency.toUpperCase() }
  }
  if (price?.kind === 'free') return { price: '0', priceCurrency: 'USD' }
  return {}
}

// ── The competition series (EventSeries) ─────────────────────────────────────

const SERIES_URL = `${WWW}/competitions`

/**
 * The competition themes, keyed by the Sanity `type` value. One entry per theme
 * with a stable @id, so every page that mentions a series points at one entity.
 */
const SERIES: Record<string, { slug: string; description: string }> = {
  'Space Design Challenge': {
    slug: 'space-design-challenge',
    description:
      'A Stellr industry-simulation STEM competition where student teams tackle real-world space and aerospace design challenges mentored by industry professionals.',
  },
  'Environmental Design Challenge': {
    slug: 'environmental-design-challenge',
    description:
      'A Stellr industry-simulation STEM competition where student teams tackle real-world environmental and sustainability design challenges mentored by industry professionals.',
  },
}

const GENERIC_SERIES = 'Stellr Design Competition'

/**
 * One event making up a series, with its fee already resolved from Stripe.
 * Built by `getSeriesMembers()` in lib/schema-series.ts — this module stays
 * free of Stripe and Sanity calls so it can be unit-tested as a pure builder.
 */
export interface SeriesMember {
  event: SchemaEvent
  price?: EventPrice
}

/**
 * The events that describe a series right now: this theme's, still to run, and
 * not cancelled. Past events are left out deliberately — the series node exists
 * to say what is coming, and a window stretching back over retired events makes
 * the whole series look finished.
 */
function membersOf(name: string, members: readonly SeriesMember[]): SeriesMember[] {
  const today = todayInAppZone()
  return members.filter(({ event }) => {
    if ((event.type || GENERIC_SERIES) !== name) return false
    if (event.status === 'cancelled') return false
    const ends = event.endDate ?? event.date
    return Boolean(ends) && ends! >= today
  })
}

/**
 * The fee range across a series as an AggregateOffer. Only resolved prices
 * count, and a member priced in another currency is skipped rather than
 * flattened into the first one — an invented range is worse than no range, so
 * with nothing resolvable this returns undefined and `offers` is omitted.
 */
function aggregateOffer(members: readonly SeriesMember[]) {
  const amounts: number[] = []
  let currency: string | undefined
  for (const { price } of members) {
    if (price?.kind === 'priced') {
      const code = price.currency.toUpperCase()
      currency ??= code
      if (code === currency) amounts.push(price.cents / 100)
    } else if (price?.kind === 'free') {
      amounts.push(0)
    }
  }
  if (amounts.length === 0) return undefined
  return {
    '@type': 'AggregateOffer',
    priceCurrency: currency ?? 'USD',
    lowPrice: Math.min(...amounts).toFixed(2),
    highPrice: Math.max(...amounts).toFixed(2),
    offerCount: amounts.length,
    availability: members.some((m) => availabilityFor(m.event) === IN_STOCK) ? IN_STOCK : SOLD_OUT,
    url: SERIES_URL,
  }
}

/**
 * The competition theme as an EventSeries — used both as `superEvent` on an
 * event page and as the top-level node on /competitions.
 *
 * Every field is derived from `members` (the theme's upcoming events) or is a
 * constant true of the series as a whole. With no members the node still names
 * and describes itself but carries no dates, place or fee: an incomplete node
 * is a warning, an invented one is a lie.
 */
export function competitionSeries(
  type?: string,
  members: readonly SeriesMember[] = [],
  opts: { subEvents?: boolean } = {},
) {
  const name = type || GENERIC_SERIES
  const meta = SERIES[name]
  const mine = membersOf(name, members)

  const starts = mine
    .map((m) => dateTime(m.event.date, m.event.startTime))
    .filter((d): d is string => Boolean(d))
    .sort()
  const ends = mine
    .map((m) => dateTime(m.event.endDate ?? m.event.date, m.event.endTime))
    .filter((d): d is string => Boolean(d))
    .sort()
  const virtual = mine.filter((m) => isVirtual(m.event)).length
  // Deduped because two events at one venue would otherwise list it twice.
  const locations = [
    ...new Map(
      mine.map((m) => {
        const loc = eventLocation(m.event, eventUrl(m.event.slug.current))
        return [JSON.stringify(loc), loc]
      }),
    ).values(),
  ]
  const illustrated = mine.find((m) => m.event.image)

  return {
    '@type': 'EventSeries',
    '@id': meta ? `${SERIES_URL}#${meta.slug}` : undefined,
    name,
    description: meta?.description,
    url: SERIES_URL,
    organizer: ORGANIZER,
    // Stellr staff brief, run and judge every event; the student teams are the
    // entrants, not the performers. `performer` is on Google's recommended list.
    performer: ORGANIZER,
    // The series is running — a cancelled or postponed date is a property of
    // that individual event, which carries its own eventStatus.
    eventStatus: EVENT_STATUS.scheduled,
    eventAttendanceMode:
      mine.length === 0
        ? undefined
        : virtual === mine.length
        ? ONLINE_MODE
        : virtual === 0
        ? OFFLINE_MODE
        : MIXED_MODE,
    startDate: starts[0],
    endDate: ends[ends.length - 1],
    location: locations.length === 1 ? locations[0] : locations,
    image: imageFor(illustrated?.event.image),
    offers: aggregateOffer(mine),
    // References, not copies: each event's full node lives on its own page, and
    // repeating it here would duplicate a dozen entities on one URL.
    subEvent: opts.subEvents
      ? mine.map((m) => ({ '@id': `${eventUrl(m.event.slug.current)}#event` }))
      : undefined,
  }
}

/** The competition themes as EventSeries, for the /competitions page. */
export function buildCompetitionSeriesJsonLd(members: readonly SeriesMember[] = []) {
  return Object.keys(SERIES).map((name) =>
    prune({
      '@context': 'https://schema.org',
      ...competitionSeries(name, members, { subEvents: true }),
    }),
  )
}

// ── Events and campaigns ─────────────────────────────────────────────────────

/**
 * JSON-LD for a live Event detail page (/events/[slug]). In-person or virtual.
 *
 * Returns null for an event with no date. Google requires startDate, so a
 * dateless event has no valid Event node to publish — emitting one with
 * `"startDate": null`, as this used to, is a malformed entity.
 */
export function buildEventJsonLd(
  event: SchemaEvent,
  slug: string,
  opts: { price?: EventPrice; series?: readonly SeriesMember[] } = {},
) {
  const url = eventUrl(slug)
  const startDate = dateTime(event.date, event.startTime)
  if (!startDate) return null

  return prune({
    '@context': 'https://schema.org',
    '@type': 'Event',
    '@id': `${url}#event`,
    name: event.title,
    description: event.tagline,
    startDate,
    endDate: dateTime(event.endDate ?? event.date, event.endTime),
    // Google shows the original date on a rescheduled event, and only then.
    previousStartDate: event.status === 'rescheduled' ? event.previousStartDate : undefined,
    eventStatus: eventStatusUrl(event.status),
    eventAttendanceMode: attendanceModeFor(event),
    location: eventLocation(event, url),
    maximumAttendeeCapacity: event.capacity,
    superEvent: event.type ? competitionSeries(event.type, opts.series) : undefined,
    organizer: ORGANIZER,
    performer: ORGANIZER,
    image: imageFor(event.image),
    offers: {
      '@type': 'Offer',
      availability: availabilityFor(event),
      url: `${WWW}/register/${slug}`,
      validFrom: event.registrationOpenDate,
      validThrough: event.registrationCloseDate,
      ...priceFields(opts.price),
    },
    inLanguage: 'en-US',
    url,
  })
}

/**
 * JSON-LD for a Campaign (remote/online, free) rendered at /events/[slug].
 * Returns null when the campaign has no season/year to derive its dates from.
 */
export function buildCampaignJsonLd(
  event: SchemaEvent,
  slug: string,
  opts: { series?: readonly SeriesMember[] } = {},
) {
  const url = eventUrl(slug)
  const dates =
    event.season && event.campaignYear
      ? getCampaignDates(event.season as CampaignSeason, event.campaignYear)
      : null
  if (!dates) return null

  return prune({
    '@context': 'https://schema.org',
    '@type': 'Event',
    '@id': `${url}#event`,
    name: event.title,
    description: event.tagline,
    startDate: dates.startDate,
    endDate: dates.endDate,
    eventStatus: eventStatusUrl(event.status),
    eventAttendanceMode: ONLINE_MODE,
    location: { '@type': 'VirtualLocation', url },
    superEvent: event.type ? competitionSeries(event.type, opts.series) : undefined,
    organizer: ORGANIZER,
    performer: ORGANIZER,
    image: imageFor(event.image),
    // Campaigns are always free to join. `registrationOpen` is the real gate the
    // registration API honours, so the offer follows it rather than the term dates.
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
      availability: event.registrationOpen === false ? SOLD_OUT : IN_STOCK,
      validFrom: dates.registrationOpens,
      validThrough: dates.registrationCloses,
      url,
    },
    isAccessibleForFree: true,
    inLanguage: 'en-US',
    url,
  })
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

