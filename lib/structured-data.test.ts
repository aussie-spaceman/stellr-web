import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// `urlFor` needs a configured Sanity project; the builders only ever ask it for
// a URL string, so a stub keeps these tests pure.
vi.mock('@/lib/sanity', () => ({
  urlFor: () => ({
    width: () => ({ height: () => ({ url: () => 'https://cdn.example/event.jpg' }) }),
  }),
}))

import {
  prune,
  eventStatusUrl,
  competitionSeries,
  buildCompetitionSeriesJsonLd,
  buildEventJsonLd,
  buildCampaignJsonLd,
  type SeriesMember,
} from './structured-data'
import type { StellarEvent } from './sanity'

// Registration status and the series window are both "as of today", so every
// test runs on a fixed date: 2026-09-08, between the Colorado event's
// registration opening and the event itself.
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-08T12:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
})

const colorado: StellarEvent = {
  _id: 'e-co',
  title: 'Colorado Space Design Challenge',
  slug: { current: 'colorado-space-design-challenge' },
  type: 'Space Design Challenge',
  date: '2026-10-03',
  setting: 'in_person',
  venue: 'STEM Academy',
  city: 'Highlands Ranch',
  state: 'Colorado',
  tagline: 'Humanity’s place in the solar system. In your hands.',
  image: { asset: { _ref: 'image-abc-1140x641-jpg' } },
  registrationOpenDate: '2026-08-17',
  registrationCloseDate: '2026-09-26',
  capacity: 120,
  latitude: 39.5407,
  longitude: -104.9689,
}

const uruguay: StellarEvent = {
  _id: 'e-uy',
  title: 'Uruguay Environmental Design Challenge',
  slug: { current: 'uruguay-environmental-design-challenge' },
  type: 'Environmental Design Challenge',
  setting: 'in_person',
  venue: 'BEM Local',
  city: 'Maldonado',
  state: 'Departamento de Maldonado',
  country: 'UY',
}

const campaign: StellarEvent = {
  _id: 'c-fall',
  title: 'Space Design Campaign — Fall',
  slug: { current: 'space-design-campaign-fall' },
  type: 'Space Design Challenge',
  activityType: 'campaign',
  season: 'fall',
  campaignYear: 2027,
  tagline: 'Run the challenge in your own classroom.',
  registrationOpen: true,
}

const members: SeriesMember[] = [
  { event: colorado, price: { kind: 'priced', cents: 7500, currency: 'usd' } },
  {
    event: { ...uruguay, date: '2026-11-14' },
    price: { kind: 'priced', cents: 5000, currency: 'usd' },
  },
]

// Google's Event requirements: three required fields, and the recommended set
// whose absence is exactly what Search Console reported.
const REQUIRED = ['name', 'startDate', 'location'] as const
const RECOMMENDED = [
  'description',
  'endDate',
  'eventAttendanceMode',
  'eventStatus',
  'image',
  'offers',
  'organizer',
  'performer',
  'url',
] as const

type Node = Record<string, unknown>

/** Every Event-typed node in a graph, however deeply nested. */
function eventNodes(node: unknown, found: Node[] = []): Node[] {
  if (Array.isArray(node)) {
    node.forEach((n) => eventNodes(n, found))
    return found
  }
  if (!node || typeof node !== 'object') return found
  const obj = node as Node
  const types = [obj['@type']].flat()
  if (types.some((t) => typeof t === 'string' && t.includes('Event'))) found.push(obj)
  Object.values(obj).forEach((v) => eventNodes(v, found))
  return found
}

function nullPaths(node: unknown, path = '', found: string[] = []): string[] {
  if (node === null) found.push(path)
  else if (node && typeof node === 'object') {
    Object.entries(node as Node).forEach(([k, v]) => nullPaths(v, `${path}/${k}`, found))
  }
  return found
}

