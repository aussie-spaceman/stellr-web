import { describe, expect, it } from 'vitest'
import { DEV_PROJECT_ID, imagesConfig } from '../next.config.mjs'

// next.config.mjs `images`: every generated copy counts against Vercel's image
// transformation allowance, so these pin the settings that keep the count down.

const PROD_ENV = {
  VERCEL_PROJECT_ID: 'prj_wMlZwzDocSUrQ5sFZMngrNBeoUvx',
  NEXT_PUBLIC_SANITY_PROJECT_ID: 'if8ubvbg',
  NEXT_PUBLIC_MEDIA_BASE_URL: 'https://l3zabozgfpz3vahd.public.blob.vercel-storage.com',
}

const NEXT_DEFAULT_DEVICE_SIZES = [640, 750, 828, 1080, 1200, 1920, 2048, 3840]
const NEXT_DEFAULT_IMAGE_SIZES = [32, 48, 64, 96, 128, 256, 384]

describe('images config', () => {
  it('optimizes on production and serves originals on the dev project', () => {
    expect(imagesConfig(PROD_ENV).unoptimized).toBe(false)
    expect(imagesConfig({ ...PROD_ENV, VERCEL_PROJECT_ID: DEV_PROJECT_ID }).unoptimized).toBe(true)
    // Local and CI builds have no project ID and behave like production.
    expect(imagesConfig({ ...PROD_ENV, VERCEL_PROJECT_ID: undefined }).unoptimized).toBe(false)
  })

  it('makes one format, one quality and few widths', () => {
    const c = imagesConfig(PROD_ENV)
    expect(c.formats).toEqual(['image/webp'])
    expect(c.qualities).toEqual([75])
    expect(c.minimumCacheTTL).toBeGreaterThanOrEqual(2678400)
    // Subsets of Next's defaults, so copies cached under the old lists still match.
    for (const w of c.deviceSizes) expect(NEXT_DEFAULT_DEVICE_SIZES).toContain(w)
    for (const w of c.imageSizes) expect(NEXT_DEFAULT_IMAGE_SIZES).toContain(w)
    expect(Math.max(...c.deviceSizes)).toBe(1920)
  })

  it('only allows our own remote sources', () => {
    expect(imagesConfig(PROD_ENV).remotePatterns).toEqual([
      { protocol: 'https', hostname: 'cdn.sanity.io', pathname: '/images/if8ubvbg/production/**' },
      { protocol: 'https', hostname: 'l3zabozgfpz3vahd.public.blob.vercel-storage.com', pathname: '/**', search: '' },
    ])
    for (const p of imagesConfig(PROD_ENV).remotePatterns) expect(p.hostname).not.toContain('*')
  })

  it('drops a remote source whose env is unset', () => {
    expect(imagesConfig({}).remotePatterns).toEqual([])
    expect(imagesConfig({ NEXT_PUBLIC_MEDIA_BASE_URL: 'not a url' }).remotePatterns).toEqual([])
  })

  it('allows a query string only on the watermark route', () => {
    const local = imagesConfig(PROD_ENV).localPatterns
    expect(local).toContainEqual({ pathname: '/api/img' })
    for (const p of local.filter((p) => p.pathname !== '/api/img')) expect(p.search).toBe('')
    expect(local.some((p) => p.pathname === '/**')).toBe(false)
  })

  it('serves SVGs as they are instead of through the optimizer', () => {
    expect(imagesConfig(PROD_ENV)).not.toHaveProperty('dangerouslyAllowSVG')
  })
})
