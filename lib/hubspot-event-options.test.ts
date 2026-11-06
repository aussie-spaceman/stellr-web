import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => {}) }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({}) }))
vi.mock('@/lib/sanity', () => ({ getEventsForHubspotSync: vi.fn(async () => null) }))
vi.mock('next/server', () => ({ after: (fn: () => unknown) => fn() }))

// lib/hubspot reads the token once at import, so it must be set beforehand.
vi.stubEnv('HUBSPOT_ACCESS_TOKEN', 'test-token')

const { desiredOptions, findStaleValues, liveEventsForCrm, planOptions, syncEventOptions } =
  await import('./hubspot-event-options')
type HubSpotOption = import('./hubspot-event-options').HubSpotOption

/**
 * The option lists these tests defend are the CRM's history. Sanity holds only
 * the current season; HubSpot is the one place a 2025 Texas participant is
 * recorded as one. So the contract is: follow Sanity for what is SHOWN, never
 * for what EXISTS — retire by hiding, never by deleting.
 */

const NOW = new Date('2026-10-12T12:00:00Z') // school year 2027

/** The published Sanity events as of 12 Oct 2026, with the launch overrides. */
const EVENTS = [
  {
    slug: 'colorado-space-design-challenge',
    type: 'Space Design Challenge',
    activityType: 'live_event',
    gradeLevel: 'Both', gradeMin: 7, gradeMax: 12,
    date: '2026-10-03', setting: 'in_person', city: 'Highlands Ranch', state: 'Colorado',
    hubspotLocation: 'Colorado [Denver]',
  },
  {
    slug: 'nevada-space-design-challenge', type: 'Space Design Challenge', activityType: 'live_event',
    gradeLevel: 'High School', date: '2026-11-06', setting: 'in_person', city: 'Las Vegas', state: 'NV',
  },
  {
    slug: 'minnesota-environmental-design-challenge', type: 'Environmental Design Challenge',
    activityType: 'live_event', gradeLevel: 'Both', gradeMin: 7, gradeMax: 12,
    date: '2026-11-24', setting: 'in_person', city: 'Mankato', state: 'MN',
  },
  {
    slug: 'space-design-campaign-fall', type: 'Space Design Challenge', activityType: 'campaign',
    gradeLevel: 'High School', season: 'fall', campaignYear: 2027,
  },
  {
    slug: 'environmental-design-campaign-fall', type: 'Environmental Design Challenge',
    activityType: 'campaign', gradeLevel: 'High School', season: 'fall', campaignYear: 2027,
  },
  {
    slug: 'texas-space-design-competition', type: 'Space Design Challenge', activityType: 'live_event',
    gradeLevel: 'High School', date: '2027-01-30', setting: 'in_person', city: 'Austin', state: 'Texas',
  },
  {
    slug: 'nebraska-space-design-challenge', type: 'Space Design Challenge', activityType: 'live_event',
    gradeLevel: 'High School', date: '2027-02-11', setting: 'in_person', city: 'Ashland', state: 'Nebraska',
    hubspotLocation: 'Nebraska [SAC Museum]',
  },
  {
    slug: 'colorado-environmental-design-challenge', type: 'Environmental Design Challenge',
    activityType: 'live_event', gradeLevel: 'High School', date: '2027-03-11', setting: 'in_person',
    city: 'Denver', state: 'CO',
  },
  {
    slug: 'south-dakota-space-design-challenge', type: 'Space Design Challenge', activityType: 'live_event',
    gradeLevel: 'High School', date: '2027-03-13', setting: 'in_person', city: 'Brookings',
    state: 'South Dakota', status: 'scheduled',
  },
  {
    slug: 'uruguay-environmental-design-challenge', type: 'Environmental Design Challenge',
    activityType: 'live_event', gradeLevel: 'High School', gradeMin: 8, date: '2027-09-09',
    setting: 'in_person', city: 'Maldonado', state: 'Departamento de Maldonado', country: 'UY',
    hubspotLocation: 'Uruguay',
  },
]