describe('prune', () => {
  it('drops nulls, which GROQ returns for every unset field', () => {
    // JSON.stringify drops undefined but serialises null, which is how
    // "startDate": null reached production for a dateless event.
    expect(prune({ a: 1, b: null, c: undefined })).toEqual({ a: 1 })
  })

  it('drops an object left with nothing but its @type, and keeps @id references', () => {
    const node = { '@type': 'Event', name: 'X' }
    expect(prune({ ...node, address: { '@type': 'PostalAddress', addressLocality: null } })).toEqual(node)
    expect(prune({ ...node, superEvent: { '@id': 'https://x/#series' } })).toEqual({
      ...node,
      superEvent: { '@id': 'https://x/#series' },
    })
  })

  it('prunes inside arrays and drops the array when nothing survives', () => {
    const node = { '@type': 'Event', name: 'X' }
    expect(prune({ ...node, location: [{ '@type': 'Place' }, null] })).toEqual(node)
    expect(prune({ ...node, location: [{ '@type': 'Place', name: 'A' }, null] })).toEqual({
      ...node,
      location: [{ '@type': 'Place', name: 'A' }],
    })
  })
})

describe('eventStatusUrl', () => {
  it('maps the CMS lifecycle states, defaulting to scheduled', () => {
    expect(eventStatusUrl('cancelled')).toBe('https://schema.org/EventCancelled')
    expect(eventStatusUrl('moved_online')).toBe('https://schema.org/EventMovedOnline')
    expect(eventStatusUrl(undefined)).toBe('https://schema.org/EventScheduled')
    expect(eventStatusUrl('nonsense')).toBe('https://schema.org/EventScheduled')
  })
})

