// The Sanity image transforms the site requests, shared by the server helper
// that builds the URLs (lib/sanity-image.ts) and the watermark route that
// serves them (app/api/img/route.ts). Each width is resized, cropped and
// encoded once on Sanity's CDN, stamped once by /api/img, then cached for a
// year, so an image costs nothing on Vercel's image optimizer. The route only
// serves the widths the site uses, listed here.
//
// Dependency-free, so the route can import it without the Sanity client.

export const SANITY_IMAGE_PRESETS = {
  /** The image header on Event, Campaign and news cards. */
  card: { aspect: 600 / 352, widths: [360, 540, 720, 1080] },
  /** The event page hero: the 21:9 crop it's cut to. */
  eventHero: { aspect: 21 / 9, widths: [640, 960, 1280, 1920] },
  /** The news article hero. */
  newsHero: { aspect: 5 / 2, widths: [640, 960, 1280, 1920] },
} as const satisfies Record<string, { aspect: number; widths: readonly number[] }>

export type SanityImagePreset = keyof typeof SANITY_IMAGE_PRESETS

export const SANITY_IMAGE_FIT = 'crop'
export const SANITY_IMAGE_FORMAT = 'webp'
export const SANITY_IMAGE_QUALITY = 75

export function presetHeight(preset: SanityImagePreset, width: number): number {
  return Math.round(width / SANITY_IMAGE_PRESETS[preset].aspect)
}

/** A plain <img>'s src, srcSet and sizes. Strings only, so a server component can hand it to a client one. */
export interface SanityImageProps {
  src: string
  srcSet: string
  sizes: string
}

// Every "<w>x<h>" a preset produces.
const ALLOWED_SIZES = new Set(
  (Object.keys(SANITY_IMAGE_PRESETS) as SanityImagePreset[]).flatMap((p) =>
    SANITY_IMAGE_PRESETS[p].widths.map((w) => `${w}x${presetHeight(p, w)}`),
  ),
)

const REQUIRED_PARAMS = ['w', 'h', 'fit', 'fm', 'q']

// The original's pixel size, from the asset filename `<hash>-<w>x<h>.<ext>`.
const ASSET_FILENAME = /^[0-9a-f]+-(\d+)x(\d+)\.[a-z]+$/

export function sanityAssetSize(filename: string): { width: number; height: number } | null {
  const m = ASSET_FILENAME.exec(filename)
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null
}

/**
 * True when `params` are exactly what lib/sanity-image.ts asks Sanity for: a
 * preset's w and h, fit=crop, fm=webp, q=75, and the crop rectangle
 * @sanity/image-url adds when the crop isn't the whole image (it must lie
 * inside the original). Anything else (another width, an extra or repeated
 * parameter) is false.
 */
export function isSiteSanityImage(
  params: URLSearchParams,
  asset: { width: number; height: number },
): boolean {
  const keys = [...params.keys()]
  if (new Set(keys).size !== keys.length) return false
  if (keys.some((k) => k !== 'rect' && !REQUIRED_PARAMS.includes(k))) return false
  if (REQUIRED_PARAMS.some((k) => !params.has(k))) return false

  if (
    params.get('fit') !== SANITY_IMAGE_FIT ||
    params.get('fm') !== SANITY_IMAGE_FORMAT ||
    params.get('q') !== String(SANITY_IMAGE_QUALITY) ||
    !ALLOWED_SIZES.has(`${params.get('w')}x${params.get('h')}`)
  ) {
    return false
  }

  const rect = params.get('rect')
  if (rect === null) return true
  const m = /^(\d+),(\d+),(\d+),(\d+)$/.exec(rect)
  if (!m) return false
  const [left, top, width, height] = m.slice(1).map(Number)
  return width > 0 && height > 0 && left + width <= asset.width && top + height <= asset.height
}
