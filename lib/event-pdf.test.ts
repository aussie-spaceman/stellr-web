import { describe, it, expect } from 'vitest'
import { inflateSync } from 'zlib'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import {
  DEFAULT_NAME_PLACEMENT,
  coverFit,
  fittedSize,
  generateCertificatesPdf,
  nameBox,
  pageSizeFor,
} from './event-pdf'

const LETTER = pageSizeFor('us_letter')
const A4 = pageSizeFor('a4')

describe('coverFit', () => {
  it('keeps the aspect ratio and covers the page', () => {
    // The Canva set: 2000×1500 (4:3) onto US Letter (11:8.5).
    // 4:3 is wider than Letter's 11:8.5, so the height fills and the sides trim.
    const fit = coverFit(2000, 1500, LETTER[0], LETTER[1])
    expect(fit.width / fit.height).toBeCloseTo(4 / 3, 6)
    expect(fit.height).toBeCloseTo(LETTER[1], 6)
    expect(fit.width).toBeGreaterThanOrEqual(LETTER[0])
    // Centre-cropped: equal overhang left and right.
    expect(fit.x).toBeCloseTo(-(fit.width - LETTER[0]) / 2, 6)
    expect(fit.y).toBeCloseTo(0, 6)
  })

  it('trims top and bottom instead when the page is wider than the art (A4)', () => {
    const fit = coverFit(2000, 1500, A4[0], A4[1])
    expect(fit.width).toBeCloseTo(A4[0], 6)
    expect(fit.y).toBeLessThan(0)
  })
})

describe('nameBox', () => {
  it('puts the baseline at the same point on the artwork for Letter and A4', () => {
    const letterFit = coverFit(2000, 1500, LETTER[0], LETTER[1])
    for (const [w, h] of [LETTER, A4]) {
      const fit = coverFit(2000, 1500, w, h)
      const box = nameBox(fit, DEFAULT_NAME_PLACEMENT, letterFit.height)
      // Back from page points to a fraction of the artwork, from the top.
      const fromTop = (fit.y + fit.height - box.baselineY) / fit.height
      expect(fromTop).toBeCloseTo(DEFAULT_NAME_PLACEMENT.nameY, 6)
      expect(box.centerX).toBeCloseTo(w / 2, 6)
      expect(box.maxWidth).toBeCloseTo(fit.width * DEFAULT_NAME_PLACEMENT.nameMaxWidth, 6)
    }
  })

  it('uses the stored size on Letter and scales it with the art on A4', () => {
    const letterFit = coverFit(2000, 1500, LETTER[0], LETTER[1])
    expect(nameBox(letterFit, DEFAULT_NAME_PLACEMENT, letterFit.height).size).toBe(40)
    const a4Fit = coverFit(2000, 1500, A4[0], A4[1])
    expect(nameBox(a4Fit, DEFAULT_NAME_PLACEMENT, letterFit.height).size).toBeCloseTo(40 * (a4Fit.height / letterFit.height), 6)
  })
})

describe('fittedSize', () => {
  const widthAt = (s: number) => s * 10 // a 10-em-wide name
  it('keeps the size when the name fits', () => {
    expect(fittedSize(widthAt, 40, 500)).toBe(40)
  })
  it('shrinks a long name to the width', () => {
    const s = fittedSize(widthAt, 40, 300)
    expect(widthAt(s)).toBeLessThanOrEqual(300)
    expect(s).toBe(30)
  })
})

async function artwork() {
  const bytes = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#ffffff' } }).png().toBuffer()
  return { bytes: new Uint8Array(bytes), mime: 'image/png' }
}

/** Text-showing operators across every content stream in the file. */
function textShows(pdf: Uint8Array): number {
  const raw = Buffer.from(pdf).toString('latin1')
  let count = 0
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body: string
    try {
      body = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1')
    } catch {
      body = m[1]
    }
    count += (body.match(/\bTj\b|\bTJ\b/g) ?? []).length
  }
  return count
}

describe('generateCertificatesPdf', () => {
  it('draws one page per recipient and no text but the name', async () => {
    const pdf = await generateCertificatesPdf([{ name: 'Daniel Ahaiwe' }, { name: 'Leon Buk' }], 'us_letter', await artwork())
    const doc = await PDFDocument.load(pdf)
    expect(doc.getPageCount()).toBe(2)
    expect(doc.getPage(0).getSize()).toEqual({ width: LETTER[0], height: LETTER[1] })
    // One text draw per page: the name. No title, no event name, no © stamp.
    expect(textShows(pdf)).toBe(2)
    // Still marked, so nothing downstream stamps it.
    expect(doc.getKeywords()).toContain('stellr-watermarked')
  })

  it('renders A4 at A4 size', async () => {
    const doc = await PDFDocument.load(await generateCertificatesPdf([{ name: 'Leon Buk' }], 'a4', await artwork()))
    expect(doc.getPage(0).getSize()).toEqual({ width: A4[0], height: A4[1] })
  })
})
