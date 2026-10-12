// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// deep review PUB-8: the root layout reads request headers, which opts every
// route out of static/ISR rendering, so the per-page `export const revalidate`
// lines are dead and `useCdn:false` means each view hits Sanity's uncached API.
// Removing the root-layout header read is a route-group refactor (flagged for a
// design pass). The safe partial proven here: every Sanity read passes a
// `next.revalidate` window, so the Next Data Cache serves repeated reads even
// while the route renders dynamically — turning per-view Sanity calls into
// per-hour ones (and a Sanity blip is far less likely to surface as a 404).

const fetchSpy = vi.fn((..._args: unknown[]) => Promise.resolve([]))

vi.mock('next-sanity', () => ({
  createClient: () => ({ fetch: fetchSpy }),
}))
vi.mock('@sanity/image-url', () => ({
  createImageUrlBuilder: () => ({ image: () => ({}) }),
}))

// lib/sanity decides at module load whether to build a client at all, from the
// project id — set it before importing the module under test.
process.env.NEXT_PUBLIC_SANITY_PROJECT_ID = 'testproj'
const sanity = await import('./sanity')

beforeEach(() => fetchSpy.mockClear())

/** The revalidate from the 3rd arg (options) of the most recent client.fetch. */
function lastRevalidate(): number | undefined {
  const opts = fetchSpy.mock.calls.at(-1)?.[2] as { next?: { revalidate?: number } } | undefined
  return opts?.next?.revalidate
}

describe('Sanity reads carry a cache window (PUB-8)', () => {
  it('getFeaturedEvents passes a revalidate window', async () => {
    await sanity.getFeaturedEvents()
    expect(fetchSpy).toHaveBeenCalled()
    expect(lastRevalidate()).toBeGreaterThan(0)
  })

  it('getEventBySlug (a per-view detail read) passes a revalidate window', async () => {
    await sanity.getEventBySlug('nevada-2027')
    expect(lastRevalidate()).toBeGreaterThan(0)
  })

  it('getNewsPostBySlug passes a revalidate window', async () => {
    await sanity.getNewsPostBySlug('some-post')
    expect(lastRevalidate()).toBeGreaterThan(0)
  })

  it('getAllEvents passes a revalidate window', async () => {
    await sanity.getAllEvents()
    expect(lastRevalidate()).toBeGreaterThan(0)
  })
})
