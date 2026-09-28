import sharp from 'sharp'
import { BADGE_FORMATS, findNameLine, type BadgeFormat, type BadgePlacement, type NameLine, type RgbImage } from '@/lib/badge-layout'
import type { Artwork } from '@/lib/event-pdf'

// Badge artwork prep, kept out of lib/event-pdf.ts so sharp (and libvips) is
// traced only into the badge routes, not every route that renders a PDF.

export interface PreparedBadgeArtwork extends Artwork {
  /** The rule the name sits on, as fractions of the prepared image. */
  line: NameLine | null
  /** A small RGB copy, to judge what the name is printed over. */
  analysis: RgbImage
}

/** Print resolution for the label artwork. */
const DPI = 300
/** Width the rule is searched at; plenty for a rule, cheap to scan. */
const ANALYSIS_WIDTH = 480

/**
 * Crop the artwork to the label's shape (centre-cropped, never stretched),
 * downsample to print resolution, and find the rule. Positions are relative
 * to this crop, which is exactly what gets drawn on each label.
 */
export async function prepareBadgeArtwork(artwork: Artwork, format: BadgeFormat): Promise<PreparedBadgeArtwork> {
  const spec = BADGE_FORMATS[format]
  const w = Math.round((spec.width + spec.bleed * 2) * DPI)
  const h = Math.round((spec.height + spec.bleed * 2) * DPI)

  const cropped = sharp(Buffer.from(artwork.bytes)).rotate().resize(w, h, { fit: 'cover', position: 'centre' })
  const png = artwork.mime === 'image/png'
  const bytes = png ? await cropped.png().toBuffer() : await cropped.jpeg({ quality: 90 }).toBuffer()

  // Transparent areas print as paper, so judge them as white.
  const small = await sharp(bytes)
    .flatten({ background: '#ffffff' })
    .resize(ANALYSIS_WIDTH)
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const analysis = { data: new Uint8Array(small.data), width: small.info.width, height: small.info.height }

  return { bytes: new Uint8Array(bytes), mime: png ? 'image/png' : 'image/jpeg', line: findNameLine(analysis), analysis }
}

/**
 * Whether the artwork under the name is dark enough to want white ink: the
 * mean luminance of the band the name occupies, above its baseline.
 */
export function wantsLightInk(img: RgbImage, p: BadgePlacement, format: BadgeFormat): boolean {
  const spec = BADGE_FORMATS[format]
  const boxHeightPt = (spec.height + spec.bleed * 2) * 72
  const y1 = Math.min(img.height - 1, Math.round(p.nameY * img.height))
  const y0 = Math.max(0, Math.round((p.nameY - (p.nameSize * 0.75) / boxHeightPt) * img.height))
  const x0 = Math.max(0, Math.round((p.nameX - p.nameMaxWidth / 2) * img.width))
  const x1 = Math.min(img.width - 1, Math.round((p.nameX + p.nameMaxWidth / 2) * img.width))
  let sum = 0
  let n = 0
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * img.width + x) * 3
      sum += 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2]
      n++
    }
  }
  return n > 0 && sum / n < 110
}
