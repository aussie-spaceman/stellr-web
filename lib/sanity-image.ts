import type { SanityImageSource } from '@sanity/image-url'
import { urlFor, wmSrc } from '@/lib/sanity'
import {
  SANITY_IMAGE_FIT,
  SANITY_IMAGE_FORMAT,
  SANITY_IMAGE_PRESETS,
  SANITY_IMAGE_QUALITY,
  presetHeight,
  type SanityImagePreset,
  type SanityImageProps,
} from '@/lib/sanity-image-params'

// A responsive, watermarked Sanity image for a plain <img> (CoverImage). Every
// srcset entry is a /api/img URL for one of the preset's widths, so the browser
// fetches it straight from our CDN: none of it goes through Vercel's image
// optimizer (/_next/image), which bills each width it re-encodes.
export function sanityImage(
  source: SanityImageSource,
  preset: SanityImagePreset,
  sizes: string,
): SanityImageProps {
  const { aspect, widths: all } = SANITY_IMAGE_PRESETS[preset]
  // Never ask for more pixels than the original holds: a width past it is the
  // same picture, upscaled. A small original keeps the smallest width.
  const max = sourceWidth(source, aspect)
  const fits = all.filter((w) => max === null || w <= max)
  const widths = fits.length > 0 ? fits : [all[0]]

  const url = (w: number) =>
    wmSrc(
      urlFor(source)
        .width(w)
        .height(presetHeight(preset, w))
        .fit(SANITY_IMAGE_FIT)
        .format(SANITY_IMAGE_FORMAT)
        .quality(SANITY_IMAGE_QUALITY)
        .url(),
    )

  return {
    src: url(widths[widths.length - 1]),
    srcSet: widths.map((w) => `${url(w)} ${w}w`).join(', '),
    sizes,
  }
}

// The widest crop at `aspect` the original can supply, from the asset id
// ("image-<hash>-<w>x<h>-<ext>") less the editor's crop. Null when the source
// isn't an asset reference (the cap is then skipped).
function sourceWidth(source: SanityImageSource, aspect: number): number | null {
  const image = source as {
    asset?: { _ref?: string }
    crop?: { top?: number; bottom?: number; left?: number; right?: number }
  }
  const m = /-(\d+)x(\d+)-[a-z0-9]+$/.exec(image?.asset?._ref ?? '')
  if (!m) return null
  const crop = image.crop ?? {}
  const width = Number(m[1]) * (1 - (crop.left ?? 0) - (crop.right ?? 0))
  const height = Number(m[2]) * (1 - (crop.top ?? 0) - (crop.bottom ?? 0))
  return Math.floor(Math.min(width, height * aspect))
}
