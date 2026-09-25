import sharp from 'sharp'
import { BADGE_FORMATS, findNameLine, type BadgeFormat, type NameLine } from '@/lib/badge-layout'
import type { Artwork } from '@/lib/event-pdf'

// Badge artwork prep, kept out of lib/event-pdf.ts so sharp (and libvips) is
// traced only into the two badge routes, not every route that renders a PDF.

export interface PreparedBadgeArtwork extends Artwork {
  /** The rule the name sits on, as fractions of the prepared image. */
  line: NameLine | null
}

/** Print resolution for the label artwork. */
const DPI = 300
/** Width the rule is searched at; plenty for a rule, cheap to scan. */
const ANALYSIS_WIDTH = 480

/**
 * Crop the artwork to the label's shape (centre-cropped, never stretched),
 * downsample to print resolution, and find the rule. The rule's position is
 * relative to this crop, which is exactly what gets drawn on each label.
 */
export async function prepareBadgeArtwork(artwork: Artwork, format: BadgeFormat): Promise<PreparedBadgeArtwork> {
  const spec = BADGE_FORMATS[format]
  const w = Math.round((spec.width + spec.bleed * 2) * DPI)
  const h = Math.round((spec.height + spec.bleed * 2) * DPI)

  const cropped = sharp(Buffer.from(artwork.bytes)).rotate().resize(w, h, { fit: 'cover', position: 'centre' })
  const png = artwork.mime === 'image/png'
  const bytes = png
    ? await cropped.png().toBuffer()
    : await cropped.jpeg({ quality: 90 }).toBuffer()

  // Transparent areas print as paper, so judge them as white.
  const analysis = await sharp(bytes)
    .flatten({ background: '#ffffff' })
    .resize(ANALYSIS_WIDTH)
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const line = findNameLine({
    data: new Uint8Array(analysis.data),
    width: analysis.info.width,
    height: analysis.info.height,
  })

  return { bytes: new Uint8Array(bytes), mime: png ? 'image/png' : 'image/jpeg', line }
}
