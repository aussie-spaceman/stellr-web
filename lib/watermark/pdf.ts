import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { WATERMARK_MARKER, WATERMARK_TEXT, watermarkGeometry } from './config'

// Stamps "© Stellr Education" into the bottom-right corner of every page of a PDF.
//
// Two entry points:
//   - stampPdfDocument(doc): mutates an already-open PDFDocument (used by the
//     cert/badge generators, which build the doc and then save it).
//   - stampPdfBytes(bytes): loads raw PDF bytes, stamps them, and returns new
//     bytes — used by the static-file backfill and the resource-upload routes.
//
// A translucent white pill sits behind the text so the mark stays legible over
// any artwork/background, then dark ink text is drawn on top. Each stamped PDF
// gets the WATERMARK_MARKER keyword so we never double-stamp.

const INK = rgb(0.09, 0.11, 0.18)
const PILL = rgb(1, 1, 1)

/** True when an uploaded file looks like a PDF (by mime or extension). */
export function isPdf(name: string, mime?: string | null): boolean {
  return mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf')
}

export function pdfHasWatermark(doc: PDFDocument): boolean {
  return (doc.getKeywords() ?? '').includes(WATERMARK_MARKER)
}

function markWatermarked(doc: PDFDocument) {
  const existing = doc.getKeywords()
  const parts = existing ? existing.split(/[\s,]+/).filter(Boolean) : []
  if (!parts.includes(WATERMARK_MARKER)) parts.push(WATERMARK_MARKER)
  doc.setKeywords(parts)
}

/** Draw the mark on every page of an open document. Idempotent via the keyword marker. */
export async function stampPdfDocument(doc: PDFDocument): Promise<void> {
  if (pdfHasWatermark(doc)) return
  const font = await doc.embedFont(StandardFonts.Helvetica)

  for (const page of doc.getPages()) {
    const { width, height } = page.getSize()
    // PDFs are vector; base the size on the page but keep the mark small.
    const { margin } = watermarkGeometry(width, height)
    const size = Math.max(8, Math.min(13, Math.round(Math.min(width, height) * 0.014)))
    const textWidth = font.widthOfTextAtSize(WATERMARK_TEXT, size)
    const padX = size * 0.5
    const padY = size * 0.35
    const x = width - margin - textWidth
    const y = margin

    // Legibility pill behind the text.
    page.drawRectangle({
      x: x - padX,
      y: y - padY,
      width: textWidth + padX * 2,
      height: size + padY * 2,
      color: PILL,
      opacity: 0.6,
    })
    page.drawText(WATERMARK_TEXT, { x, y, size, font, color: INK, opacity: 0.9 })
  }

  markWatermarked(doc)
}

/** Load raw PDF bytes, stamp them, and return the stamped bytes. No-op if already stamped. */
export async function stampPdfBytes(bytes: Uint8Array | ArrayBuffer): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes)
  if (pdfHasWatermark(doc)) return doc.save()
  await stampPdfDocument(doc)
  return doc.save()
}
