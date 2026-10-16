// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { SANITY_IMAGE_PRESETS, type SanityImagePreset } from '@/lib/sanity-image-params'

// The helper's URLs are what the page puts in front of the browser, and the
// route only serves the transforms it recognises, so the two must agree. These
// tests build URLs with the real @sanity/image-url builder (lib/sanity reads the
// project id at import, hence the stubbed env + dynamic import) and send every
// one through the real route.

vi.mock('@/lib/watermark/image', () => ({
  watermarkImageBuffer: vi.fn(async (b: Buffer) => b),
}))

vi.stubEnv('NEXT_PUBLIC_SANITY_PROJECT_ID', 'testproj')
vi.stubEnv('NEXT_PUBLIC_SANITY_DATASET', 'production')
afterAll(() => vi.unstubAllEnvs())
const { sanityImage } = await import('./sanity-image')
const { GET } = await import('@/app/api/img/route')

const HASH = '0123456789abcdef0123456789abcdef01234567'
const asset = (w: number, h: number, ext = 'jpg') => ({ asset: { _ref: `image-${HASH}-${w}x${h}-${ext}` } })

const PRESETS = Object.keys(SANITY_IMAGE_PRESETS) as SanityImagePreset[]

// "url 360w, url 540w" → [{ url, width }]
function entries(srcSet: string) {
  return srcSet.split(', ').map((entry) => {
    const [url, w] = entry.split(' ')
    return { url, width: Number(w.replace('w', '')) }
  })
}

function sanityUrl(apiImg: string) {
  return new URL(new URL(apiImg, 'https://app.test').searchParams.get('src')!)
}

describe('sanityImage', () => {
  it('lists every preset width for a large original, largest as the src', () => {
    const img = sanityImage(asset(4000, 3000), 'card', '100vw')
    const list = entries(img.srcSet)
    expect(list.map((e) => e.width)).toEqual([...SANITY_IMAGE_PRESETS.card.widths])
    expect(img.src).toBe(list[list.length - 1].url)
    expect(img.sizes).toBe('100vw')
    for (const { url, width } of list) {
      expect(url.startsWith('/api/img?src=')).toBe(true)
      const params = sanityUrl(url).searchParams
      expect(params.get('w')).toBe(String(width))
      expect(params.get('h')).toBe(String(Math.round((width * 352) / 600)))
      expect(params.get('fm')).toBe('webp')
      expect(params.get('q')).toBe('75')
      expect(params.get('fit')).toBe('crop')
    }
  })

  it('drops widths wider than the original holds', () => {
    const widths = entries(sanityImage(asset(800, 600), 'card', '100vw').srcSet).map((e) => e.width)
    expect(widths).toEqual([360, 540, 720])
  })

  it("caps by the crop's height too, at the preset's aspect", () => {
    // 2000 wide but only 500 tall: a 21:9 crop of it is 1166 wide.
    const widths = entries(sanityImage(asset(2000, 500), 'eventHero', '100vw').srcSet).map((e) => e.width)
    expect(widths).toEqual([640, 960])
  })

  it("takes the editor's crop off the original's size", () => {
    const source = { ...asset(2000, 2000), crop: { top: 0, bottom: 0, left: 0.3, right: 0.3 } }
    const widths = entries(sanityImage(source, 'card', '100vw').srcSet).map((e) => e.width)
    expect(widths).toEqual([360, 540, 720])
  })

  it('keeps the smallest width for an original smaller than every width', () => {
    const img = sanityImage(asset(300, 200), 'newsHero', '100vw')
    expect(entries(img.srcSet).map((e) => e.width)).toEqual([640])
  })
})

describe('every URL sanityImage emits is one /api/img serves', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>
  beforeAll(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(new Uint8Array(10), { headers: { 'content-type': 'image/webp' } }),
    )
  })
  afterAll(() => fetchSpy.mockRestore())

  const sources = {
    'a landscape photo': asset(4000, 3000),
    'a portrait photo': asset(1200, 1800, 'png'),
    'an original already at the card aspect': asset(1080, 634),
    'a cropped photo with a hotspot': {
      ...asset(4000, 3000),
      crop: { top: 0.1, bottom: 0.2, left: 0.25, right: 0.05 },
      hotspot: { x: 0.3, y: 0.6, width: 0.2, height: 0.2 },
    },
    'a hotspot at the far corner': {
      ...asset(3000, 2000),
      hotspot: { x: 0.99, y: 0.99, width: 0.02, height: 0.02 },
    },
  }

  for (const preset of PRESETS) {
    for (const [label, source] of Object.entries(sources)) {
      it(`${preset}: ${label}`, async () => {
        for (const { url } of entries(sanityImage(source, preset, '100vw').srcSet)) {
          const res = await GET(new Request(new URL(url, 'https://app.test')))
          expect(res.status, url).toBe(200)
        }
      })
    }
  }
})
