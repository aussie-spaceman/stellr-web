// @vitest-environment node
import { afterAll, describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

// News cover images go straight to the watermark route (/api/img), never
// through Vercel's image optimizer: the rendered HTML carries the srcset and no
// /_next/image URL. The real image builder runs (lib/sanity reads the project
// id at import, hence the hoisted env); only the content reads are stubbed.

vi.hoisted(() => {
  vi.stubEnv('NEXT_PUBLIC_SANITY_PROJECT_ID', 'testproj')
  vi.stubEnv('NEXT_PUBLIC_SANITY_DATASET', 'production')
})
afterAll(() => vi.unstubAllEnvs())

const cover = { asset: { _ref: 'image-0123456789abcdef0123456789abcdef01234567-2400x1600-jpg' } }
const post = {
  _id: 'p1',
  title: 'Results are in',
  slug: { current: 'results-are-in' },
  publishedAt: '2026-10-01',
  category: 'Event Results',
  excerpt: 'Who won.',
  coverImage: cover,
}

vi.mock('@/lib/sanity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sanity')>()),
  getAllNewsPosts: async () => [post],
  getNewsPostBySlug: async () => post,
  getRelatedNewsPosts: async () => [{ ...post, _id: 'p2', slug: { current: 'another' } }],
}))
vi.mock('next-sanity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next-sanity')>()),
  PortableText: () => null,
}))
vi.mock('@/components/forms/SubscribeForm', () => ({ SubscribeForm: () => null }))

const NewsPage = (await import('./page')).default
const NewsArticlePage = (await import('./[slug]/page')).default

function expectDirectImages(html: string, count: number) {
  expect(html).not.toContain('/_next/image')
  const sanity = /<img[^>]+srcSet="\/api\/img\?src=https%3A%2F%2Fcdn\.sanity\.io%2Fimages%2Ftestproj%2Fproduction%2F/g
  expect(html.match(sanity)).toHaveLength(count)
}

describe('news cover images skip the image optimizer', () => {
  it('/news cards', async () => {
    expectDirectImages(renderToString(await NewsPage()), 1)
  })

  it('/news/[slug] hero and related cards', async () => {
    const html = renderToString(await NewsArticlePage({ params: Promise.resolve({ slug: 'results-are-in' }) }))
    expectDirectImages(html, 2)
    expect(html).toMatch(/<img[^>]+loading="eager"[^>]+fetchPriority="high"/)
  })
})
