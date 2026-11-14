import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// image-transformations.7 / sanity-images.7: next.config.mjs's localPatterns
// lets next/image ask for /api/img with any query, because a pattern there
// can't match one. So the route itself is the only check on `src`: an image in
// this deployment's own Sanity project and dataset, and nothing else. Every
// other source is a 400 before anything is fetched.

vi.mock('@/lib/watermark/image', () => ({
  watermarkImageBuffer: vi.fn(async (b: Buffer) => b),
}))

import { GET } from './route'

const PROJECT = 'testproj'
const DATASET = 'production'
const FILE = '0123456789abcdef0123456789abcdef01234567-4000x3000.jpg'
const CARD = 'rect=0,328,4000,2344&w=360&h=211&fm=webp&q=75&fit=crop'
const MEDIA_HOST = 'media.placeholder.test'

const call = (url: string) => GET(new Request(url))
const withSrc = (src: string) => 'https://app.test/api/img?src=' + encodeURIComponent(src)

function imgResponse() {
  return {
    ok: true,
    headers: new Headers({ 'content-type': 'image/webp', 'content-length': '10' }),
    arrayBuffer: async () => new Uint8Array(10).buffer,
  } as unknown as Response
}

describe('/api/img fetches only from this Sanity project and dataset', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_SANITY_PROJECT_ID', PROJECT)
    vi.stubEnv('NEXT_PUBLIC_SANITY_DATASET', DATASET)
    vi.stubEnv('NEXT_PUBLIC_MEDIA_BASE_URL', `https://${MEDIA_HOST}`)
    fetchSpy = vi.spyOn(globalThis, 'fetch')
    fetchSpy.mockResolvedValue(imgResponse())
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    fetchSpy.mockRestore()
  })

  it('serves the one allowed source', async () => {
    const res = await call(withSrc(`https://cdn.sanity.io/images/${PROJECT}/${DATASET}/${FILE}?${CARD}`))
    expect(res.status).toBe(200)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a first-party image folder, as a path', `/images/logo.png`],
    ['a first-party image folder, as a URL', `https://app.test/images/logo.png`],
    ['the watermark route itself', `/api/img?src=${encodeURIComponent(`https://cdn.sanity.io/images/${PROJECT}/${DATASET}/${FILE}`)}`],
    ['the media host', `https://${MEDIA_HOST}/media/photo.jpg`],
    ['another dataset of this project', `https://cdn.sanity.io/images/${PROJECT}/staging/${FILE}?${CARD}`],
    ['another project', `https://cdn.sanity.io/images/otherproj/${DATASET}/${FILE}?${CARD}`],
    ['a project whose id starts with ours', `https://cdn.sanity.io/images/${PROJECT}x/${DATASET}/${FILE}?${CARD}`],
    ['a Sanity file asset, not an image', `https://cdn.sanity.io/files/${PROJECT}/${DATASET}/${FILE}`],
    ['a path that climbs out of the dataset', `https://cdn.sanity.io/images/${PROJECT}/${DATASET}/../../otherproj/${DATASET}/${FILE}?${CARD}`],
    ['an encoded climb', `https://cdn.sanity.io/images/${PROJECT}/${DATASET}/%2e%2e/%2e%2e/otherproj/${DATASET}/${FILE}?${CARD}`],
    ['a nested path under the dataset', `https://cdn.sanity.io/images/${PROJECT}/${DATASET}/sub/${FILE}?${CARD}`],
    ['another port', `https://cdn.sanity.io:8443/images/${PROJECT}/${DATASET}/${FILE}?${CARD}`],
    ['credentials in the URL', `https://user:placeholder@cdn.sanity.io/images/${PROJECT}/${DATASET}/${FILE}?${CARD}`],
    ['a look-alike host', `https://cdn.sanity.io.placeholder.test/images/${PROJECT}/${DATASET}/${FILE}?${CARD}`],
    ['plain http', `http://cdn.sanity.io/images/${PROJECT}/${DATASET}/${FILE}?${CARD}`],
    ['a protocol-relative URL', `//cdn.sanity.io/images/${PROJECT}/${DATASET}/${FILE}?${CARD}`],
    ['a data URL', 'data:image/png;base64,AAAA'],
    ['a file URL', 'file:///etc/hosts'],
    ['a transform the site never asks for', `https://cdn.sanity.io/images/${PROJECT}/${DATASET}/${FILE}?w=9999&fm=png`],
    ['a fragment', `https://cdn.sanity.io/images/${PROJECT}/${DATASET}/${FILE}?${CARD}#x`],
  ])('400s %s, without fetching', async (_label, src) => {
    const res = await call(withSrc(src))
    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('400s every source when the deployment names no Sanity project', async () => {
    vi.stubEnv('NEXT_PUBLIC_SANITY_PROJECT_ID', '')
    const res = await call(withSrc(`https://cdn.sanity.io/images/${PROJECT}/${DATASET}/${FILE}?${CARD}`))
    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('reads only the first src: a second one cannot add a source', async () => {
    const url =
      withSrc(`https://${MEDIA_HOST}/media/photo.jpg`) +
      '&src=' +
      encodeURIComponent(`https://cdn.sanity.io/images/${PROJECT}/${DATASET}/${FILE}?${CARD}`)
    const res = await call(url)
    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
