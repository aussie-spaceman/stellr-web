// @vitest-environment node
import { readFileSync } from 'node:fs'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { collectSources, measure } from '../scripts/s5-inventory.mjs'
import { laneOf } from '../scripts/codemods/events-facade'

// S5 B19: Lane B's event reads (public and member pages, the sitemap, crons and
// the Lane B lib files) import the Sanity event getters from lib/events/repo, not
// lib/sanity. The move is import-only, so it is a no-op exactly when the facade
// sends Sanity the same query, parameters and cache options and hands back the
// client's result untouched. This file proves that at the Sanity client boundary,
// then locks Lane B at zero direct getter imports.

const fetchSpy = vi.fn((..._args: unknown[]) => Promise.resolve<unknown>([]))
vi.mock('next-sanity', () => ({ createClient: () => ({ fetch: fetchSpy }) }))
vi.mock('@sanity/image-url', () => ({ createImageUrlBuilder: () => ({ image: () => ({}) }) }))

// lib/sanity builds its client at module load only when a project id is set.
process.env.NEXT_PUBLIC_SANITY_PROJECT_ID = 'testproj'
const sanity = await import('@/lib/sanity')
const repo = await import('@/lib/events/repo')

beforeEach(() => fetchSpy.mockReset())

type Getter = 'getEventBySlug' | 'getAllEvents' | 'getAllCampaigns' | 'getEventsBySlugs' | 'getEventsByIds' | 'getFeaturedEvents'

// The getters the B19 files call, each with arguments a real caller passes.
const CALLS: [Getter, unknown[]][] = [
  ['getEventBySlug', ['nevada-2027']],
  ['getAllEvents', []],
  ['getAllCampaigns', []],
  ['getEventsBySlugs', [['nevada-2027', 'colorado-sdc']]],
  ['getEventsByIds', [['evt-1', 'evt-2']]],
  ['getFeaturedEvents', []],
]

async function fetchArgs(mod: Record<string, unknown>, name: Getter, args: unknown[]) {
  fetchSpy.mockReset()
  fetchSpy.mockResolvedValue([])
  await (mod[name] as (...a: unknown[]) => Promise<unknown>)(...args)
  expect(fetchSpy).toHaveBeenCalledTimes(1)
  return fetchSpy.mock.calls[0]
}

describe('B19: reading through the facade sends Sanity the same request', () => {
  it.each(CALLS)('%s: same query, parameters and cache options as lib/sanity', async (name, args) => {
    const direct = await fetchArgs(sanity, name, args)
    const viaFacade = await fetchArgs(repo, name, args)
    expect(viaFacade).toEqual(direct)
    // The cache window is lib/sanity's published one: 6 hours, expired by the 'sanity' tag.
    expect(viaFacade[2]).toEqual(sanity.PUBLISHED_CACHE)
    expect(viaFacade[2]).toEqual({ next: { revalidate: 21600, tags: ['sanity'] } })
  })

  it.each(CALLS)("%s: returns the Sanity client's result by reference", async (name, args) => {
    const result = [{ _id: 'evt-1', slug: { current: 'nevada-2027' } }]
    fetchSpy.mockResolvedValueOnce(result)
    expect(await (repo[name] as (...a: unknown[]) => Promise<unknown>)(...args)).toBe(result)
  })

  it.each(CALLS)('%s: a Sanity failure reaches the caller untouched', async (name, args) => {
    const boom = new Error('sanity down')
    fetchSpy.mockRejectedValueOnce(boom)
    await expect((repo[name] as (...a: unknown[]) => Promise<unknown>)(...args)).rejects.toBe(boom)
  })

  // Arguments that are not already tidy: a facade that trimmed, lower-cased,
  // de-duplicated, re-ordered or sliced its input would send a different request.
  const UNTIDY: [Getter, unknown[]][] = [
    ['getEventBySlug', [' Nevada-2027 ']],
    ['getEventsBySlugs', [['Colorado-SDC ', 'nevada-2027', 'nevada-2027', ' a', 'b', 'c']]],
    ['getEventsByIds', [['evt-2', 'evt-1', 'evt-2', 'EVT-3 ']]],
  ]
  it.each(UNTIDY)('%s: passes untidy arguments to Sanity unchanged', async (name, args) => {
    const direct = await fetchArgs(sanity, name, args)
    const viaFacade = await fetchArgs(repo, name, args)
    expect(viaFacade).toEqual(direct)
  })

  it('the empty-list short cut is kept: no slugs or ids means no Sanity request', async () => {
    expect(await repo.getEventsBySlugs([])).toEqual([])
    expect(await repo.getEventsByIds([])).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

// The files B19 moved. Each now names the facade and none still takes a getter from lib/sanity.
const MOVED = [
  'app/(stellr)/(member)/campaigns/[slug]/page.tsx',
  'app/(stellr)/(member)/campaigns/[slug]/submit/page.tsx',
  'app/(stellr)/(member)/campaigns/page.tsx',
  'app/(stellr)/(public)/curriculum/page.tsx',
  'app/(stellr)/(public)/events/[slug]/page.tsx',
  'app/(stellr)/(public)/events/page.tsx',
  'app/(stellr)/(public)/page.tsx',
  'app/(stellr)/(public)/scholarship/page.tsx',
  'app/api/campaigns/[slug]/submit/route.ts',
  'app/api/cron/event-emails/route.ts',
  'app/api/members/billing/payment-link/route.ts',
  'app/api/scholarship/route.ts',
  'app/api/store/reship/route.ts',
  'app/api/subscribe/route.ts',
  'app/sitemap.ts',
  'lib/admin-digest.ts',
  'lib/compliance-notify.ts',
  'lib/event-emails/send.ts',
  'lib/space-admin.ts',
  'lib/training-reminders.ts',
]

describe('B19: Lane B holds no direct Sanity event-getter import', () => {
  let getters: Record<string, string[]>
  beforeAll(() => {
    getters = measure(collectSources(process.cwd())).getters
  }, 120_000)

  it('every moved file is Lane B and imports the facade', () => {
    for (const f of MOVED) {
      expect(laneOf(f), f).toBe('B')
      expect(readFileSync(f, 'utf8'), f).toMatch(/from '@\/lib\/events\/repo'/)
    }
  })

  it('no Lane B file takes an event getter straight from lib/sanity', () => {
    expect(Object.keys(getters).filter((f) => laneOf(f) === 'B')).toEqual([])
  })

  it('lib/survey/run.ts reads events only through lib/survey/events.ts, not lib/sanity', () => {
    const src = readFileSync('lib/survey/run.ts', 'utf8')
    expect(src).not.toMatch(/lib\/sanity|from '\.\.\/sanity'/)
    expect(src).toMatch(/from '\.\/events'/)
  })
})
