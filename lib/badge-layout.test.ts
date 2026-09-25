import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import { BADGE_FORMATS, badgeFormatForKind, badgeName, findNameLine, isBadgeFormat, nameSetting } from './badge-layout'
import { prepareBadgeArtwork } from './badge-artwork'
import { generateBadgesPdf } from './event-pdf'

const W = 1000
const H = 700

/** Artwork from SVG body markup on a W×H canvas. */
async function art(body: string, background = '#ffffff', format: 'png' | 'jpeg' = 'png') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="${background}"/>${body}</svg>`
  const img = sharp(Buffer.from(svg))
  const bytes = format === 'png' ? await img.png().toBuffer() : await img.jpeg({ quality: 70 }).toBuffer()
  return { bytes: new Uint8Array(bytes), mime: format === 'png' ? 'image/png' : 'image/jpeg' }
}

async function raw(a: { bytes: Uint8Array }) {
  const { data, info } = await sharp(Buffer.from(a.bytes)).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data: new Uint8Array(data), width: info.width, height: info.height }
}

const rule = (y: number, x0 = 150, x1 = 850, thick = 5, colour = '#13183a') =>
  `<rect x="${x0}" y="${y}" width="${x1 - x0}" height="${thick}" fill="${colour}"/>`

describe('findNameLine', () => {
  it('finds a centred rule and its span', async () => {
    const line = findNameLine(await raw(await art(rule(350))))
    expect(line).not.toBeNull()
    expect(line!.y).toBeCloseTo(350 / H, 2)
    expect(line!.x0).toBeCloseTo(0.15, 2)
    expect(line!.x1).toBeCloseTo(0.85, 2)
    expect(line!.backgroundLuma).toBeGreaterThan(200)
  })

  it('finds a rule that is not vertically centred', async () => {
    const line = findNameLine(await raw(await art(rule(480))))
    expect(line!.y).toBeCloseTo(480 / H, 2)
  })

  it('ignores the edge of a colour band and finds the rule below it', async () => {
    // A full-width header band: its bottom edge is long, but never steps back.
    const line = findNameLine(await raw(await art(`<rect width="${W}" height="160" fill="#2b2f7a"/>${rule(420, 200, 800)}`)))
    expect(line!.y).toBeCloseTo(420 / H, 2)
  })

  it('measures the clear space above the rule, stopping at artwork', async () => {
    const line = findNameLine(await raw(await art(`<rect x="300" y="100" width="400" height="120" fill="#7a3"/>${rule(400)}`)))
    // Clear from the rule up to the block's bottom edge at 220.
    expect(line!.clear * H).toBeGreaterThan(170)
    expect(line!.clear * H).toBeLessThan(185)
  })

  it('reads a light rule on a dark background', async () => {
    const line = findNameLine(await raw(await art(rule(380, 150, 850, 4, '#ffffff'), '#0b0e2a')))
    expect(line!.y).toBeCloseTo(380 / H, 2)
    expect(line!.backgroundLuma).toBeLessThan(60)
  })

  it('survives JPEG compression and a hairline', async () => {
    const line = findNameLine(await raw(await art(rule(360, 150, 850, 2, '#555555'), '#ffffff', 'jpeg')))
    expect(line!.y).toBeCloseTo(360 / H, 2)
  })

  it('prefers the rule with room above it when two are alike', async () => {
    const line = findNameLine(await raw(await art(`${rule(60)}${rule(420)}`)))
    expect(line!.y).toBeCloseTo(420 / H, 2)
  })

  it('returns null when there is no rule', async () => {
    expect(findNameLine(await raw(await art('<circle cx="500" cy="350" r="120" fill="#2b2f7a"/>')))).toBeNull()
  })
})

describe('nameSetting', () => {
  const box = { x: 0, y: 0, width: 288, height: 216 }
  const label = { x: 0, width: 288, height: 216 }

  it('sets the baseline just above the rule and keeps the name inside the clear space', () => {
    const line = { y: 0.6, x0: 0.15, x1: 0.85, clear: 0.2, backgroundLuma: 255 }
    const s = nameSetting(box, label, line, 30)
    const ruleTop = 216 * 0.4
    expect(s.baselineY).toBeGreaterThan(ruleTop)
    // Cap height stays below the top of the clear space.
    expect(s.baselineY + s.size * 0.75).toBeLessThanOrEqual(ruleTop + 216 * 0.2)
    expect(s.centerX).toBeCloseTo(144, 6)
    expect(s.maxWidth).toBeLessThanOrEqual(288 * 0.7)
  })

  it('centres on the label when there is no rule', () => {
    const s = nameSetting(box, label, null, 30)
    expect(s.size).toBe(30)
    expect(s.centerX).toBe(144)
  })
})

describe('formats', () => {
  it('fit every label on a US Letter page without overlap', () => {
    for (const spec of Object.values(BADGE_FORMATS)) {
      expect(spec.left + (spec.cols - 1) * spec.pitchX + spec.width).toBeLessThanOrEqual(8.5)
      expect(spec.top + (spec.rows - 1) * spec.pitchY + spec.height).toBeLessThanOrEqual(11)
      expect(spec.pitchX).toBeGreaterThanOrEqual(spec.width)
      expect(spec.pitchY).toBeGreaterThanOrEqual(spec.height)
      // Bleed only where there is a gap to bleed into.
      expect(spec.bleed * 2).toBeLessThanOrEqual(Math.min(spec.pitchX - spec.width, spec.pitchY - spec.height) + 1e-9)
    }
  })

  it('map upload kinds back to formats without prefix collisions', () => {
    expect(badgeFormatForKind('badge')).toBe('avery_5392')
    expect(badgeFormatForKind('badge8395')).toBe('avery_8395')
    expect(badgeFormatForKind('certificate-participation')).toBeNull()
    expect(isBadgeFormat('avery_8395')).toBe(true)
    expect(isBadgeFormat('avery_9999')).toBe(false)
    // The artwork route checks paths by `${kind}-` prefix.
    expect('badge8395-1.png'.startsWith('badge-')).toBe(false)
  })

  it('joins first and last name', () => {
    expect(badgeName(' Ada ', 'Lovelace ')).toBe('Ada Lovelace')
    expect(badgeName('Cher', '')).toBe('Cher')
  })
})

describe('generateBadgesPdf', () => {
  const people = Array.from({ length: 9 }, (_, i) => ({ firstName: `First${i}`, lastName: `Last${i}`, subtitle: 'Student' }))

  it('puts 6 per page on 5392 and 8 per page on 8395', async () => {
    const a = await PDFDocument.load(await generateBadgesPdf(people, 'Test Event', 'avery_5392', null))
    expect(a.getPageCount()).toBe(2)
    const b = await PDFDocument.load(await generateBadgesPdf(people, 'Test Event', 'avery_8395', null))
    expect(b.getPageCount()).toBe(2)
    expect(b.getPage(0).getSize()).toEqual({ width: 612, height: 792 })
    expect(b.getKeywords()).toContain('stellr-watermarked')
  })

  it('crops artwork to the label shape and finds its rule', async () => {
    const prepared = await prepareBadgeArtwork(await art(rule(420)), 'avery_8395')
    const meta = await sharp(Buffer.from(prepared.bytes)).metadata()
    const spec = BADGE_FORMATS.avery_8395
    expect(meta.width! / meta.height!).toBeCloseTo((spec.width + 2 * spec.bleed) / (spec.height + 2 * spec.bleed), 2)
    expect(prepared.line).not.toBeNull()
    const pdf = await generateBadgesPdf(
      [{ firstName: 'Maximiliana-Josephine', lastName: 'Worthington-Fotheringham', subtitle: 'Mentor' }],
      'Test Event',
      'avery_8395',
      prepared,
    )
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1)
  })
})
