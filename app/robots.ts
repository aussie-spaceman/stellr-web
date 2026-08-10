import type { MetadataRoute } from 'next'

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

/**
 * Answer-engine and AI-training crawlers we explicitly welcome onto the public
 * marketing site. They are already covered by the `*` rule; naming them states
 * the policy (so a future blanket tightening doesn't silently drop them) and
 * lets us keep the member/admin surfaces off-limits per agent.
 */
const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-User',
  'Claude-SearchBot',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
  'Bytespider',
  'meta-externalagent',
]

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
