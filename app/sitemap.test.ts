import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import sitemap, { STATIC_SITEMAP_PATHS, STATIC_ROUTE_EXCLUSIONS, LANDING_PAGE_SITEMAP_PATHS } from './sitemap'

vi.mock('@/lib/sanity', () => ({
  getAllEvents: async () => [
    { slug: { current: 'live-event' }, _updatedAt: '2026-01-02T00:00:00Z', date: '2027-09-09' },
  ],
  getAllCampaigns: async () => [{ slug: { current: 'unedited-campaign' } }],
  getAllNewsPosts: async () => [],
}))

/**
 * Guards against the sitemap silently falling behind the routes. Fifteen public
 * pages — including /impact, /curriculum and /events/why-design-competitions —
 * were missing from it before this test existed, so every new public page must
 * now be either listed in the sitemap or explicitly excluded.
 */

// Vitest runs from the repo root (jsdom rewrites import.meta.url off file:).
const PUBLIC_DIR = join(process.cwd(), 'app', '(public)')

/** Every static (non-parameterised) route served from app/(public). */
function staticPublicRoutes(dir: string, prefix = ''): string[] {
  const routes: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === 'page.tsx') {
      routes.push(prefix)
      continue
    }
    if (!entry.isDirectory()) continue
    // Dynamic segments have no single canonical URL — the sitemap builds those
    // from Sanity at request time.
    if (entry.name.includes('[')) continue
    // Route groups don't appear in the URL.
    const segment = entry.name.startsWith('(') ? '' : `/${entry.name}`
    routes.push(...staticPublicRoutes(join(dir, entry.name), prefix + segment))
  }
  return routes
}

describe('sitemap static route coverage', () => {
  const routes = staticPublicRoutes(PUBLIC_DIR)

  it('finds the public routes on disk', () => {
    // Sanity check on the walker itself, so a broken traversal can't make the
    // coverage assertion below pass vacuously.
    expect(routes).toContain('')
    expect(routes).toContain('/competitions')
    expect(routes.length).toBeGreaterThan(20)
  })

  it('lists or explicitly excludes every static public page', () => {
    const accounted = new Set([...STATIC_SITEMAP_PATHS, ...STATIC_ROUTE_EXCLUSIONS])
    const missing = routes.filter((r) => !accounted.has(r))
    expect(missing, `Add these to staticPaths or STATIC_ROUTE_EXCLUSIONS in app/sitemap.ts: ${missing.join(', ')}`).toEqual([])
  })

  it('does not list routes that no longer exist', () => {
    const onDisk = new Set(routes)
    const stale = STATIC_SITEMAP_PATHS.filter((p) => !onDisk.has(p))
    expect(stale, `These sitemap entries have no page.tsx: ${stale.join(', ')}`).toEqual([])
  })

  it('has no duplicate entries', () => {
    expect(new Set(STATIC_SITEMAP_PATHS).size).toBe(STATIC_SITEMAP_PATHS.length)
  })

  it('includes every audience landing page, derived from the registry', () => {
    // /lp/[slug] is parameterised, so the on-disk walker above cannot see the
    // individual pages. They come from content/lp instead, which means adding an
    // audience page cannot leave it out of the sitemap.
    expect(LANDING_PAGE_SITEMAP_PATHS).toEqual([
      '/lp/first-robotics-teachers',
      '/lp/homeschool-students',
    ])
    for (const path of LANDING_PAGE_SITEMAP_PATHS) {
      expect(STATIC_SITEMAP_PATHS).not.toContain(path)
    }
  })
})

describe('sitemap lastModified', () => {
  // The July audit and the August AEO pass both found every static route
  // reporting "changed just now". A missing lastmod is neutral; a wrong one
  // teaches crawlers to ignore the field where it is real (Sanity content).
  it('never stamps an entry with the request time', async () => {
    const entries = await sitemap()
    const stampedNow = entries.filter(
      (e) => e.lastModified && Date.now() - new Date(e.lastModified).getTime() < 60_000
    )
    expect(stampedNow.map((e) => e.url)).toEqual([])
  })

  it('reports the last edit of an event, not the date it takes place', async () => {
    const entries = await sitemap()
    expect(entries.find((e) => e.url.endsWith('/events/live-event'))?.lastModified).toEqual(
      new Date('2026-01-02T00:00:00Z')
    )
    expect(entries.find((e) => e.url.endsWith('/events/unedited-campaign'))?.lastModified).toBeUndefined()
  })
})
