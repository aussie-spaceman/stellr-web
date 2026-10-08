import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import { inflateSync } from 'zlib'
import { BADGE_FORMATS, artworkBox, spareCount, badgeFormatForKind, badgeName, findNameLine, isBadgeFormat, nameSetting, pickTemplate, placementFromLine } from './badge-layout'
import { prepareBadgeArtwork, wantsLightInk } from './badge-artwork'
import { generateBadgesPdf } from './event-pdf'

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

describe('the CO SDC artwork (regression, 28 Sept)', () => {
  // The real set: a two-line title, a rule that climbs ~8px across 570px,
  // and ribbon swirls in the corners. The rule was found only from its middle
  // rightwards, so names sat right of centre and long ones shrank to nothing.
  const coArt = () =>
    art(
      `<text x="500" y="120" font-size="90" text-anchor="middle" font-family="Helvetica" font-weight="bold">2027 SPACE</text>` +
        `<text x="500" y="210" font-size="90" text-anchor="middle" font-family="Helvetica" font-weight="bold">DESIGN COMPETITION</text>` +
        `<line x1="230" y1="362" x2="770" y2="352" stroke="#111" stroke-width="3"/>` +
        `<path d="M0 300 C 120 500, 300 600, 420 700" stroke="#3b64c8" stroke-width="2" fill="none"/>` +
        `<path d="M0 320 C 140 520, 320 620, 440 700" stroke="#3b64c8" stroke-width="2" fill="none"/>` +
        `<path d="M1000 480 C 860 520, 800 620, 780 700" stroke="#e0a830" stroke-width="2" fill="none"/>` +
        `<circle cx="500" cy="560" r="70" fill="#13183a"/>`,
    )

  it('finds the whole sloping rule, centred', async () => {
    const line = findNameLine(await raw(await coArt()))
    expect(line).not.toBeNull()
    expect(line!.x0).toBeCloseTo(0.23, 1)
    expect(line!.x1).toBeCloseTo(0.77, 1)
    expect((line!.x0 + line!.x1) / 2).toBeCloseTo(0.5, 1)
    expect(line!.y).toBeGreaterThan(348 / H)
    expect(line!.y).toBeLessThan(366 / H)
  })

  it('places the name centred, just on the rule, with room for a long name', async () => {
    const prepared = await prepareBadgeArtwork(await coArt(), 'avery_8395')
    const p = placementFromLine(prepared.line, 'avery_8395')
    expect(p.nameX).toBeCloseTo(0.5, 1)
    // Baseline within ~6pt above the rule's top.
    const gapPt = (prepared.line!.y - p.nameY) * artworkBox('avery_8395').height
    expect(gapPt).toBeGreaterThan(0)
    expect(gapPt).toBeLessThan(6)
    expect(p.nameMaxWidth).toBeGreaterThanOrEqual(0.6)
    expect(p.nameSize).toBeLessThanOrEqual(BADGE_FORMATS.avery_8395.maxNameSize)
    expect(wantsLightInk(prepared.analysis, p, 'avery_8395')).toBe(false)
  })
})

describe('placementFromLine', () => {
  it('stays inside the label when the rule runs to the edge', () => {
    const p = placementFromLine({ y: 0.6, x0: 0, x1: 1, clear: 0.3 }, 'avery_8395')
    expect(p.nameX - p.nameMaxWidth / 2).toBeGreaterThan(0.04)
    expect(p.nameX + p.nameMaxWidth / 2).toBeLessThan(0.96)
  })

  it('centres the name when there is no rule', () => {
    const p = placementFromLine(null, 'avery_5392')
    expect(p.nameX).toBe(0.5)
    expect(p.nameSize).toBe(BADGE_FORMATS.avery_5392.maxNameSize)
  })

  it('maps to page points with y up', () => {
    const s = nameSetting({ x: 10, y: 20, width: 200, height: 100 }, { nameX: 0.5, nameY: 0.25, nameMaxWidth: 0.5, nameSize: 20 })
    expect(s).toEqual({ centerX: 110, baselineY: 95, maxWidth: 100, size: 20 })
  })
})

describe('spareCount', () => {
  it('fills the last sheet and adds one full sheet', () => {
    // 8395: 8 per sheet.
    expect(spareCount(9, 'avery_8395')).toBe(7 + 8)
    expect(spareCount(16, 'avery_8395')).toBe(8)
    expect(spareCount(0, 'avery_8395')).toBe(8)
    // 5392: 6 per sheet.
    expect(spareCount(5, 'avery_5392')).toBe(1 + 6)
    expect(spareCount(12, 'avery_5392')).toBe(6)
  })

  it('always leaves at least one whole page of spares, ending on a full sheet', () => {
    for (const f of ['avery_5392', 'avery_8395'] as const) {
      const per = BADGE_FORMATS[f].cols * BADGE_FORMATS[f].rows
      for (let n = 1; n <= 30; n++) {
        const spares = spareCount(n, f)
        expect(spares).toBeGreaterThanOrEqual(per)
        expect((n + spares) % per).toBe(0)
      }
    }
  })
})

