// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument, PDFHexString, PDFName, StandardFonts } from 'pdf-lib'
import { DEV_PLACEHOLDER_TITLE } from './dev-placeholder'
import { fakeSupabase } from '@/test/fake-supabase'
import { acceptUpload, approveVersion, createVersion, TemplateAdminError } from './template-admin'

async function agreement(withSignature = false): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([612, 792])
  page.drawText('Participation Agreement', { x: 54, y: 740, size: 16, font })
  if (withSignature) {
    const sig = doc.context.register(doc.context.obj({ Type: 'Sig', ByteRange: [0, 1, 2, 3], Contents: PDFHexString.of('00') }))
    const widget = doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', Rect: [0, 0, 0, 0], V: sig }))
    page.node.set(PDFName.of('Annots'), doc.context.obj([widget]))
  }
  return doc.save()
}

const fieldMap = {
  roles: [{ role: 'adult', order: 1 }],
  fields: [
    { name: 'adult_full_name', label: 'Full name', role: 'adult', type: 'full_name', source: 'system', page: 1, x: 100, y: 200 },
    { name: 'adult_signature', label: 'Signature', role: 'adult', type: 'signature', source: 'signer', page: 1, x: 100, y: 260, required: true },
  ],
}

const error = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as TemplateAdminError)

describe('acceptUpload', () => {
  it('cleans a PDF (an old signature goes) and keeps it as a draft by its hash', async () => {
    const db = fakeSupabase()
    const out = await acceptUpload(db.client, await agreement(true))
    expect(out.pdfPath).toMatch(/^drafts\/[0-9a-f]{64}\.pdf$/)
    expect(out.pageCount).toBe(1)
    const stored = Buffer.from(db.objects.get(`agreement-templates/${out.pdfPath}`)!).toString('latin1')
    expect(stored).not.toContain('/ByteRange')
  })

  it('refuses what is not a PDF by its bytes, or is too large', async () => {
    const db = fakeSupabase()
    expect((await error(acceptUpload(db.client, new TextEncoder().encode('<html>not a pdf</html>'))))?.message).toMatch(/not a PDF/)
    expect((await error(acceptUpload(db.client, new Uint8Array(11 * 1024 * 1024))))?.message).toMatch(/10 MB/)
  })
})

