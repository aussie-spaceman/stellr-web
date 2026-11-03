import { describe, it, expect, vi, beforeEach } from 'vitest'

// signedDownloadUrl signs with the service-role key for every download route.
// storage-js puts the path in the request URL unencoded and the URL parser
// resolves it, so a path that only looks like it sits under a prefix must never
// be signed.

const { createSignedUrl } = vi.hoisted(() => ({ createSignedUrl: vi.fn() }))

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({ storage: { from: () => ({ createSignedUrl }) } }),
}))

const { signedDownloadUrl } = await import('./community')

beforeEach(() => {
  vi.clearAllMocks()
  createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed.example/x' }, error: null })
})

describe('signedDownloadUrl', () => {
  it.each([
    'resources/members/m1/%2e%2e/m2/1-x.pdf',
    'resources/members/m1/.%2e/m2/1-x.pdf',
    'resources/members/m1/.\t./m2/1-x.pdf',
    'community-resources/s1/./1-x.pdf',
    'community-resources/s1/1-x.pdf?x',
    'community-resources/s1/1-x.pdf#x',
    '../signed-agreements/x.pdf',
    'a//b.pdf',
  ])('refuses to sign %j', async (path) => {
    expect(await signedDownloadUrl(path)).toBeNull()
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  it('signs a path the app issued', async () => {
    const path = 'community-resources/s1/members/m1/1730000000000-notes.pdf'
    expect(await signedDownloadUrl(path)).toBe('https://signed.example/x')
    expect(createSignedUrl).toHaveBeenCalledWith(path, 120)
  })
})
