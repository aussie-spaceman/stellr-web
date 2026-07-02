import sharp from 'sharp'
import { WATERMARK_TEXT, watermarkGeometry } from './config'

// Bakes "© Stellr Education" into the bottom-right corner of an image, in the
// image's own pixels — so a right-click "Save image", a screenshot crop or a
// hot-link all carry the mark. Used by the /public photo backfill script and by
// the on-the-fly Sanity/CDN watermark route.
//
// The mark is an SVG <text> composited over the source at the south-east gravity.
// A dark outline (paint-order: stroke) keeps white text readable on light and
// dark photos alike. Output format + quality mirror the input so we don't bloat
// the AVIF/JPEG/PNG assets the site already serves.

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string))
}

function overlaySvg(width: number, height: number): Buffer {
  const { fontSize, margin } = watermarkGeometry(width, height)
  const x = width - margin
  const y = height - margin
  const stroke = Math.max(1, fontSize * 0.07)
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <text x="${x}" y="${y}" text-anchor="end"
        font-family="Helvetica, Arial, sans-serif" font-weight="600" font-size="${fontSize}"
        fill="#ffffff" fill-opacity="0.9"
        stroke="#000000" stroke-opacity="0.4" stroke-width="${stroke}"
        paint-order="stroke" style="paint-order:stroke">${escapeXml(WATERMARK_TEXT)}</text>
</svg>`
  return Buffer.from(svg)
}

export type WatermarkFormat = 'avif' | 'webp' | 'png' | 'jpeg'

/**
 * Return a copy of `input` with the watermark composited in. Preserves the source
 * format by default (avif/webp/jpeg/png); pass `outputFormat` to force the encoder
 * — used by the backfill's ffmpeg fallback, which decodes an unreadable AVIF to a
 * raster buffer and needs it re-encoded back to AVIF. Very small images (shorter
 * edge below `minEdge`) are returned untouched — the mark would be illegible.
 */
export async function watermarkImageBuffer(
  input: Buffer,
  opts?: { minEdge?: number; outputFormat?: WatermarkFormat }
): Promise<Buffer> {
  const minEdge = opts?.minEdge ?? 96
  const base = sharp(input, { failOn: 'none' })
  const meta = await base.metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  if (!width || !height || Math.min(width, height) < minEdge) return input

  // The overlay is the full image size with the text already positioned bottom-right,
  // so composite it at the origin.
  const composited = base.composite([{ input: overlaySvg(width, height), top: 0, left: 0 }])

  const format = opts?.outputFormat ?? (meta.format as WatermarkFormat | undefined)
  switch (format) {
    case 'avif':
      return composited.avif({ quality: 55, effort: 4 }).toBuffer()
    case 'webp':
      return composited.webp({ quality: 82 }).toBuffer()
    case 'png':
      return composited.png({ compressionLevel: 9 }).toBuffer()
    case 'jpeg':
    default:
      return composited.jpeg({ quality: 82, mozjpeg: true }).toBuffer()
  }
}
