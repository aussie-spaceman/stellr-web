import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The watermarker is stubbed so these tests exercise the route's guards without
// pulling in sharp/libvips. By default it echoes the input (sharp returns the
// original bytes for sub-96px images), which is exactly the passthrough the
// MEM-2 fix must keep safe via the Content-Type allowlist + CSP.
vi.mock('@/lib/watermark/image', () => ({
  watermarkImageBuffer: vi.fn(async (b: Buffer) => b),
}))

import { GET } from './route'
import { watermarkImageBuffer } from '@/lib/watermark/image'

const PROJECT = 'testproj'
const DATASET = 'production'
const FILE = '0123456789abcdef0123456789abcdef01234567-4000x3000.jpg'
// A card at 360px, as lib/sanity-image.ts asks for it.
const CARD = 'rect=0,328,4000,2344&w=360&h=211&fm=webp&q=75&fit=crop'

function call(url: string) {
  return GET(new Request(url))
}

function srcUrl(src: string) {
  return 'https://app.test/api/img?src=' + encodeURIComponent(src)
}

function sanityUrl(path: string) {
  return srcUrl('https://cdn.sanity.io' + path)
}

function siteUrl(query = CARD, file = FILE) {
  return sanityUrl(`/images/${PROJECT}/${DATASET}/${file}?${query}`)
}

// A fetch Response double with the given content-type and a tiny body.
function imgResponse(contentType: string, length = 10) {
  return {
    ok: true,
    headers: new Headers({ 'content-type': contentType, 'content-length': String(length) }),
    arrayBuffer: async () => new Uint8Array(length).buffer,
  } as unknown as Response
}

describe('/api/img guard', () => {
  it('400s when src is missing', async () => {
    expect((await call('https://app.test/api/img')).status).toBe(400)
  })

  it('400s on a non-allowlisted host', async () => {
    const res = await call(srcUrl('https://evil.example.com/a.jpg'))
    expect(res.status).toBe(400)
  })

  it('400s on a non-https src', async () => {
    const res = await call(srcUrl('http://cdn.sanity.io/a.jpg'))
    expect(res.status).toBe(400)
  })

  it('400s on a malformed src', async () => {
    const res = await call(srcUrl('not-a-url'))
    expect(res.status).toBe(400)
  })
})

describe('/api/img Sanity project pinning + content-type (MEM-2 / PUB-3)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_SANITY_PROJECT_ID', PROJECT)
    vi.stubEnv('NEXT_PUBLIC_SANITY_DATASET', DATASET)
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    fetchSpy.mockRestore()
  })

  it('400s a cdn.sanity.io URL for a DIFFERENT project, without fetching', async () => {
    const res = await call(sanityUrl(`/images/otherproj/production/${FILE}?${CARD}`))
    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('415s when our own project path returns a non-image (SVG) Content-Type', async () => {
    fetchSpy.mockResolvedValue(imgResponse('image/svg+xml'))
    const res = await call(siteUrl(CARD, '0123456789abcdef0123456789abcdef01234567-4000x3000.svg'))
    expect(res.status).toBe(415)
    // Never watermark or echo attacker bytes once the type is disallowed.
    expect(watermarkImageBuffer).not.toHaveBeenCalled()
  })

  it('415s when the declared Content-Length exceeds the cap', async () => {
    fetchSpy.mockResolvedValue(imgResponse('image/webp', 20 * 1024 * 1024))
    const res = await call(siteUrl())
    expect(res.status).toBe(415)
  })

  it('502s (fails closed) when the watermarker throws — never the original bytes', async () => {
    fetchSpy.mockResolvedValue(imgResponse('image/webp'))
    vi.mocked(watermarkImageBuffer).mockRejectedValueOnce(new Error('boom'))
    const res = await call(siteUrl())
    expect(res.status).toBe(502)
  })

  it('serves a genuine raster image from our project with hardening headers', async () => {
    fetchSpy.mockResolvedValue(imgResponse('image/webp'))
    const res = await call(siteUrl())
    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledWith(
      `https://cdn.sanity.io/images/${PROJECT}/${DATASET}/${FILE}?${CARD}`,
      { redirect: 'error' },
    )
    expect(res.headers.get('content-type')).toBe('image/webp')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect(res.headers.get('cache-control')).toContain('immutable')
  })

  it('serves an image whose crop is the whole original (no rect)', async () => {
    fetchSpy.mockResolvedValue(imgResponse('image/webp'))
    const res = await call(siteUrl('w=1920&h=823&fm=webp&q=75&fit=crop'))
    expect(res.status).toBe(200)
  })
})

describe('/api/img only serves the widths and transforms the site uses', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SANITY_PROJECT_ID', PROJECT)
    vi.stubEnv('NEXT_PUBLIC_SANITY_DATASET', DATASET)
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(imgResponse('image/webp'))
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    fetchSpy.mockRestore()
  })

  it.each([
    ['no transforms at all', ''],
    ['a width no preset uses', 'w=3840&h=2253&fm=webp&q=75&fit=crop'],
    ['a preset width with the wrong height', 'w=360&h=360&fm=webp&q=75&fit=crop'],
    ["a hero width with a card's height", 'w=640&h=375&fm=webp&q=75&fit=crop'],
    ['a different format', 'w=360&h=211&fm=png&q=75&fit=crop'],
    ['no format', 'w=360&h=211&q=75&fit=crop'],
    ['a different quality', 'w=360&h=211&fm=webp&q=100&fit=crop'],
    ['a different fit', 'w=360&h=211&fm=webp&q=75&fit=max'],
    ['an extra parameter', 'w=360&h=211&fm=webp&q=75&fit=crop&blur=50'],
    ['a repeated parameter', 'w=360&w=360&h=211&fm=webp&q=75&fit=crop'],
    ['a zero-padded width', 'w=0360&h=211&fm=webp&q=75&fit=crop'],
    ['a malformed rect', 'rect=0,0,4000&w=360&h=211&fm=webp&q=75&fit=crop'],
    ['a rect wider than the original', 'rect=1,0,4000,2344&w=360&h=211&fm=webp&q=75&fit=crop'],
    ['a rect taller than the original', 'rect=0,700,4000,2344&w=360&h=211&fm=webp&q=75&fit=crop'],
    ['an empty rect', 'rect=0,0,0,0&w=360&h=211&fm=webp&q=75&fit=crop'],
  ])('400s %s, without fetching', async (_label, query) => {
    const res = await call(siteUrl(query))
    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it.each([
    ['a nested path', `/images/${PROJECT}/${DATASET}/sub/${FILE}?${CARD}`],
    ['a filename without its size', `/images/${PROJECT}/${DATASET}/0123456789abcdef.jpg?${CARD}`],
  ])('400s %s, without fetching', async (_label, path) => {
    const res = await call(sanityUrl(path))
    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it.each([
    ['a port', `https://cdn.sanity.io:8443/images/${PROJECT}/${DATASET}/${FILE}?${CARD}`],
    ['credentials', `https://user:pw@cdn.sanity.io/images/${PROJECT}/${DATASET}/${FILE}?${CARD}`],
    ['a fragment', `https://cdn.sanity.io/images/${PROJECT}/${DATASET}/${FILE}?${CARD}#x`],
  ])('400s a src with %s, without fetching', async (_label, src) => {
    const res = await call(srcUrl(src))
    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
