import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import { DEFAULT_PD_LAYOUT, formatActivityDate, parsePdLayout, pdArtworkTexts, pdCertificateLines, renderPdCertificatePdf, wrapList, type PdCertificateFields } from './pd-certificate'
import { pdStandardCodes } from './pd-standards'

const FIELDS: PdCertificateFields = {
  recipientName: 'Maria Gordon',
  hours: 8,
  eventTitle: 'Sample STEM Competition',
  activityDate: '2026-10-04',
  activityLocation: 'Sample High School, Springfield, CO',
  standards: pdStandardCodes(),
  number: 'STL-2026-7K3MQ8ZD',
  verifyUrl: 'www.stellreducation.org/credentials/STL-2026-7K3MQ8ZD',
  issuer: 'Stellr Education',
}

describe('pdCertificateLines', () => {
  const lines = pdCertificateLines(FIELDS)

  it('puts the hours, event, day and place on the certificate', () => {
    expect(lines.name).toBe('Maria Gordon')
    expect(lines.statement).toBe('completed 8 hours of professional development supporting')
    expect(lines.event).toBe('Sample STEM Competition')
    expect(lines.when).toBe('October 4, 2026 · Sample High School, Springfield, CO')
  })

  it('lists the standards by code on the plain page', () => {
    expect(lines.ccss.startsWith('Common Core: MP1 · MP2')).toBe(true)
    expect(lines.ngss).toBe('')
  })

  it('carries the number and where to verify it', () => {
    expect(lines.verify).toContain('STL-2026-7K3MQ8ZD')
    expect(lines.verify).toContain('www.stellreducation.org/credentials/STL-2026-7K3MQ8ZD')
  })

  it('drops what is missing rather than printing blanks', () => {
    const l = pdCertificateLines({ ...FIELDS, activityDate: null, activityLocation: null, standards: [] })
    expect(l.when).toBe('')
    expect(l.ngss).toBe('')
    expect(l.ccss).toBe('')
  })
})

describe('formatActivityDate', () => {
  // A calendar day, not an instant: never shifted by the server's time zone.
  it('reads YYYY-MM-DD as that day', () => {
    expect(formatActivityDate('2026-10-04')).toBe('October 4, 2026')
    expect(formatActivityDate(null)).toBeNull()
    expect(formatActivityDate('soon')).toBeNull()
  })
})

describe('renderPdCertificatePdf', () => {
  const png = () => sharp({ create: { width: 2000, height: 1500, channels: 3, background: '#fffcf2' } }).png().toBuffer()

  it('draws one plain US Letter landscape page when no artwork is uploaded', async () => {
    const doc = await PDFDocument.load(await renderPdCertificatePdf(FIELDS, { front: null, back: null }))
    expect(doc.getPageCount()).toBe(1)
    expect(Object.values(doc.getPage(0).getSize())).toEqual([792, 612])
  })

  // 8 Oct: the first upload printed every plain-page field over a design that
  // already says them. On artwork, only the four fields are drawn.
  it('prints front then back, two pages, on uploaded artwork', async () => {
    const art = { bytes: new Uint8Array(await png()), mime: 'image/png' }
    const doc = await PDFDocument.load(await renderPdCertificatePdf({ ...FIELDS, recipientName: 'A'.repeat(200) }, { front: art, back: art }))
    expect(doc.getPageCount()).toBe(2)
  })

  it('prints the front alone when no back is uploaded', async () => {
    const art = { bytes: new Uint8Array(await png()), mime: 'image/png' }
    const doc = await PDFDocument.load(await renderPdCertificatePdf(FIELDS, { front: art, back: null }))
    expect(doc.getPageCount()).toBe(1)
  })

  it('refuses artwork it cannot read', async () => {
    const bad = { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' }
    await expect(renderPdCertificatePdf(FIELDS, { front: bad, back: null })).rejects.toThrow(/front artwork could not be read/)
  })
})

describe('pdArtworkTexts', () => {
  it('fills the four gaps in the Cowork front', () => {
    expect(pdArtworkTexts(FIELDS)).toEqual({
      name: 'Maria Gordon',
      location: 'at Sample High School, Springfield, CO',
      date: 'on October 4, 2026',
      hours: '8',
    })
  })
  it('leaves a gap empty rather than printing "at" with no place', () => {
    const t = pdArtworkTexts({ ...FIELDS, activityLocation: null, activityDate: null })
    expect(t.location).toBe('')
    expect(t.date).toBe('')
  })
})

describe('parsePdLayout', () => {
  it('accepts the defaults and rejects anything incomplete or out of range', () => {
    expect(parsePdLayout(DEFAULT_PD_LAYOUT)).toEqual(DEFAULT_PD_LAYOUT)
    expect(parsePdLayout({ ...DEFAULT_PD_LAYOUT, hours: undefined })).toBeNull()
    expect(parsePdLayout({ ...DEFAULT_PD_LAYOUT, name: { ...DEFAULT_PD_LAYOUT.name, y: 1.5 } })).toBeNull()
    expect(parsePdLayout({ ...DEFAULT_PD_LAYOUT, date: { ...DEFAULT_PD_LAYOUT.date, size: 'big' } })).toBeNull()
    expect(parsePdLayout('nope')).toBeNull()
  })
})

describe('wrapList', () => {
  // 7 Oct: the Common Core line shrank to ~5pt on one line — unreadable in print.
  it('splits a long list at the separator nearest the middle', () => {
    expect(wrapList('a · bb · cc · d', () => false)).toEqual(['a · bb', 'cc · d'])
  })
  it('leaves a line that fits, or one with nothing to split, alone', () => {
    expect(wrapList('a · b', () => true)).toEqual(['a · b'])
    expect(wrapList('Alexandra Montgomery-Whitfield', () => false)).toEqual(['Alexandra Montgomery-Whitfield'])
  })
})
