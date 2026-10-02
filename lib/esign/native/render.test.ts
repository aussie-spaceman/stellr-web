// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib'
import { renderExecuted, renderPreview, sanitisePdf, sha256Hex } from './render'
import { parseFieldMap } from './template'

async function templatePdf(withJunk = false): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < 2; i++) {
    const page = doc.addPage([612, 792])
    page.drawText(`Agreement page ${i + 1}`, { x: 54, y: 740, size: 12, font })
  }
  if (withJunk) {
    // Document-level JavaScript, which has no place in an agreement.
    doc.catalog.set(PDFName.of('OpenAction'), doc.context.obj({ S: 'JavaScript', JS: 'app.alert(1)' }))
  }
  return doc.save()
}

const map = parseFieldMap({
  roles: [{ role: 'adult', order: 1 }],
  fields: [
    { name: 'adult_full_name', label: 'Full name', role: 'adult', type: 'full_name', source: 'system', page: 2, x: 100, y: 200 },
    { name: 'TeacherPhone', label: 'Phone', role: 'adult', type: 'text', source: 'prefill', prefillKey: 'TeacherPhone', page: 2, x: 100, y: 240 },
    { name: 'MediaOptOut', label: 'Opt out', role: 'adult', type: 'checkbox', source: 'signer', page: 1, x: 50, y: 400 },
    { name: 'adult_signature', label: 'Signature', role: 'adult', type: 'signature', source: 'signer', page: 2, x: 100, y: 300, required: true },
    { name: 'adult_date_signed', label: 'Date signed', role: 'adult', type: 'date_signed', source: 'system', page: 2, x: 380, y: 300 },
  ],
})

describe('sanitisePdf', () => {
  it('rebuilds the template without document-level actions', async () => {
    const { bytes, pageCount } = await sanitisePdf(await templatePdf(true))
    expect(pageCount).toBe(2)
    // updateMetadata: false, or loading would itself rewrite the producer.
    const clean = await PDFDocument.load(bytes, { updateMetadata: false })
    expect(clean.catalog.get(PDFName.of('OpenAction'))).toBeUndefined()
    expect(clean.getProducer()).toBe('Stellr signing')
  })
})

describe('renderPreview', () => {
  it('produces the document with prefill only, and is deterministic for the same input', async () => {
    const template = (await sanitisePdf(await templatePdf())).bytes
    const preview = await renderPreview({ template, map, prefill: { TeacherPhone: '555 0100' }, names: { adult: 'Ada Lovelace' } })
    expect((await PDFDocument.load(preview)).getPageCount()).toBe(2)
  })
})

describe('renderExecuted', () => {
  const certificate = {
    agreementId: 'agr-1', title: 'Participation Agreement', templateKey: 'adult', templateVersion: 1,
    templateSha256: 'abc', disclosureVersion: '2026-10-v1', issuedAt: '2026-10-02T10:00:00Z', completedAt: '2026-10-02T11:00:00Z',
    signers: [{ role: 'Adult', name: 'Zoë Ødegård', email: 'z@example.test', consentedAt: '2026-10-02T10:59:00Z', signedAt: '2026-10-02T11:00:00Z', ip: '203.0.113.1', userAgent: 'UA', method: 'typed name' }],
    auditHead: 'f00d',
  }

  it('appends a certificate page, records hashes and tags the agreement id', async () => {
    const template = (await sanitisePdf(await templatePdf())).bytes
    const result = await renderExecuted(
      {
        template, map, prefill: { TeacherPhone: '555 0100' },
        signers: [{ role: 'adult', name: 'Zoë Ødegård', email: 'z@example.test', signedAt: '2026-10-02T11:00:00Z', values: { TeacherPhone: '555 0100', MediaOptOut: 'true' }, signature: { kind: 'typed', text: 'Zoë Ødegård' } }],
      },
      certificate,
    )
    const doc = await PDFDocument.load(result.bytes)
    expect(doc.getPageCount()).toBe(3)
    expect(doc.getKeywords()).toContain('stellr-agreement:agr-1')
    expect(result.sha256).toBe(sha256Hex(result.bytes))
    expect(result.documentSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(result.substituted).toEqual({})
  })

  it('reports characters the font cannot draw, rather than failing', async () => {
    const template = (await sanitisePdf(await templatePdf())).bytes
    const result = await renderExecuted(
      {
        template, map, prefill: {},
        signers: [{ role: 'adult', name: '王小明', email: 'w@example.test', signedAt: '2026-10-02T11:00:00Z', values: {}, signature: { kind: 'typed', text: '王小明' } }],
      },
      { ...certificate, signers: [{ ...certificate.signers[0], name: '王小明' }] },
    )
    expect(result.substituted.adult_full_name).toBe('王小明')
  })

  it('refuses a field on a page the template does not have', async () => {
    const template = (await sanitisePdf(await templatePdf())).bytes
    const bad = parseFieldMap({
      roles: [{ role: 'adult', order: 1 }],
      fields: [{ name: 'adult_signature', label: 'Signature', role: 'adult', type: 'signature', source: 'signer', page: 9, x: 0, y: 0 }],
    })
    await expect(renderPreview({ template, map: bad, prefill: {} })).rejects.toThrow(/page 9/)
  })
})
