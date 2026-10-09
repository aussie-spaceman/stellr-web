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

function call(url: string) {
  return GET(new Request(url))
}

function sanityUrl(path: string) {
  return 'https://app.test/api/img?src=' + encodeURIComponent('https://cdn.sanity.io' + path)
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
    const res = await call('https://app.test/api/img?src=' + encodeURIComponent('https://evil.example.com/a.jpg'))
    expect(res.status).toBe(400)
  })

  it('400s on a non-https src', async () => {
    const res = await call('https://app.test/api/img?src=' + encodeURIComponent('http://cdn.sanity.io/a.jpg'))
    expect(res.status).toBe(400)
  })

  it('400s on a malformed src', async () => {
    const res = await call('https://app.test/api/img?src=' + encodeURIComponent('not-a-url'))
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
    const res = await call(sanityUrl('/images/otherproj/production/abc-50x50.svg'))
    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('415s when our own project path returns a non-image (SVG) Content-Type', async () => {
    fetchSpy.mockResolvedValue(imgResponse('image/svg+xml'))
    const res = await call(sanityUrl(`/images/${PROJECT}/${DATASET}/abc-50x50.svg`))
    expect(res.status).toBe(415)
    // Never watermark or echo attacker bytes once the type is disallowed.
    expect(watermarkImageBuffer).not.toHaveBeenCalled()
  })

  it('415s when the declared Content-Length exceeds the cap', async () => {
    fetchSpy.mockResolvedValue(imgResponse('image/png', 20 * 1024 * 1024))
    const res = await call(sanityUrl(`/images/${PROJECT}/${DATASET}/abc-500x500.png`))
    expect(res.status).toBe(415)
  })

  it('502s (fails closed) when the watermarker throws — never the original bytes', async () => {
    fetchSpy.mockResolvedValue(imgResponse('image/png'))
    vi.mocked(watermarkImageBuffer).mockRejectedValueOnce(new Error('boom'))
    const res = await call(sanityUrl(`/images/${PROJECT}/${DATASET}/abc-500x500.png`))
    expect(res.status).toBe(502)
  })

  it('serves a genuine raster image from our project with hardening headers', async () => {
    fetchSpy.mockResolvedValue(imgResponse('image/png'))
    const res = await call(sanityUrl(`/images/${PROJECT}/${DATASET}/abc-500x500.png`))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'")
  })
})