describe('createVersion and approveVersion', () => {
  async function withDraft() {
    const db = fakeSupabase({ esign_templates: [{ id: 'old', key: 'adult', version: 2, active: true, approved_at: '2026-10-01T00:00:00Z' }] })
    const { pdfPath } = await acceptUpload(db.client, await agreement())
    return { db, pdfPath }
  }

  it('saves the next, unapproved version after its checks pass', async () => {
    const { db, pdfPath } = await withDraft()
    const out = await createVersion(db.client, { key: 'adult', title: 'Participation Agreement', pdfPath, fieldMap, createdBy: 'Admin A' })
    expect(out.version).toBe(3)
    const row = db.table('esign_templates').find((r) => r.id === out.id)!
    expect(row).toMatchObject({ key: 'adult', version: 3, source: 'editor', created_by: 'Admin A' })
    expect(row.approved_at).toBeUndefined()
    expect(row.pdf_path).toMatch(/^adult\/v3-[0-9a-f]{12}\.pdf$/)
    expect(db.objects.has(`agreement-templates/${row.pdf_path}`)).toBe(true)
  })

  it('refuses fields that do not validate or are placed off the page', async () => {
    const { db, pdfPath } = await withDraft()
    const bad = { ...fieldMap, fields: [{ ...fieldMap.fields[1], source: 'system' }] }
    expect((await error(createVersion(db.client, { key: 'adult', title: 'Participation Agreement', pdfPath, fieldMap: bad, createdBy: 'A' })))?.issues.join(' ')).toMatch(/signer's own act/)
    const offPage = { ...fieldMap, fields: [{ ...fieldMap.fields[0], page: 3 }, fieldMap.fields[1]] }
    expect((await error(createVersion(db.client, { key: 'adult', title: 'Participation Agreement', pdfPath, fieldMap: offPage, createdBy: 'A' })))?.issues.join(' ')).toMatch(/page 3/)
    expect((await error(createVersion(db.client, { key: 'nope', title: 'Participation Agreement', pdfPath, fieldMap, createdBy: 'A' })))?.message).toMatch(/Unknown document/)
    expect((await error(createVersion(db.client, { key: 'adult', title: 'X', pdfPath: '../../etc/passwd', fieldMap, createdBy: 'A' })))).toBeInstanceOf(TemplateAdminError)
  })

  it('approves only with the version typed out, records who, and puts it in use instead of the old one', async () => {
    const { db, pdfPath } = await withDraft()
    const { id } = await createVersion(db.client, { key: 'adult', title: 'Participation Agreement', pdfPath, fieldMap, createdBy: 'A' })
    expect((await error(approveVersion(db.client, id, { by: 'Admin B', confirm: 'adult v2' })))?.message).toMatch(/Type "adult v3"/)

    expect(await approveVersion(db.client, id, { by: 'Admin B', confirm: 'adult v3' })).toEqual({ key: 'adult', version: 3 })
    const rows = Object.fromEntries(db.table('esign_templates').map((r) => [r.id, r]))
    expect(rows[id]).toMatchObject({ active: true, approved_by: 'Admin B' })
    expect(rows.old.active).toBe(false)
  })

  it('will not approve a version whose stored file has changed', async () => {
    const { db, pdfPath } = await withDraft()
    const { id } = await createVersion(db.client, { key: 'adult', title: 'Participation Agreement', pdfPath, fieldMap, createdBy: 'A' })
    const row = db.table('esign_templates').find((r) => r.id === id)!
    db.objects.set(`agreement-templates/${row.pdf_path}`, await agreement(true))
    expect((await error(approveVersion(db.client, id, { by: 'B', confirm: 'adult v3' })))?.message).toMatch(/does not match/)
  })
})

// S5 wave 7, K5: the dev placeholder for the guardian-consent document goes only
// to dev, through this editor as through scripts/esign-template.ts.
describe('the dev placeholder, through Admin → Agreement documents', () => {
  const DEV_URL = 'https://xvxlhbxtiwxpopoqjygm.supabase.co'
  const PROD_URL = 'https://hwtzpfrnksksxlwwabqz.supabase.co'
  afterEach(() => { vi.unstubAllEnvs() })

  function realProduction() {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'prod')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', PROD_URL)
  }
  function devDeployment() {
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'dev')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', DEV_URL)
  }

  const consentMap = {
    roles: [{ role: 'guardian', order: 1 }],
    fields: [{ name: 'guardian_signature', label: 'Signature', role: 'guardian', type: 'signature', source: 'signer', page: 1, x: 100, y: 300, required: true }],
  }

  async function pdfWith(pages: string[]): Promise<Uint8Array> {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    for (const text of pages) doc.addPage([612, 792]).drawText(text, { x: 54, y: 740, size: 14, font })
    return doc.save()
  }

  async function draft(pages: string[]) {
    const db = fakeSupabase({ esign_templates: [] })
    const { pdfPath } = await acceptUpload(db.client, await pdfWith(pages))
    return { db, pdfPath }
  }

  const create = (db: ReturnType<typeof fakeSupabase>, pdfPath: string, title: string) =>
    createVersion(db.client, { key: 'tenant_guardian_consent', title, pdfPath, fieldMap: consentMap, createdBy: 'Admin A' })

  it('refuses the placeholder title on the production app', async () => {
    realProduction()
    const { db, pdfPath } = await draft(['Parent or Guardian Consent'])
    expect((await error(create(db, pdfPath, DEV_PLACEHOLDER_TITLE)))?.message).toMatch(/only on dev/)
    expect(db.table('esign_templates')).toHaveLength(0)
  })

  it('refuses the placeholder file under a real title on the production app, even when only one page is marked', async () => {
    realProduction()
    const { db, pdfPath } = await draft(['Parent or Guardian Consent', `${DEV_PLACEHOLDER_TITLE} (page 2 of 2)`])
    const refused = await error(create(db, pdfPath, 'Parent or Guardian Consent'))
    expect(refused?.message).toMatch(/Page\(s\) 2 say "DEV PLACEHOLDER"/)
    expect(refused?.issues).toEqual(['This is the production app.'])
    const { pdfPath: dashed } = await acceptUpload(db.client, await pdfWith(['Dev-Placeholder: not a consent form']))
    expect((await error(create(db, dashed, 'Parent or Guardian Consent')))?.message).toMatch(/only on dev/)
  })

  it('refuses it outside production too, when the database is not dev or a local stack', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', 'dev')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', PROD_URL)
    const { db, pdfPath } = await draft(['Parent or Guardian Consent'])
    expect((await error(create(db, pdfPath, DEV_PLACEHOLDER_TITLE)))?.issues.join(' ')).toMatch(/only to the dev project/)
  })

  it('will not approve a placeholder on the production app, by its title or by its file', async () => {
    devDeployment()
    const { db, pdfPath } = await draft([`${DEV_PLACEHOLDER_TITLE} (page 1 of 1)`])
    const { id } = await create(db, pdfPath, DEV_PLACEHOLDER_TITLE)
    const row = db.table('esign_templates').find((r) => r.id === id)!
    realProduction()
    expect((await error(approveVersion(db.client, id, { by: 'Admin B', confirm: 'tenant_guardian_consent v1' })))?.message).toMatch(/only on dev/)
    row.title = 'Parent or Guardian Consent'
    expect((await error(approveVersion(db.client, id, { by: 'Admin B', confirm: 'tenant_guardian_consent v1' })))?.message).toMatch(/Page\(s\) 1 say/)
    expect(row.active).toBeUndefined()
    expect(row.approved_at).toBeUndefined()
  })

  it('saves and approves it on dev, and a real document on production as before', async () => {
    devDeployment()
    const dev = await draft([`${DEV_PLACEHOLDER_TITLE} (page 1 of 1)`])
    const { id } = await create(dev.db, dev.pdfPath, DEV_PLACEHOLDER_TITLE)
    expect(await approveVersion(dev.db.client, id, { by: 'Admin B', confirm: 'tenant_guardian_consent v1' })).toEqual({ key: 'tenant_guardian_consent', version: 1 })

    realProduction()
    const prod = await draft(['Parent or Guardian Consent'])
    const real = await create(prod.db, prod.pdfPath, 'Parent or Guardian Consent')
    expect(await approveVersion(prod.db.client, real.id, { by: 'Admin B', confirm: 'tenant_guardian_consent v1' })).toEqual({ key: 'tenant_guardian_consent', version: 1 })
  })
})
