import { describe, it, expect } from 'vitest'
import { readCredentialOptOut, formatFormDate, CREDENTIAL_OPT_OUT_TAB, formOptOuts, nameCheckboxes, optOutForStatement, statementBeside } from './docusign-form-data'

describe('formatFormDate', () => {
  it('writes an ISO date the way the form prints it (DD-MMM-YYYY)', () => {
    expect(formatFormDate('2012-04-10')).toBe('10-Apr-2012')
    expect(formatFormDate('2009-12-01T00:00:00Z')).toBe('01-Dec-2009')
  })
  it('leaves blanks blank and passes anything else through', () => {
    expect(formatFormDate(null)).toBe('')
    expect(formatFormDate(undefined)).toBe('')
    expect(formatFormDate('10/04/2012')).toBe('10/04/2012')
    expect(formatFormDate('2012-13-01')).toBe('2012-13-01')
  })
})

describe('readCredentialOptOut', () => {
  it('returns null when the tab is absent (pre-change template)', () => {
    expect(readCredentialOptOut([{ name: 'MinorName', value: 'Ada' }])).toBeNull()
  })
  it('reads a ticked box as an opt-out', () => {
    expect(readCredentialOptOut([{ name: CREDENTIAL_OPT_OUT_TAB, value: 'X' }])).toBe(true)
    expect(readCredentialOptOut([{ name: CREDENTIAL_OPT_OUT_TAB, value: 'true' }])).toBe(true)
    expect(readCredentialOptOut([{ name: 'credentialsharingoptout', value: 'on' }])).toBe(true)
  })
  it('reads an unticked box as no opt-out', () => {
    expect(readCredentialOptOut([{ name: CREDENTIAL_OPT_OUT_TAB, value: '' }])).toBe(false)
    expect(readCredentialOptOut([{ name: CREDENTIAL_OPT_OUT_TAB, value: 'false' }])).toBe(false)
  })
  it('treats any ticked copy as an opt-out when the tab appears on both roles', () => {
    expect(readCredentialOptOut([
      { name: CREDENTIAL_OPT_OUT_TAB, value: '' },
      { name: CREDENTIAL_OPT_OUT_TAB, value: 'X' },
    ])).toBe(true)
  })
})

describe('naming DocuSign checkboxes by the sentence beside them', () => {
  // Laid out as the V2.1 Student/Minor export: the box's top edge, then the
  // sentence's baseline ~14pt lower, starting just right of the printed ☐.
  const page = {
    items: [
      { str: 'and will not hold Stellr liable for any distortion or alteration.', x: 54, y: 451 },
      { str: '☐', x: 54, y: 468 },
      { str: 'I DO NOT consent to photo and media use. (Participation is not affected.)', x: 69, y: 468 },
      { str: '•', x: 67, y: 608 },
      { str: 'Send automated notifications regarding registration status, parental consent forms, and membership', x: 81, y: 608 },
      { str: '☐', x: 54, y: 625 },
      { str: 'I DO NOT consent to direct digital communications with my child. (Note: this may limit participation in online', x: 69, y: 625 },
      { str: 'events and other community activities)', x: 54, y: 636 },
    ],
  }
  const media = { page: 2, x: 50, y: 454, selected: true }
  const comms = { page: 2, x: 47, y: 611, selected: false }

  it('names the media and digital-communications boxes on the V2.1 minor form', () => {
    expect(nameCheckboxes([media, comms], () => page)).toEqual({
      fields: [
        { name: 'MediaOptOut', value: 'true' },
        { name: 'DigitalCommsOptOut', value: 'false' },
      ],
      unnamed: 0,
    })
  })

  it('reads the mentor wording as the media box', () => {
    const mentor = { items: [{ str: '☐ I DO NOT consent to use of my name and image. (Check here to opt out.)', x: 54, y: 133 }] }
    expect(nameCheckboxes([{ page: 4, x: 51, y: 122, selected: false }], () => mentor).fields).toEqual([{ name: 'MediaOptOut', value: 'false' }])
  })

  it('follows a sentence that wraps onto the next line (V2.3 credential box)', () => {
    const v23 = {
      items: [
        { str: 'I DO NOT consent to my child’s name and achievements appearing on a public Stellr', x: 77, y: 147 },
        { str: 'credential page', x: 77, y: 159 },
        { str: 'I DO NOT consent to direct digital communications with my child', x: 77, y: 311 },
      ],
    }
    const out = nameCheckboxes([{ page: 5, x: 62, y: 135, selected: true }, { page: 5, x: 62, y: 299.4, selected: false }], () => v23)
    expect(out.fields).toEqual([
      { name: 'CredentialSharingOptOut', value: 'true' },
      { name: 'DigitalCommsOptOut', value: 'false' },
    ])
  })

  it('leaves a box with no opt-out sentence beside it unnamed, never guessed', () => {
    const out = nameCheckboxes([{ page: 2, x: 50, y: 300, selected: true }], () => page)
    expect(out).toEqual({ fields: [], unnamed: 1 })
    expect(nameCheckboxes([media], () => undefined)).toEqual({ fields: [], unnamed: 1 })
  })

  it('treats a box ticked on either signer’s copy as ticked', () => {
    expect(nameCheckboxes([{ ...media, selected: false }, { ...media, selected: true }], () => page).fields).toEqual([{ name: 'MediaOptOut', value: 'true' }])
  })

  it('does not take the next box’s sentence as a wrapped line', () => {
    const tight = {
      items: [
        { str: 'I DO NOT consent to photo and media use', x: 77, y: 141 },
        { str: 'I DO NOT consent to my child’s survey responses being quoted', x: 77, y: 153 },
      ],
    }
    expect(statementBeside({ page: 1, x: 62, y: 129, selected: false }, tight)).toBe('i do not consent to photo and media use')
  })

  it('identifies each statement, and nothing that is not an opt-out', () => {
    expect(optOutForStatement('i do not consent to my child\'s survey responses being quoted')).toBe('QuoteOptOut')
    expect(optOutForStatement('i agree to the code of conduct')).toBeNull()
  })

  it('reads the boxes off a real PDF through pdf.js', async () => {
    const { PDFDocument, StandardFonts } = await import('pdf-lib')
    const { extractPages } = await import('@/lib/esign/native/pdf-text')
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const p = doc.addPage([612, 792])
    // pdf-lib draws from the bottom; the boxes are given from the top.
    p.drawText('I DO NOT consent to photo and media use. (Check here to opt out.)', { x: 69, y: 792 - 527, size: 10, font })
    const pages = await extractPages(await doc.save())
    expect(nameCheckboxes([{ page: 1, x: 49, y: 515, selected: false }], (b) => pages[b.page - 1]).fields).toEqual([{ name: 'MediaOptOut', value: 'false' }])
  })
})

describe('formOptOuts', () => {
  it('records one key per opt-out box found, and nothing else', () => {
    expect(formOptOuts([
      { name: 'MediaOptOut', value: 'false' },
      { name: 'QuoteOptOut', value: 'true' },
      { name: 'MinorName', value: 'Ada' },
    ])).toEqual({ MediaOptOut: false, QuoteOptOut: true })
    expect(formOptOuts([])).toEqual({})
  })
})
