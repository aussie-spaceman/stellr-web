import type { MetadataRoute } from 'next'
import { getAllEvents, getAllCampaigns, getAllNewsPosts } from '@/lib/sanity'

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

/**
 * Every indexable static route under app/(public).
 *
 * `test/sitemap.test.ts` walks the filesystem and fails if a public page.tsx
 * appears here in neither this list nor STATIC_ROUTE_EXCLUSIONS below — the
 * list drifted out of date once already (15 pages were missing), so new pages
 * now have to be classified deliberately rather than silently omitted.
 */
const staticPaths: { path: string; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency']; priority: number }[] = [
  { path: '', changeFrequency: 'weekly', priority: 1 },

  // Programs — the primary answer-engine surface.
  { path: '/events', changeFrequency: 'daily', priority: 0.9 },
  { path: '/competitions', changeFrequency: 'monthly', priority: 0.9 },
  { path: '/curriculum', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/academy', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/membership', changeFrequency: 'monthly', priority: 0.8 },

  // Explainers and evidence — what gets cited for topic queries.
  { path: '/why-stellr', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/impact', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/events/why-design-competitions', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/curriculum/atmospheric-requirements', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/curriculum/atmospheric-requirements/teachers', changeFrequency: 'monthly', priority: 0.7 },

  // Audience landing pages.
  { path: '/students', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/educators', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/stipend', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/educate', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/mentors', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/network', changeFrequency: 'monthly', priority: 0.7 },

  // Organisation.
  { path: '/about', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/news', changeFrequency: 'weekly', priority: 0.7 },
  { path: '/donate', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/scholarship', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/volunteer', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/host-an-event', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/store', changeFrequency: 'weekly', priority: 0.5 },
  { path: '/academy/coaching/request', changeFrequency: 'yearly', priority: 0.5 },
  { path: '/contact', changeFrequency: 'yearly', priority: 0.5 },

  // Legal.
  { path: '/terms', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.3 },
]

/**
 * Public routes deliberately kept out of the sitemap: transactional steps and
 * per-registration screens with no standalone informational value.
 */
export const STATIC_ROUTE_EXCLUSIONS = ['/store/cart', '/store/success']

export const STATIC_SITEMAP_PATHS = staticPaths.map((r) => r.path)

const staticRoutes: MetadataRoute.Sitemap = staticPaths.map((r) => ({
  url: `${BASE_URL}${r.path}`,
  lastModified: new Date(),
  changeFrequency: r.changeFrequency,
  priority: r.priority,
}))

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [events, campaigns, newsPosts] = await Promise.all([
    getAllEvents().catch(() => null),
    getAllCampaigns().catch(() => null),
    getAllNewsPosts().catch(() => null),
  ])

  const eventRoutes: MetadataRoute.Sitemap = (events ?? []).map(
    (e: { slug: { current: string }; date?: string }) => ({
      url: `${BASE_URL}/events/${e.slug.current}`,
      lastModified: e.date ? new Date(e.date) : new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })
  )

  // Campaigns are also served at /events/[slug] (the detail page renders the
  // campaign view for activityType === 'campaign').
  const campaignRoutes: MetadataRoute.Sitemap = (campaigns ?? []).map(
    (c: { slug: { current: string } }) => ({
      url: `${BASE_URL}/events/${c.slug.current}`,
      lastModified: new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })
  )

  const newsRoutes: MetadataRoute.Sitemap = (newsPosts ?? []).map(
    (p: { slug: { current: string }; publishedAt?: string }) => ({
      url: `${BASE_URL}/news/${p.slug.current}`,
      lastModified: p.publishedAt ? new Date(p.publishedAt) : new Date(),
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })
  )

  return [...staticRoutes, ...eventRoutes, ...campaignRoutes, ...newsRoutes]
}
