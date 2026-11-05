// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The facade must return exactly what lib/sanity returns (no behaviour change).
const sanity = vi.hoisted(() => ({
  bySlug: vi.fn(async (slug: string) => ({ _id: 'evt-1', slug: { current: slug }, title: 'Event One' }) as unknown),
  all: vi.fn(async () => [{ _id: 'evt-1' }]),
  campaigns: vi.fn(async () => [{ _id: 'cmp-1' }]),
  bySlugs: vi.fn(async (_s: string[]) => [{ _id: 'evt-1' }]),
  byIds: vi.fn(async (_i: string[]) => [{ _id: 'evt-1' }]),
  featured: vi.fn(async () => [{ _id: 'evt-1' }]),
  survey: vi.fn(async () => [{ _id: 'evt-1' }]),
  hubspot: vi.fn(async () => [{ _id: 'evt-1' }]),
  schema: vi.fn(async () => [{ _id: 'evt-1' }]),
}))
vi.mock('@/lib/sanity', () => ({
  getEventBySlug: sanity.bySlug,
  getAllEvents: sanity.all,
  getAllCampaigns: sanity.campaigns,
  getEventsBySlugs: sanity.bySlugs,
  getEventsByIds: sanity.byIds,
  getFeaturedEvents: sanity.featured,
  getEventsForSurveySchedule: sanity.survey,
  getEventsForHubspotSync: sanity.hubspot,
  getEventsForSchema: sanity.schema,
}))

const {
  getEventBySlug,
  getAllEvents,
  getAllCampaigns,
  getEventsBySlugs,
  getEventsByIds,
  getFeaturedEvents,
  getEventsForSurveySchedule,
  getEventsForHubspotSync,
  getEventsForSchema,
} = await import('./repo')

beforeEach(() => {
  sanity.bySlug.mockClear()
})

describe('events facade: Sanity reads are unchanged', () => {
  it("getEventBySlug returns lib/sanity's result", async () => {
    const ev = await getEventBySlug('nevada')
    expect(sanity.bySlug).toHaveBeenCalledWith('nevada')
    expect(ev).toEqual({ _id: 'evt-1', slug: { current: 'nevada' }, title: 'Event One' })
  })

  it('passes the list reads straight through', async () => {
    expect(await getAllEvents()).toEqual([{ _id: 'evt-1' }])
    expect(await getAllCampaigns()).toEqual([{ _id: 'cmp-1' }])
    expect(await getEventsBySlugs(['a'])).toEqual([{ _id: 'evt-1' }])
    expect(sanity.bySlugs).toHaveBeenCalledWith(['a'])
    expect(await getEventsByIds(['evt-1'])).toEqual([{ _id: 'evt-1' }])
    expect(sanity.byIds).toHaveBeenCalledWith(['evt-1'])
  })

  describe.each([
    ['getEventBySlug', () => getEventBySlug('a-slug'), () => sanity.bySlug, ['a-slug']],
    ['getAllEvents', () => getAllEvents(), () => sanity.all, []],
    ['getAllCampaigns', () => getAllCampaigns(), () => sanity.campaigns, []],
    ['getEventsBySlugs', () => getEventsBySlugs(['a']), () => sanity.bySlugs, [['a']]],
    ['getEventsByIds', () => getEventsByIds(['i']), () => sanity.byIds, [['i']]],
    ['getFeaturedEvents', () => getFeaturedEvents(), () => sanity.featured, []],
    ['getEventsForSurveySchedule', () => getEventsForSurveySchedule(), () => sanity.survey, []],
    ['getEventsForHubspotSync', () => getEventsForHubspotSync(), () => sanity.hubspot, []],
    ['getEventsForSchema', () => getEventsForSchema(), () => sanity.schema, []],
  ] as [string, () => Promise<unknown>, () => ReturnType<typeof vi.fn>, unknown[]][])('%s', (_name, call, getter, args) => {
    it('calls lib/sanity with the same arguments and returns its result by reference', async () => {
      const result = { marker: _name }
      const fn = getter()
      fn.mockClear()
      fn.mockResolvedValueOnce(result)
      expect(await call()).toBe(result)
      expect(fn).toHaveBeenCalledTimes(1)
      expect(fn).toHaveBeenCalledWith(...args)
    })

    it('hands back a null from lib/sanity (no Sanity project configured), and a rejection untouched', async () => {
      const fn = getter()
      fn.mockResolvedValueOnce(null)
      expect(await call()).toBeNull()
      const boom = new Error('sanity down')
      fn.mockRejectedValueOnce(boom)
      await expect(call()).rejects.toBe(boom)
    })
  })

  it('getEventBySlug passes only the slug, so an array callback cannot smuggle in an index', async () => {
    sanity.bySlug.mockClear()
    await Promise.all(['a', 'b'].map(getEventBySlug as (s: string) => Promise<unknown>))
    expect(sanity.bySlug.mock.calls).toEqual([['a'], ['b']])
  })
})
