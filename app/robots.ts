import type { MetadataRoute } from 'next'
import { AI_CRAWLER_TOKENS } from '@/lib/crawlers'

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

/**
 * Answer-engine and AI-training crawlers we explicitly welcome onto the public
 * marketing site. They are already covered by the `*` rule; naming them states
 * the policy (so a future blanket tightening doesn't silently drop them) and
 * lets us keep the member/admin surfaces off-limits per agent. The list lives in
 * lib/crawlers.ts, shared with the proxy that counts their visits.
 */
const AI_CRAWLERS = AI_CRAWLER_TOKENS

/** Never crawlable: CMS, API surface, and anything behind auth. */
const PRIVATE_PATHS = ['/studio/', '/api/', '/account/', '/admin/', '/community/', '/home/']

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: PRIVATE_PATHS,
      },
      {
        userAgent: AI_CRAWLERS,
        allow: '/',
        disallow: PRIVATE_PATHS,
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
    host: BASE_URL,
  }
}
