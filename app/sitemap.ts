import type { MetadataRoute } from 'next'
import { getAllEvents, getAllNewsPosts } from '@/lib/sanity'

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

const staticRoutes: MetadataRoute.Sitemap = [
  { url: BASE_URL, lastModified: new Date(), changeFrequency: 'weekly', priority: 1 },
  { url: `${BASE_URL}/events`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.9 },
  { url: `${BASE_URL}/why-stellr`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
  { url: `${BASE_URL}/membership`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
  { url: `${BASE_URL}/about`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
  { url: `${BASE_URL}/news`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.7 },
  { url: `${BASE_URL}/contact`, lastModified: new Date(), changeFrequency: 'yearly', priority: 0.5 },
  { url: `${BASE_URL}/donate`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.6 },
  { url: `${BASE_URL}/privacy`, lastModified: new Date(), changeFrequency: 'yearly', priority: 0.3 },
]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [events, newsPosts] = await Promise.all([
    getAllEvents().catch(() => null),
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

  const newsRoutes: MetadataRoute.Sitemap = (newsPosts ?? []).map(
    (p: { slug: { current: string }; publishedAt?: string }) => ({
      url: `${BASE_URL}/news/${p.slug.current}`,
      lastModified: p.publishedAt ? new Date(p.publishedAt) : new Date(),
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })
  )

  return [...staticRoutes, ...eventRoutes, ...newsRoutes]
}