/** A past season's event and a cancelled one — neither is live. */
const NOT_LIVE = [
  {
    slug: 'north-carolina-space-design-challenge', type: 'Space Design Challenge',
    gradeLevel: 'High School', date: '2026-04-10', setting: 'in_person', city: 'Raleigh', state: 'NC',
  },
  {
    slug: 'arizona-space-design-challenge', type: 'Space Design Challenge', status: 'cancelled',
    gradeLevel: 'High School', date: '2027-02-01', setting: 'in_person', city: 'Phoenix', state: 'AZ',
  },
]

function opts(values: string[], hidden: string[] = []): HubSpotOption[] {
  return values.map((value, displayOrder) => ({
    label: value,
    value,
    displayOrder,
    hidden: hidden.includes(value),
  }))
}

/** The contact Event Location options in the portal on 12 Oct 2026. */
const CONTACT_LOCATIONS = opts([
  'Nevada [Las Vegas]', 'Virtual [Zoom + Discord]', 'Colorado [Denver]', 'North Carolina [Raleigh]',
  'South Dakota [Brookings]', 'Minnesota [Mankato]', 'Texas [Houston]', 'ISSDC Finals',
  'Pennsylvania [Lehigh]', 'Nebraska [SAC Museum]', 'Uruguay', 'Arizona [BS2]',
  'Washington State [Raisbeck]',
])

/** The deal Event Location options: right labels, wrong stored values. */
const DEAL_LOCATIONS: HubSpotOption[] = [
  { value: 'Nevada (Las Vegas)', label: 'Nevada [Las Vegas]', displayOrder: 0 },
  { value: 'Canada (Virtual)', label: 'Virtual [Zoom + Discord]', displayOrder: 1 },
  { value: 'Rocky Mountain (Denver)', label: 'Colorado [Denver]', displayOrder: 2 },
  { value: 'Iowa', label: 'North Carolina [Raleigh]', displayOrder: 3 },
  { value: 'South Dakota', label: 'South Dakota [Brookings]', displayOrder: 4 },
  { value: 'Minnesota [Mankato]', label: 'Minnesota [Mankato]', displayOrder: 5 },
]

const visible = (options: HubSpotOption[]) => options.filter((o) => !o.hidden).map((o) => o.value)
const hidden = (options: HubSpotOption[]) => options.filter((o) => o.hidden).map((o) => o.value)

describe('liveEventsForCrm', () => {
  it('keeps this school year and later, drops past seasons and cancellations', () => {
    const live = liveEventsForCrm([...EVENTS, ...NOT_LIVE], NOW).map((e) => e.slug)
    expect(live).toHaveLength(EVENTS.length)
    expect(live).not.toContain('north-carolina-space-design-challenge')
    expect(live).not.toContain('arizona-space-design-challenge')
  })

  it('keeps an event already held until its school year ends on 1 August', () => {
    const colorado = EVENTS.slice(0, 1)
    expect(liveEventsForCrm(colorado, new Date('2027-07-31T12:00:00Z'))).toHaveLength(1)
    expect(liveEventsForCrm(colorado, new Date('2027-08-01T12:00:00Z'))).toHaveLength(0)
  })
})

describe('desiredOptions', () => {
  const { specs, unmapped } = desiredOptions([...EVENTS, ...NOT_LIVE], NOW)

  it('lists each live location once, in date order, campaigns last', () => {
    expect(specs.event.live).toEqual([
      'Colorado [Denver]', // both Colorado events share the label; the earlier date ranks it
      'Nevada [Las Vegas]',
      'Minnesota [Mankato]',
      'Texas [Austin]',
      'Nebraska [SAC Museum]',
      'South Dakota [Brookings]',
      'Uruguay',
      'Campaign [Fall]',
    ])
  })

  it('takes years from the school year, so September 2027 Uruguay is 2028', () => {
    expect(specs.event_year.live).toEqual(['2027', '2028'])
    expect(specs.event_year.keepVisible('2023')).toBe(true) // history stays visible
    expect(specs.event_year.keepVisible('2029')).toBe(false) // no event yet
  })

  it('derives themes and demographics from the events, keeping College pinned', () => {
    expect(specs.event_theme.live).toEqual(['Space', 'Environmental'])
    expect(specs.event_demographic.live).toEqual(['Middle School', 'High School'])
    expect(specs.event_demographic.keepVisible('College')).toBe(true)
  })

  it('maps every event live today', () => {
    expect(unmapped).toEqual([])
  })
})

