import { PDFDocument, PDFPageLeaf, PDFPageTree, StandardFonts, rgb } from 'pdf-lib'
import { WATERMARK_MARKER, WATERMARK_TEXT, watermarkGeometry } from './config'

// Stamps "© Stellr Education" into the bottom-right corner of every page of a PDF.
//
// Two entry points:
//   - stampPdfDocument(doc): mutates an already-open PDFDocument (used by the
//     cert/badge generators, which build the doc and then save it).
//   - stampPdfBytes(bytes): loads raw PDF bytes, stamps them, and returns new
//     bytes — run in-process by the static-file backfill, and inside the
//     sandbox worker (lib/pdf-sandbox.ts) for uploads. An upload's bytes go
//     through stampPdfSandboxed, never straight here: pdf-lib can be made to
//     loop or exhaust memory by a crafted file.
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

/** Set the marker without drawing the mark — for print artwork that must carry nothing but its own words. */
export function markWatermarked(doc: PDFDocument) {
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

/**
 * The pages of an open document, counted the way pdf-lib builds them (a leaf
 * of the page tree typed /Page) but without its blind spots: pdf-lib walks the
 * tree once per mention, so a page — or a whole branch — listed twice is
 * stamped twice, and a branch listing itself never ends. Twenty nested nodes
 * that each list their child twice is a million pages from forty objects. So
 * any node reached a second time, or a tree pdf-lib can't walk, is null.
 * Counting stops past `max`. Linear in the tree's distinct nodes.
 */
export function countPageTree(doc: PDFDocument, max = Infinity): number | null {
  let root: PDFPageTree
  try {
    root = doc.catalog.Pages()
  } catch {
    return null
  }
  if (!(root instanceof PDFPageTree)) return null
  const seen = new Set<unknown>([root])
  const pending: PDFPageTree[] = [root]
  let pages = 0
  while (pending.length) {
    const node = pending.pop() as PDFPageTree
    let kids
    try {
      kids = node.Kids()
    } catch {
      return null
    }
    for (let i = 0, n = kids.size(); i < n; i++) {
      const kid = doc.context.lookup(kids.get(i))
      if (!(kid instanceof PDFPageTree) && !(kid instanceof PDFPageLeaf)) continue
      if (seen.has(kid)) return null
      seen.add(kid)
      if (kid instanceof PDFPageTree) pending.push(kid)
      else if (++pages > max) return pages
    }
  }
  return pages
}

/**
 * The most pages stampPdfBytes stamps. A member's PDF is capped at 50 before it
 * gets here (lib/pdf-page-count); this backstops any path that skipped that,
 * and still fits the longest handbook an admin shares.
 */
export const MAX_STAMP_PAGES = 2000

/**
 * Load raw PDF bytes, stamp them, and return the stamped bytes. No-op if
 * already stamped. Throws on a page tree that lists a node twice or can't be
 * walked (countPageTree), or that has more than MAX_STAMP_PAGES pages, before
 * pdf-lib walks it.
 */
export async function stampPdfBytes(bytes: Uint8Array | ArrayBuffer): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes)
  const pages = countPageTree(doc, MAX_STAMP_PAGES)
  if (pages === null) throw new Error('PDF page tree repeats a node or cannot be read')
  if (pages > MAX_STAMP_PAGES) throw new Error(`PDF has more than ${MAX_STAMP_PAGES} pages to stamp`)
  if (pdfHasWatermark(doc)) return doc.save()
  await stampPdfDocument(doc)
  return doc.save()
}
