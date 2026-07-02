// Single source of truth for the "© Stellr Education" copyright watermark that is
// baked into the bottom-right corner of every photo, video and downloadable-PDF
// page across www + app.stellreducation.org.
//
// The three medium-specific helpers (image.ts / pdf.ts / video.ts) and the
// backfill scripts all read their styling from here, so the mark can be retuned
// in one place. Tweak these numbers, re-run the backfill scripts, and everything
// stays consistent.

export const WATERMARK_TEXT = '© Stellr Education'

// A stable marker string embedded in watermarked PDFs (Keywords metadata) so the
// batch stamper and the prebuild guard can tell an already-stamped PDF from a
// fresh one without re-stamping it.
export const WATERMARK_MARKER = 'stellr-watermarked'

export const WATERMARK_STYLE = {
  /** Fraction of the shorter edge used for the glyph height. */
  fontScale: 0.03,
  /** Clamp the computed font size (px / pt) so it stays legible but unobtrusive. */
  minFontPx: 12,
  maxFontPx: 44,
  /** Inset from the bottom + right edges, as a fraction of the shorter edge. */
  marginScale: 0.022,
  minMarginPx: 10,
  /** Fill: near-white so it reads on dark and mid photos. */
  fillOpacity: 0.85,
  /** A thin dark outline/shadow keeps it legible on light backgrounds too. */
  shadowOpacity: 0.4,
} as const

/** Compute the font size + edge margin for an asset of the given pixel/point size. */
export function watermarkGeometry(width: number, height: number) {
  const short = Math.min(width, height)
  const fontSize = Math.round(
    Math.max(WATERMARK_STYLE.minFontPx, Math.min(WATERMARK_STYLE.maxFontPx, short * WATERMARK_STYLE.fontScale))
  )
  const margin = Math.round(Math.max(WATERMARK_STYLE.minMarginPx, short * WATERMARK_STYLE.marginScale))
  return { fontSize, margin }
}