describe('buildEventJsonLd', () => {
  it('publishes no Event node for an event with no date', () => {
    // Google requires startDate: a node carrying "startDate": null is a
    // malformed entity, which is worse than no markup at all.
    expect(buildEventJsonLd(uruguay, uruguay.slug.current)).toBeNull()
  })

  it('carries every required and recommended field', () => {
    const node = buildEventJsonLd(colorado, colorado.slug.current, {
      price: { kind: 'priced', cents: 7500, currency: 'usd' },
      series: members,
    })!
    for (const field of [...REQUIRED, ...RECOMMENDED]) expect(node[field]).toBeDefined()
    expect(node.url).toBe(
      'https://www.stellreducation.org/events/colorado-space-design-challenge',
    )
    expect(node.maximumAttendeeCapacity).toBe(120)
  })

  it('normalises a US state to its USPS code and keeps the venue geo', () => {
    const node = buildEventJsonLd(colorado, colorado.slug.current)! as Node
    const location = node.location as Node
    expect((location.address as Node).addressRegion).toBe('CO')
    expect((location.address as Node).addressCountry).toBe('US')
    expect(location.geo).toEqual({
      '@type': 'GeoCoordinates',
      latitude: 39.5407,
      longitude: -104.9689,
    })
  })

  it('does not put a non-US venue in the United States', () => {
    const node = buildEventJsonLd({ ...uruguay, date: '2026-11-14' }, uruguay.slug.current)!
    const address = (node.location as Node).address as Node
    expect(address.addressCountry).toBe('UY')
    expect(address.addressRegion).toBe('Departamento de Maldonado')
  })

  it('advertises the resolved fee, and nothing when it could not be resolved', () => {
    const priced = buildEventJsonLd(colorado, colorado.slug.current, {
      price: { kind: 'priced', cents: 7500, currency: 'usd' },
    })!
    expect(priced.offers).toMatchObject({ price: '75.00', priceCurrency: 'USD' })

    const free = buildEventJsonLd(colorado, colorado.slug.current, { price: { kind: 'free' } })!
    expect(free.offers).toMatchObject({ price: '0', priceCurrency: 'USD' })

    for (const price of [{ kind: 'tbc' } as const, { kind: 'unavailable' } as const]) {
      const node = buildEventJsonLd(colorado, colorado.slug.current, { price })!
      expect(node.offers).not.toHaveProperty('price')
    }
  })

  it('tracks availability with the registration window the page shows', () => {
    const open = buildEventJsonLd(colorado, colorado.slug.current)!
    expect((open.offers as Node).availability).toBe('https://schema.org/InStock')
    expect((open.offers as Node).validThrough).toBe('2026-09-26')

    const closed = buildEventJsonLd(
      { ...colorado, registrationCloseDate: '2026-09-01' },
      colorado.slug.current,
    )!
    expect((closed.offers as Node).availability).toBe('https://schema.org/SoldOut')

    const soon = buildEventJsonLd(
      { ...colorado, registrationOpenDate: '2026-09-20' },
      colorado.slug.current,
    )!
    expect((soon.offers as Node).availability).toBe('https://schema.org/PreOrder')
  })

  it('reports a cancelled event as cancelled and not on sale', () => {
    const node = buildEventJsonLd({ ...colorado, status: 'cancelled' }, colorado.slug.current)!
    expect(node.eventStatus).toBe('https://schema.org/EventCancelled')
    expect((node.offers as Node).availability).toBe('https://schema.org/SoldOut')
  })

  it('gives a rescheduled event its original date, and only then', () => {
    const moved = buildEventJsonLd(
      { ...colorado, status: 'rescheduled', previousStartDate: '2026-09-12' },
      colorado.slug.current,
    )!
    expect(moved.previousStartDate).toBe('2026-09-12')

    const scheduled = buildEventJsonLd(
      { ...colorado, previousStartDate: '2026-09-12' },
      colorado.slug.current,
    )!
    expect(scheduled.previousStartDate).toBeUndefined()
  })

  it('treats an event moved online as virtual whatever venue is still on it', () => {
    const node = buildEventJsonLd({ ...colorado, status: 'moved_online' }, colorado.slug.current)!
    expect(node.eventAttendanceMode).toBe('https://schema.org/OnlineEventAttendanceMode')
    expect(node.location).toEqual({
      '@type': 'VirtualLocation',
      url: 'https://www.stellreducation.org/events/colorado-space-design-challenge',
    })
  })

  it('adds authored times to the dates, and stays date-only without them', () => {
    const timed = buildEventJsonLd(
      { ...colorado, startTime: '09:00', endTime: '16:30' },
      colorado.slug.current,
    )!
    expect(timed.startDate).toBe('2026-10-03T09:00')
    expect(timed.endDate).toBe('2026-10-03T16:30')

    const untimed = buildEventJsonLd(colorado, colorado.slug.current)!
    expect(untimed.startDate).toBe('2026-10-03')
    // No end time: the day, not the start instant repeated as the end.
    expect(untimed.endDate).toBe('2026-10-03')

    const nonsense = buildEventJsonLd({ ...colorado, startTime: '9am' }, colorado.slug.current)!
    expect(nonsense.startDate).toBe('2026-10-03')
  })
})

describe('competitionSeries', () => {
  it('describes itself from the events that make it up', () => {
    const series = competitionSeries('Space Design Challenge', members) as Node
    expect(series['@id']).toBe(
      'https://www.stellreducation.org/competitions#space-design-challenge',
    )
    expect(series.startDate).toBe('2026-10-03')
    expect(series.endDate).toBe('2026-10-03')
    // Only the Space events count towards this series.
    expect(series.offers).toMatchObject({
      '@type': 'AggregateOffer',
      lowPrice: '75.00',
      highPrice: '75.00',
      offerCount: 1,
    })
    for (const field of [...REQUIRED, ...RECOMMENDED]) expect(series[field]).toBeDefined()
  })

  it('spans its members and reports a mixed series as mixed', () => {
    const series = competitionSeries('Environmental Design Challenge', [
      ...members,
      {
        event: {
          ...colorado,
          _id: 'e-va',
          slug: { current: 'virtual-enviro' },
          type: 'Environmental Design Challenge',
          setting: 'virtual',
          date: '2026-12-01',
        },
        price: { kind: 'free' },
      },
    ]) as Node
    expect(series.startDate).toBe('2026-11-14')
    expect(series.endDate).toBe('2026-12-01')
    expect(series.eventAttendanceMode).toBe('https://schema.org/MixedEventAttendanceMode')
    expect(series.offers).toMatchObject({ lowPrice: '0.00', highPrice: '50.00', offerCount: 2 })
  })

  it('leaves out events that have been and gone, and cancelled ones', () => {
    const series = competitionSeries('Space Design Challenge', [
      { event: { ...colorado, _id: 'past', date: '2026-04-01' } },
      { event: { ...colorado, _id: 'off', date: '2026-12-05', status: 'cancelled' } },
      ...members,
    ]) as Node
    expect(series.startDate).toBe('2026-10-03')
    expect(series.endDate).toBe('2026-10-03')
  })

  it('states no dates, place or fee when it has no events, rather than inventing them', () => {
    const series = competitionSeries('Space Design Challenge') as Node
    // It still names, describes and attributes itself — it just can't claim a
    // date, a venue or a fee it has no event to derive one from.
    expect(series.name).toBe('Space Design Challenge')
    expect(series.organizer).toBeDefined()
    expect(series.eventStatus).toBeDefined()
    expect(prune(series)).not.toHaveProperty('startDate')
    expect(prune(series)).not.toHaveProperty('offers')
    expect(prune(series)).not.toHaveProperty('location')
    expect(series.description).toBeDefined()
  })
})