describe('planOptions', () => {
  const { specs } = desiredOptions(EVENTS, NOW)

  it('produces the contact Location diff: add the new, hide the retired, delete nothing', () => {
    const plan = planOptions(CONTACT_LOCATIONS, specs.event)!
    expect(plan.changes.added).toEqual(['Texas [Austin]', 'Campaign [Fall]'])
    expect(plan.changes.hidden.sort()).toEqual(
      [
        'Virtual [Zoom + Discord]', 'North Carolina [Raleigh]', 'Texas [Houston]', 'ISSDC Finals',
        'Pennsylvania [Lehigh]', 'Arizona [BS2]', 'Washington State [Raisbeck]',
      ].sort(),
    )
    expect(plan.changes.dropped).toEqual([])
    // Every option that existed still exists — only its visibility changed.
    for (const { value } of CONTACT_LOCATIONS) {
      expect(plan.options.map((o) => o.value)).toContain(value)
    }
    // Live options lead the dropdown, in the spec's order.
    expect(visible(plan.options)).toEqual(specs.event.live)
    expect(plan.options.map((o) => o.displayOrder)).toEqual(plan.options.map((_, i) => i))
  })

  it('unhides an option when its location comes back', () => {
    const plan = planOptions(opts(['Nevada [Las Vegas]', 'Uruguay'], ['Uruguay']), {
      live: ['Nevada [Las Vegas]', 'Uruguay'],
      keepVisible: () => false,
    })!
    expect(plan.changes.unhidden).toEqual(['Uruguay'])
    expect(hidden(plan.options)).toEqual([])
  })

  it('keeps past years visible and hides future years with no event', () => {
    const years = opts(['2023', '2024', '2025', '2026', '2027', '2028', '2029', '2030'])
    const plan = planOptions(years, specs.event_year)!
    expect(visible(plan.options)).toEqual(['2023', '2024', '2025', '2026', '2027', '2028'])
    expect(plan.changes.hidden).toEqual(['2029', '2030'])
  })

  it('adds a year the deal property lacks, in numeric order', () => {
    const plan = planOptions(opts(['2023', '2024', '2025', '2026', '2027']), specs.event_year)!
    expect(plan.changes.added).toEqual(['2028'])
    expect(visible(plan.options)).toEqual(['2023', '2024', '2025', '2026', '2027', '2028'])
  })

  it('never hides College, though no event produces it', () => {
    const plan = planOptions(opts(['Middle School', 'High School', 'College']), specs.event_demographic)
    expect(plan).toBeNull()
  })

  it('hides themes with no live event', () => {
    const plan = planOptions(
      opts(['Space', 'Environmental', 'Life Sciences', 'Resources']),
      specs.event_theme,
    )!
    expect(plan.changes.hidden).toEqual(['Life Sciences', 'Resources'])
  })

  it('returns null when the options already match', () => {
    const once = planOptions(CONTACT_LOCATIONS, specs.event)!
    expect(planOptions(once.options, specs.event)).toBeNull()
  })

  describe('stale values (the deal "Iowa" behind "North Carolina [Raleigh]")', () => {
    it('finds options whose label is a value we need but whose value differs', () => {
      expect(findStaleValues(DEAL_LOCATIONS, specs.event).sort()).toEqual(
        ['Nevada (Las Vegas)', 'Rocky Mountain (Denver)', 'South Dakota'].sort(),
      )
    })

    it('drops a stale value only when a count proves no record holds it', () => {
      const plan = planOptions(DEAL_LOCATIONS, specs.event, {
        'Nevada (Las Vegas)': 0,
        'Rocky Mountain (Denver)': 0,
        'South Dakota': 0,
      })!
      expect(plan.changes.dropped.sort()).toEqual(
        ['Nevada (Las Vegas)', 'Rocky Mountain (Denver)', 'South Dakota'].sort(),
      )
      expect(visible(plan.options)).toEqual(specs.event.live)
      // Not stale (no live label collides), so retired the ordinary way.
      expect(hidden(plan.options)).toEqual(['Canada (Virtual)', 'Iowa'])
      // One option per label — HubSpot rejects duplicates.
      const labels = plan.options.map((o) => o.label)
      expect(new Set(labels).size).toBe(labels.length)
    })

    it('relabels and hides a stale value still in use, or one it could not count', () => {
      const plan = planOptions(DEAL_LOCATIONS, specs.event, { 'Nevada (Las Vegas)': 4 })!
      expect(plan.changes.dropped).toEqual([])
      expect(plan.changes.relabelled.sort()).toEqual(
        ['Nevada (Las Vegas)', 'Rocky Mountain (Denver)', 'South Dakota'].sort(),
      )
      const legacy = plan.options.find((o) => o.value === 'Nevada (Las Vegas)')!
      expect(legacy).toMatchObject({ label: 'Nevada [Las Vegas] (legacy: Nevada (Las Vegas))', hidden: true })
      const labels = plan.options.map((o) => o.label)
      expect(new Set(labels).size).toBe(labels.length)
    })
  })
})

