import { describe, it, expect } from 'vitest'
import { PDFDocument, PDFName } from 'pdf-lib'
import { countPageTree, isPdf, pdfHasWatermark, stampPdfDocument, stampPdfBytes } from './pdf'

async function makePdf(pages = 3): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([612, 792])
  return doc.save()
}

describe('isPdf', () => {
  it('detects by mime and extension', () => {
    expect(isPdf('a.pdf', 'application/pdf')).toBe(true)
    expect(isPdf('A.PDF', null)).toBe(true)
    expect(isPdf('doc.pdf', 'application/octet-stream')).toBe(true)
    expect(isPdf('image.png', 'image/png')).toBe(false)
  })
})

describe('stampPdfDocument', () => {
  it('marks the doc, preserves page count, and is idempotent', async () => {
    const doc = await PDFDocument.load(await makePdf(3))
    expect(pdfHasWatermark(doc)).toBe(false)
    await stampPdfDocument(doc)
    expect(pdfHasWatermark(doc)).toBe(true)
    expect(doc.getPageCount()).toBe(3)
    // second pass is a no-op (still marked, no throw)
    await stampPdfDocument(doc)
    expect(pdfHasWatermark(doc)).toBe(true)
  })
})

describe('stampPdfBytes', () => {
  it('returns marked bytes and does not re-stamp already-marked input', async () => {
    const once = await stampPdfBytes(await makePdf(2))
    const reloaded = await PDFDocument.load(once)
    expect(pdfHasWatermark(reloaded)).toBe(true)
    expect(reloaded.getPageCount()).toBe(2)

    // Feeding stamped bytes back in keeps exactly one marker (idempotent).
    const twice = await stampPdfBytes(once)
    const kw = (await PDFDocument.load(twice)).getKeywords() ?? ''
    expect(kw.match(/stellr-watermarked/g)?.length).toBe(1)
  })
})

describe('countPageTree', () => {
  it('counts the pages pdf-lib would, and stops past a limit', async () => {
    const doc = await PDFDocument.load(await makePdf(5))
    expect(countPageTree(doc)).toBe(5)
    expect(countPageTree(doc, 3)).toBe(4)
  })

  // pdf-lib walks the tree once per mention: a page listed twice is stamped
  // twice, and nested branches listed twice double at every level.
  it('refuses a tree that lists a page twice, and stampPdfBytes won’t stamp it', async () => {
    const doc = await PDFDocument.load(await makePdf(1))
    const kids = doc.catalog.Pages().Kids()
    kids.push(kids.get(0))
    expect(countPageTree(doc)).toBeNull()
    await expect(stampPdfBytes(await doc.save({ useObjectStreams: false }))).rejects.toThrow(/page tree/)
  })

  it('refuses a branch that lists itself', async () => {
    const doc = await PDFDocument.load(await makePdf(1))
    const root = doc.catalog.get(PDFName.of('Pages'))
    if (!root) throw new Error('no page tree')
    doc.catalog.Pages().Kids().push(root)
    expect(countPageTree(doc)).toBeNull()
  })
})