describe('pickTemplate', () => {
  const everyone = { audience: 'everyone' as const, companyId: null, id: 'e' }
  const mentors = { audience: 'mentors' as const, companyId: null, id: 'm' }
  const c1 = { audience: 'company' as const, companyId: 'c1', id: 'c1' }
  const all = [everyone, mentors, c1]

  it('prefers the company, then mentors, then everyone', () => {
    expect(pickTemplate(all, { companyId: 'c1', mentor: false })?.id).toBe('c1')
    expect(pickTemplate(all, { companyId: 'c2', mentor: false })?.id).toBe('e')
    expect(pickTemplate(all, { companyId: null, mentor: true })?.id).toBe('m')
    expect(pickTemplate(all, { companyId: null, mentor: false })?.id).toBe('e')
  })

  it('keeps a mentor with a company on the mentors design, else their company', () => {
    expect(pickTemplate(all, { companyId: 'c1', mentor: true })?.id).toBe('m')
    expect(pickTemplate([everyone, c1], { companyId: 'c1', mentor: true })?.id).toBe('c1')
  })

  it('falls back to a plain badge with no templates, and mentors to everyone', () => {
    expect(pickTemplate([], { companyId: null, mentor: true })).toBeNull()
    expect(pickTemplate([everyone], { companyId: null, mentor: true })?.id).toBe('e')
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
  const people = Array.from({ length: 9 }, (_, i) => ({
    person: { firstName: `First${i}`, lastName: `Last${i}`, subtitle: 'Student' },
    design: null,
  }))

  it('puts 6 per page on 5392 and 8 per page on 8395', async () => {
    const a = await PDFDocument.load(await generateBadgesPdf(people, 'Test Event', 'avery_5392'))
    expect(a.getPageCount()).toBe(2)
    const b = await PDFDocument.load(await generateBadgesPdf(people, 'Test Event', 'avery_8395'))
    expect(b.getPageCount()).toBe(2)
    expect(b.getPage(0).getSize()).toEqual({ width: 612, height: 792 })
    expect(b.getKeywords()).toContain('stellr-watermarked')
  })

  it('crops artwork to the label shape and mixes designs on one sheet', async () => {
    const prepared = await prepareBadgeArtwork(await art(rule(420)), 'avery_8395')
    const meta = await sharp(Buffer.from(prepared.bytes)).metadata()
    const spec = BADGE_FORMATS.avery_8395
    expect(meta.width! / meta.height!).toBeCloseTo((spec.width + 2 * spec.bleed) / (spec.height + 2 * spec.bleed), 2)
    const design = { key: 't1', artwork: prepared, placement: placementFromLine(prepared.line, 'avery_8395'), lightInk: false }
    const pdf = await generateBadgesPdf(
      [
        { person: { firstName: 'Maximiliana-Josephine', lastName: 'Worthington-Fotheringham', subtitle: 'Mentor' }, design },
        { person: { firstName: 'Leon', lastName: 'Buk', subtitle: 'Student' }, design: null },
      ],
      'Test Event',
      'avery_8395',
    )
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1)
  })

  it('draws no text on a spare badge with a background', async () => {
    const prepared = await prepareBadgeArtwork(await art(rule(420)), 'avery_8395')
    const design = { key: 't1', artwork: prepared, placement: placementFromLine(prepared.line, 'avery_8395'), lightInk: false }
    const blank = { firstName: '', lastName: '', subtitle: '' }
    const pdf = await generateBadgesPdf(Array.from({ length: 8 }, () => ({ person: blank, design })), 'Test Event', 'avery_8395')
    expect(textShows(pdf)).toBe(0)
    // Control: the same sheet with names draws one per badge.
    const named = await generateBadgesPdf(
      Array.from({ length: 8 }, (_, i) => ({ person: { firstName: 'Ada', lastName: `L${i}`, subtitle: '' }, design })),
      'Test Event',
      'avery_8395',
    )
    expect(textShows(named)).toBe(8)
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1)
  })

  it('renders a single label page for the preview', async () => {
    const pdf = await generateBadgesPdf(people.slice(0, 1), '', 'avery_8395', { single: true })
    const size = (await PDFDocument.load(pdf)).getPage(0).getSize()
    expect(size.width).toBeCloseTo(artworkBox('avery_8395').width, 3)
    expect(size.height).toBeCloseTo(artworkBox('avery_8395').height, 3)
  })
})