describe('syncEventOptions', () => {
  type Call = { url: string; method: string; body?: unknown }
  let calls: Call[]

  function stubPortal(overrides: { dealWrite?: number } = {}) {
    const properties: Record<string, HubSpotOption[]> = {
      'contacts/event': CONTACT_LOCATIONS,
      'contacts/event_year': opts(['2023', '2024', '2025', '2026', '2027', '2028', '2029', '2030']),
      'contacts/event_theme': opts(['Space', 'Environmental', 'Life Sciences', 'Resources']),
      'contacts/event_demographic': opts(['Middle School', 'High School', 'College']),
      'deals/event': DEAL_LOCATIONS,
      'deals/event_year': opts(['2023', '2024', '2025', '2026', '2027']),
      'deals/event_theme': opts(['Space', 'Environmental', 'Life Sciences', 'Resources']),
      'deals/event_demographic': opts(['Middle School', 'High School', 'College']),
    }
    calls = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET'
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        calls.push({ url, method, body })
        if (url.includes('/search')) return new Response(JSON.stringify({ total: 0 }), { status: 200 })
        const key = url.split('/crm/v3/properties/')[1]
        if (key && method === 'GET') {
          return new Response(JSON.stringify({ options: properties[key] ?? [], description: '' }), {
            status: 200,
          })
        }
        if (key && method === 'PATCH') {
          if (key.startsWith('deals/') && overrides.dealWrite) {
            return new Response('{"message":"missing scope"}', { status: overrides.dealWrite })
          }
          return new Response('{}', { status: 200 })
        }
        return new Response('{}', { status: 404 })
      }),
    )
  }

  beforeEach(() => {
    vi.stubEnv('HUBSPOT_FORM_EVENT_NOTIFY', '')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('refuses to write when Sanity has no live events, rather than hiding everything', async () => {
    stubPortal()
    const result = await syncEventOptions({ apply: true, now: NOW, events: NOT_LIVE, allTenants: true })
    expect(result.refused).toMatch(/No live events/)
    expect(calls).toEqual([])
  })

  describe('stellrOnlyDb', () => {
    /** The first page holds the result; the page after it is empty, as PostgREST's would be. */
    const mirror = (result: { data: unknown; error: unknown }) => {
      const range = async (from: number) => (from === 0 ? result : { data: [], error: null })
      return { from: () => ({ select: () => ({ neq: () => ({ order: () => ({ range }) }) }) }) } as unknown as SupabaseClient
    }

    it('leaves the sync exactly as it was when no other tenant owns an event', async () => {
      stubPortal()
      const plain = await syncEventOptions({ apply: false, now: NOW, events: EVENTS, allTenants: true })
      const plainCalls = calls
      stubPortal()
      const scoped = await syncEventOptions({ apply: false, now: NOW, events: EVENTS, stellrOnlyDb: mirror({ data: [], error: null }) })
      expect(scoped).toEqual(plain)
      expect(calls).toEqual(plainCalls)
    })

    it('leaves out an event another tenant owns', async () => {
      stubPortal()
      const plain = await syncEventOptions({ apply: false, now: NOW, events: EVENTS, allTenants: true })
      const theirs = plain.liveEvents[0]
      expect(EVENTS.map((e) => e.slug)).toContain(theirs)
      stubPortal()
      const scoped = await syncEventOptions({
        apply: false, now: NOW, events: EVENTS, stellrOnlyDb: mirror({ data: [{ slug: theirs, sanity_id: 'sanity-theirs' }], error: null }),
      })
      expect(scoped.liveEvents).toEqual(plain.liveEvents.filter((s) => s !== theirs))
    })

    it('knows a renamed event by its document id, while the mirror still has the old slug', async () => {
      const withIds = EVENTS.map((e) => ({ ...e, _id: `sanity-${e.slug}` }))
      stubPortal()
      const plain = await syncEventOptions({ apply: false, now: NOW, events: withIds, allTenants: true })
      const renamed = plain.liveEvents[0]
      stubPortal()
      const scoped = await syncEventOptions({
        apply: false, now: NOW, events: withIds,
        stellrOnlyDb: mirror({ data: [{ slug: 'the-old-slug', sanity_id: `sanity-${renamed}` }], error: null }),
      })
      expect(scoped.liveEvents).toEqual(plain.liveEvents.filter((s) => s !== renamed))
    })

    it('does not drop a Stellr event that has taken a tenant event\'s old slug', async () => {
      const withIds = EVENTS.map((e) => ({ ...e, _id: `sanity-${e.slug}` }))
      stubPortal()
      const plain = await syncEventOptions({ apply: false, now: NOW, events: withIds, allTenants: true })
      stubPortal()
      const scoped = await syncEventOptions({
        apply: false, now: NOW, events: withIds,
        stellrOnlyDb: mirror({ data: [{ slug: plain.liveEvents[0], sanity_id: 'sanity-some-other-document' }], error: null }),
      })
      expect(scoped.liveEvents).toEqual(plain.liveEvents)
    })

    it('refuses, and writes nothing, when the mirror cannot be read', async () => {
      stubPortal()
      const result = await syncEventOptions({
        apply: true, now: NOW, events: EVENTS, stellrOnlyDb: mirror({ data: null, error: { message: 'down' } }),
      })
      expect(result.refused).toMatch(/which tenant owns/)
      expect(calls).toEqual([])
    })
  })

  it('writes nothing on a dry run', async () => {
    stubPortal()
    const result = await syncEventOptions({ apply: false, now: NOW, events: EVENTS, allTenants: true })
    expect(calls.filter((c) => c.method === 'PATCH')).toEqual([])
    expect(result.properties.find((p) => p.object === 'contacts' && p.property === 'event')?.status).toBe(
      'would-update',
    )
  })

  it('applies the plan with hidden flags and the managed-by note', async () => {
    stubPortal()
    const result = await syncEventOptions({ apply: true, now: NOW, events: EVENTS, allTenants: true })
    expect(result.ok).toBe(true)

    const patch = calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/contacts/event'))!
    const body = patch.body as { options: HubSpotOption[]; description: string }
    expect(body.options.find((o) => o.value === 'Texas [Houston]')).toMatchObject({ hidden: true })
    expect(body.options.find((o) => o.value === 'Texas [Austin]')).toMatchObject({ hidden: false })
    expect(body.description).toMatch(/Options follow Sanity/)
  })

  it('drops the unused stale deal values after counting them', async () => {
    stubPortal()
    await syncEventOptions({ apply: true, now: NOW, events: EVENTS, allTenants: true })
    const searches = calls.filter((c) => c.url.includes('/deals/search'))
    expect(searches).toHaveLength(3)
    const patch = calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/deals/event'))!
    const values = (patch.body as { options: HubSpotOption[] }).options.map((o) => o.value)
    expect(values).not.toContain('Nevada (Las Vegas)')
    expect(values).toContain('Nevada [Las Vegas]')
  })

  it('records a failed object and carries on with the rest', async () => {
    stubPortal({ dealWrite: 403 })
    const result = await syncEventOptions({ apply: true, now: NOW, events: EVENTS, allTenants: true })
    expect(result.ok).toBe(false)
    const contacts = result.properties.filter((p) => p.object === 'contacts')
    expect(contacts.every((p) => p.status !== 'failed')).toBe(true)
    expect(result.properties.find((p) => p.object === 'deals' && p.property === 'event')).toMatchObject({
      status: 'failed',
    })
  })
})
