// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFHexString, PDFName, StandardFonts } from 'pdf-lib'
import { sanitisePdf } from './render'
import { parseFieldMap } from './template'
import { checkClean, checkPlacement, compareCoverage, compareWording } from './template-check'
import { extractPages } from './pdf-text'

async function sourcePdf(clause = 'The participant agrees to follow the event rules.'): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const p1 = doc.addPage([612, 792])
  p1.drawText('Participation Agreement', { x: 54, y: 740, size: 16, font })
  p1.drawText(clause, { x: 54, y: 700, size: 11, font })
  const p2 = doc.addPage([612, 792])
  p2.drawText('Signature: ____________________', { x: 54, y: 500, size: 11, font })
  return doc.save()
}

const map = parseFieldMap({
  roles: [{ role: 'adult', order: 1 }],
  fields: [
    { name: 'adult_full_name', label: 'Full name', role: 'adult', type: 'full_name', source: 'system', page: 2, x: 100, y: 200 },
    { name: 'TeacherPhone', label: 'Phone', role: 'adult', type: 'text', source: 'prefill', prefillKey: 'TeacherPhone', page: 2, x: 100, y: 240 },
    { name: 'MediaOptOut', label: 'Opt out', role: 'adult', type: 'checkbox', source: 'signer', page: 1, x: 50, y: 400 },
    { name: 'adult_signature', label: 'Signature', role: 'adult', type: 'signature', source: 'signer', page: 2, x: 120, y: 280, required: true },
    { name: 'adult_date_signed', label: 'Date signed', role: 'adult', type: 'date_signed', source: 'system', page: 2, x: 380, y: 280 },
  ],
})

describe('extractPages', () => {
  it('reads words with their position from the top of the page', async () => {
    const [page] = await extractPages(await sourcePdf())
    const title = page.items.find((i) => i.str === 'Participation Agreement')!
    expect(title.x).toBeCloseTo(54, 0)
    expect(title.y).toBeCloseTo(792 - 740, 0)
  })
})

describe('compareWording', () => {
  it('passes a clean rebuild of the source', async () => {
    const source = await sourcePdf()
    expect(await compareWording(source, (await sanitisePdf(source)).bytes)).toEqual([])
  })

  it('names the page and the place where a clause changed', async () => {
    const issues = await compareWording(await sourcePdf(), await sourcePdf('The participant agrees to nothing.'))
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toMatch(/^Page 1 differs from the source near: .*agrees to/)
  })
})

describe('compareCoverage', () => {
  it('reports a DocuSign field that is missing, moved, or given to another signer', () => {
    const stored = parseFieldMap({
      roles: [{ role: 'adult', order: 1 }, { role: 'stellr', order: 2 }],
      fields: map.fields
        .filter((f) => f.name !== 'MediaOptOut')
        .map((f) => (f.name === 'TeacherPhone' ? { ...f, y: 260 } : f.name === 'adult_full_name' ? { ...f, role: 'stellr' as const } : f)),
    })
    const messages = compareCoverage(map, stored).map((i) => i.message)
    expect(messages).toEqual([
      expect.stringMatching(/adult_full_name belongs to adult in DocuSign but stellr/),
      expect.stringMatching(/TeacherPhone has moved/),
      expect.stringMatching(/MediaOptOut .* is missing/),
    ])
  })

  it('passes the same map', () => {
    expect(compareCoverage(map, map)).toEqual([])
  })
})

describe('checkClean', () => {
  /** A page carrying a signature field, as a DocuSign export can. */
  async function signedSource(): Promise<Uint8Array> {
    const doc = await PDFDocument.load(await sourcePdf())
    const sig = doc.context.obj({ Type: 'Sig', Filter: 'Adobe.PPKLite', ByteRange: [0, 10, 20, 30], Contents: PDFHexString.of('00') })
    const widget = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', Rect: [0, 0, 0, 0], V: doc.context.register(sig) }))
    doc.getPage(0).node.set(PDFName.of('Annots'), doc.context.obj([widget]))
    return doc.save()
  }

  it('finds a leftover signature, and the clean rebuild removes it', async () => {
    const dirty = await signedSource()
    expect((await checkClean(dirty)).map((i) => i.message)).toEqual([
      expect.stringMatching(/digital signature/),
      expect.stringMatching(/form field/),
    ])
    expect(await checkClean((await sanitisePdf(dirty)).bytes)).toEqual([])
  })
})

describe('checkPlacement', () => {
  it('finds every value printed in its field', async () => {
    const template = (await sanitisePdf(await sourcePdf())).bytes
    expect(await checkPlacement(template, map)).toEqual([])
  })

  it('reports a field whose position is off its page', async () => {
    const template = (await sanitisePdf(await sourcePdf())).bytes
    const offPage = parseFieldMap({
      roles: map.roles,
      fields: map.fields.map((f) => (f.name === 'TeacherPhone' ? { ...f, x: 900 } : f)),
    })
    const issues = await checkPlacement(template, offPage)
    expect(issues.map((i) => i.message)).toEqual([expect.stringMatching(/TeacherPhone .* did not print/)])
  })
})
