import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import { formatActivityDate, pdCertificateLines, renderPdCertificatePdf, wrapList, type PdCertificateFields } from './pd-certificate'
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

  it('splits the standards by framework', () => {
    expect(lines.ngss.startsWith('NGSS: NGSS SEP 1')).toBe(true)
    expect(lines.ccss.startsWith('Common Core: CCSS.MATH.PRACTICE.MP1')).toBe(true)
    expect(lines.ngss).not.toContain('CCSS')
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
  it('draws one US Letter landscape page on the plain design', async () => {
    const bytes = await renderPdCertificatePdf(FIELDS, null)
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
    const { width, height } = doc.getPage(0).getSize()
    expect([width, height]).toEqual([792, 612])
  })

  it('draws on uploaded artwork', async () => {
    const png = await sharp({ create: { width: 1100, height: 850, channels: 3, background: '#ffffff' } }).png().toBuffer()
    const bytes = await renderPdCertificatePdf({ ...FIELDS, recipientName: 'A'.repeat(200) }, { bytes: new Uint8Array(png), mime: 'image/png' })
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(1)
  })

  it('refuses artwork it cannot read', async () => {
    await expect(renderPdCertificatePdf(FIELDS, { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' })).rejects.toThrow(/could not be read/)
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
