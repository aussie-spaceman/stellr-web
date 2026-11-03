// @vitest-environment node
import { afterAll, describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

// S0 content safety: the article's JSON-LD is built from the Sanity post, and
// was written with a bare JSON.stringify — so a title holding "</script>" closed
// the block and the rest ran as script on www. Rendered for real here, with only
// the content reads stubbed.

vi.hoisted(() => {
  vi.stubEnv('NEXT_PUBLIC_SANITY_PROJECT_ID', 'testproj')
  vi.stubEnv('NEXT_PUBLIC_SANITY_DATASET', 'production')
})
afterAll(() => vi.unstubAllEnvs())

const XSS = '</script><script>alert(1)</script>'
const post = {
  _id: 'p1',
  title: `Results ${XSS}`,
  slug: { current: 'results' },
  publishedAt: '2026-10-01',
  excerpt: `Who won <!-- ${XSS}`,
  author: `A & B ${XSS}`,
}

vi.mock('@/lib/sanity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sanity')>()),
  getNewsPostBySlug: async () => post,
  getRelatedNewsPosts: async () => [],
}))
vi.mock('next-sanity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next-sanity')>()),
  PortableText: () => null,
}))
vi.mock('@/components/forms/SubscribeForm', () => ({ SubscribeForm: () => null }))

const NewsArticlePage = (await import('./page')).default

describe('/news/[slug] JSON-LD', () => {
  it('keeps hostile Sanity text inside the one JSON-LD block', async () => {
    const html = renderToString(await NewsArticlePage({ params: Promise.resolve({ slug: 'results' }) }))

    // The page renders no other script, so exactly one open and one close tag
    // means nothing broke out.
    expect(html.match(/<script/gi)).toHaveLength(1)
    expect(html.match(/<\/script/gi)).toHaveLength(1)

    const block = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)
    expect(block).not.toBeNull()
    const schema = JSON.parse(block![1])
    expect(schema.headline).toBe(post.title)
    expect(schema.description).toBe(post.excerpt)
    expect(schema.author.name).toBe(post.author)
  })
})
