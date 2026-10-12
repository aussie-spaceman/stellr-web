// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

// deep review PUB-9: a Sanity fetch error was swallowed to null and rendered as
// notFound() — an outage became a 404, de-indexing a live news URL. The fix
// distinguishes "no such post" (null → notFound) from "fetch failed" (throw).

const { getNewsPostBySlug, getRelatedNewsPosts } = vi.hoisted(() => ({
  getNewsPostBySlug: vi.fn(),
  getRelatedNewsPosts: vi.fn(async () => []),
}))
const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
})

vi.mock('next/navigation', () => ({ notFound }))
vi.mock('@/lib/sanity', () => ({
  getNewsPostBySlug,
  getRelatedNewsPosts,
  urlFor: () => ({ width: () => ({ height: () => ({ url: () => '' }) }) }),
  wmSrc: (s: string) => s,
}))
vi.mock('next-sanity', () => ({ PortableText: () => null }))
vi.mock('@/components/forms/SubscribeForm', () => ({ SubscribeForm: () => null }))

const Page = (await import('./page')).default

const render = () => Page({ params: Promise.resolve({ slug: 'some-post' }) })

beforeEach(() => vi.clearAllMocks())

describe('news article page — Sanity error vs not-found (PUB-9)', () => {
  it('re-throws a Sanity fetch error instead of 404ing', async () => {
    getNewsPostBySlug.mockRejectedValueOnce(new Error('sanity 503'))
    await expect(render()).rejects.toThrow('sanity 503')
    expect(notFound).not.toHaveBeenCalled()
  })

  it('still 404s a genuinely missing post (null)', async () => {
    getNewsPostBySlug.mockResolvedValueOnce(null)
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(notFound).toHaveBeenCalledOnce()
  })
})