describe('buildCompetitionSeriesJsonLd', () => {
  it('publishes both themes, each pointing at its own events', () => {
    const graph = buildCompetitionSeriesJsonLd(members)
    expect(graph).toHaveLength(2)
    expect(graph.map((s) => s.name)).toEqual([
      'Space Design Challenge',
      'Environmental Design Challenge',
    ])
    expect((graph[0] as Node).subEvent).toEqual([
      {
        '@id':
          'https://www.stellreducation.org/events/colorado-space-design-challenge#event',
      },
    ])
  })
})

describe('buildCampaignJsonLd', () => {
  it('publishes no node for a campaign with no season to derive dates from', () => {
    expect(buildCampaignJsonLd({ ...campaign, season: undefined }, 'x')).toBeNull()
  })

  it('is a free online event over the campaign term', () => {
    const node = buildCampaignJsonLd(campaign, campaign.slug.current, { series: members })!
    expect(node.startDate).toBe('2026-08-15')
    expect(node.endDate).toBe('2026-12-15')
    expect(node.eventAttendanceMode).toBe('https://schema.org/OnlineEventAttendanceMode')
    expect(node.offers).toMatchObject({
      price: '0',
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
      validThrough: '2026-11-30',
    })
    for (const field of [...REQUIRED, ...RECOMMENDED]) expect(node[field]).toBeDefined()
  })

  it('closes the offer when registration is switched off', () => {
    const node = buildCampaignJsonLd({ ...campaign, registrationOpen: false }, 'x')!
    expect((node.offers as Node).availability).toBe('https://schema.org/SoldOut')
  })
})

// The regression guard: whatever a builder produces, every Event-typed node in
// it — nested series included — must satisfy Google's field set and contain no
// nulls. This is the check that was missing when the bare `superEvent` stub and
// the dateless series shipped.
describe('the published graph', () => {
  const graphs: Record<string, unknown> = {
    event: buildEventJsonLd(colorado, colorado.slug.current, {
      price: { kind: 'priced', cents: 7500, currency: 'usd' },
      series: members,
    }),
    campaign: buildCampaignJsonLd(campaign, campaign.slug.current, { series: members }),
    competitions: buildCompetitionSeriesJsonLd(members),
  }

  for (const [name, graph] of Object.entries(graphs)) {
    it(`has no missing fields in any Event node on ${name}`, () => {
      const nodes = eventNodes(graph)
      expect(nodes.length).toBeGreaterThan(0)
      for (const node of nodes) {
        const missing = [...REQUIRED, ...RECOMMENDED].filter((f) => node[f] === undefined)
        expect({ node: node.name, missing }).toEqual({ node: node.name, missing: [] })
      }
    })

    it(`serialises no nulls on ${name}`, () => {
      expect(nullPaths(graph)).toEqual([])
    })
  }
})
