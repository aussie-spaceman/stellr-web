// node: specifiers, not bare names: under Vitest's jsdom environment a bare
// 'path' resolves to the browser shim in node_modules, which cannot join paths.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { PDFDocument, PDFName, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import type { FieldMap, Role, TemplateField } from '@/lib/esign/native/template'

// Turns a template PDF and the values for its fields into the document a signer
// sees (preview) and, once everyone has signed, the executed agreement with a
// certificate-of-completion page appended.
//
// Names print exactly as typed for Latin, Latin Extended, Greek, Cyrillic and
// Vietnamese scripts (Open Sans, embedded and subset). A character the font
// cannot draw prints as "?" on the page and is reported back, so the caller
// can record that the exact value lives in the audit record.

const INK = rgb(0.055, 0.075, 0.188)
const MUTED = rgb(0.35, 0.38, 0.47)
const FONT_PATH = join(process.cwd(), 'public/fonts/esign/OpenSans-Regular.ttf')

let fontBytes: Promise<Buffer> | null = null
function loadFontBytes(): Promise<Buffer> {
  fontBytes ??= readFile(FONT_PATH)
  return fontBytes
}

export function sha256Hex(bytes: Uint8Array | ArrayBuffer): string {
  return createHash('sha256').update(new Uint8Array(bytes as ArrayBuffer)).digest('hex')
}

/**
 * A template PDF re-built page by page into a fresh document. Copying pages
 * leaves behind document-level JavaScript, open actions, attachments, forms and
 * metadata, none of which belong in an agreement a family is asked to sign.
 */
export async function sanitisePdf(input: Uint8Array | ArrayBuffer): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const source = await PDFDocument.load(input, { updateMetadata: false })
  if (source.isEncrypted) throw new Error('Encrypted PDFs cannot be used as agreement templates')
  const clean = await PDFDocument.create({ updateMetadata: false })
  const pages = await clean.copyPages(source, source.getPageIndices())
  for (const page of pages) {
    // Annotations (links, form widgets, embedded actions) and page-level
    // actions are dropped: the engine draws every field itself.
    page.node.delete(PDFName.of('Annots'))
    page.node.delete(PDFName.of('AA'))
    clean.addPage(page)
  }
  clean.setProducer('Stellr signing')
  clean.setCreator('Stellr signing')
  return { bytes: await clean.save({ useObjectStreams: true }), pageCount: pages.length }
}

export interface SignerRender {
  role: Role
  name: string
  email: string
  values: Record<string, string>
  signature?: { kind: 'typed'; text: string } | { kind: 'drawn'; png: Uint8Array; text: string }
  signedAt?: string
  title?: string
}

export interface RenderInput {
  template: Uint8Array | ArrayBuffer
  map: FieldMap
  prefill: Record<string, string>
  signers: SignerRender[]
  /**
   * Who each role is, for the printed-name fields: shown before they sign, so
   * the student's name appears on the form even when the student is not a
   * signer.
   */
  names?: Partial<Record<Role, string>>
  /** Time zone dates are printed in. Defaults to Mountain, Stellr's home. */
  timeZone?: string
}

export interface RenderResult {
  pdf: PDFDocument
  /** Characters the font could not draw, by field. */
  substituted: Record<string, string>
}

function formatDate(iso: string, timeZone = 'America/Denver'): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'short', day: '2-digit' }).format(new Date(iso))
}

/** Replaces characters the font has no glyph for. */
function drawable(font: PDFFont, text: string): { text: string; lost: string } {
  let out = ''
  let lost = ''
  const glyphs = (font as unknown as { embedder: { font: { hasGlyphForCodePoint(c: number): boolean } } }).embedder.font
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number
    if (cp === 32 || glyphs.hasGlyphForCodePoint(cp)) out += ch
    else { out += '?'; lost += ch }
  }
  return { text: out, lost }
}

function fitSize(font: PDFFont, text: string, size: number, width: number): number {
  if (!width) return size
  let s = size
  while (s > 5 && font.widthOfTextAtSize(text, s) > width) s -= 0.5
  return s
}

function drawFieldText(page: PDFPage, font: PDFFont, field: TemplateField, text: string): void {
  const { height } = page.getSize()
  const size = fitSize(font, text, field.fontSize, field.w > 0 ? field.w + 40 : 0)
  page.drawText(text, { x: field.x + 2, y: height - field.y - size - 2, size, font, color: INK })
}

/** Stamps prefill and signer values onto a copy of the template. */
export async function renderDocument(input: RenderInput): Promise<RenderResult> {
  const pdf = await PDFDocument.load(input.template)
  pdf.registerFontkit(fontkit)
  const font = await pdf.embedFont(await loadFontBytes(), { subset: true })
  const pages = pdf.getPages()
  const substituted: Record<string, string> = {}
  const byRole = new Map(input.signers.map((s) => [s.role, s]))

  for (const field of input.map.fields) {
    const page = pages[field.page - 1]
    if (!page) throw new Error(`Field ${field.name} is on page ${field.page}, but the template has ${pages.length}`)
    const signer = byRole.get(field.role)

    let value = ''
    switch (field.type) {
      case 'signature':
        if (signer?.signature) {
          drawSignature(page, font, field, signer.signature)
          continue
        }
        break
      case 'date_signed':
        value = signer?.signedAt ? formatDate(signer.signedAt, input.timeZone) : ''
        break
      case 'full_name':
        value = signer?.signedAt ? signer.name : input.names?.[field.role] ?? ''
        break
      case 'email':
        value = signer?.values[field.name] ?? (field.source === 'prefill' ? input.prefill[field.prefillKey as string] ?? '' : signer?.email ?? '')
        break
      case 'title':
        value = signer?.title ?? signer?.values[field.name] ?? ''
        break
      case 'checkbox':
        if ((signer?.values[field.name] ?? 'false') === 'true') {
          const { height } = page.getSize()
          page.drawText('X', { x: field.x + 2, y: height - field.y - 10, size: 10, font, color: INK })
        }
        continue
      default:
        value = signer?.values[field.name]
          ?? (field.source === 'prefill' ? input.prefill[field.prefillKey as string] ?? '' : '')
    }

    if (!value) continue
    const { text, lost } = drawable(font, value)
    if (lost) substituted[field.name] = lost
    drawFieldText(page, font, field, text)
  }

  return { pdf, substituted }
}

function drawSignature(
  page: PDFPage,
  font: PDFFont,
  field: TemplateField,
  signature: NonNullable<SignerRender['signature']>,
): void {
  const { height } = page.getSize()
  const top = height - field.y
  // A drawn signature is an image, embedded by drawDrawnSignatures once the
  // whole document is available.
  if (signature.kind === 'drawn') return
  const { text } = drawable(font, signature.text)
  const size = fitSize(font, text, 14, 180)
  page.drawText(text, { x: field.x + 2, y: top - size - 2, size, font, color: INK })
  page.drawText('Signed electronically', { x: field.x + 2, y: top - size - 12, size: 6, font, color: MUTED })
}

async function drawDrawnSignatures(pdf: PDFDocument, map: FieldMap, signers: SignerRender[]): Promise<void> {
  const pages = pdf.getPages()
  for (const signer of signers) {
    if (signer.signature?.kind !== 'drawn') continue
    const image = await pdf.embedPng(signer.signature.png)
    for (const field of map.fields) {
      if (field.role !== signer.role || field.type !== 'signature') continue
      const page = pages[field.page - 1]
      const { height } = page.getSize()
      const w = Math.min(180, image.width)
      const h = (image.height / image.width) * w
      const fittedH = Math.min(h, 40)
      const fittedW = (fittedH / h) * w
      page.drawImage(image, { x: field.x + 2, y: height - field.y - fittedH, width: fittedW, height: fittedH })
    }
  }
}

// ── Certificate of completion ────────────────────────────────────────────────

export interface CertificateSigner {
  role: string
  name: string
  email: string
  consentedAt: string | null
  signedAt: string
  ip: string | null
  userAgent: string | null
  method: string
}

export interface CertificateInput {
  agreementId: string
  title: string
  templateKey: string
  templateVersion: number
  templateSha256: string
  disclosureVersion: string
  issuedAt: string
  completedAt: string
  /** SHA-256 of the executed pages, before this certificate page was added. */
  documentSha256: string
  signers: CertificateSigner[]
  countersignature?: { name: string; title: string; authority: string; at: string } | null
  auditHead: string | null
}

function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const lines: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(next, size) > width && line) { lines.push(line); line = word }
      else line = next
    }
    lines.push(line)
  }
  return lines
}

/** Appends the certificate-of-completion page(s). */
export async function appendCertificate(pdf: PDFDocument, input: CertificateInput): Promise<void> {
  pdf.registerFontkit(fontkit)
  const font = await pdf.embedFont(await loadFontBytes(), { subset: true })
  const W = 612, H = 792, M = 54, width = W - 2 * M
  let page = pdf.addPage([W, H])
  let y = H - M

  const line = (text: string, size = 9, color = INK, gap = 4) => {
    for (const l of wrap(font, drawable(font, text).text, size, width)) {
      if (y < M + size) { page = pdf.addPage([W, H]); y = H - M }
      page.drawText(l, { x: M, y: y - size, size, font, color })
      y -= size + gap
    }
  }
  const space = (n = 8) => { y -= n }

  line('Certificate of completion', 18)
  line('Stellr Education — Stellr signing', 9, MUTED)
  space(10)
  line(input.title, 12)
  line(`Agreement ID: ${input.agreementId}`)
  line(`Document: ${input.templateKey}, version ${input.templateVersion}`)
  line(`Template SHA-256: ${input.templateSha256}`, 8, MUTED)
  line(`Signed pages SHA-256: ${input.documentSha256}`, 8, MUTED)
  line(`Electronic records disclosure: version ${input.disclosureVersion}`)
  line(`Issued: ${input.issuedAt}    Completed: ${input.completedAt}`)
  space(10)

  for (const s of input.signers) {
    line(`${s.role}: ${s.name} <${s.email}>`, 10)
    line(`Agreed to sign electronically: ${s.consentedAt ?? 'not recorded'}`)
    line(`Signed: ${s.signedAt} by ${s.method}`)
    line(`IP address: ${s.ip ?? 'not recorded'}`)
    line(`Browser: ${s.userAgent ?? 'not recorded'}`, 8, MUTED)
    space(6)
  }

  if (input.countersignature) {
    const c = input.countersignature
    line(`Stellr Education counter-signature: ${c.name}, ${c.title}`, 10)
    line(`Applied ${c.at} under: ${c.authority}`)
    space(6)
  }

  space(6)
  line('How to check this record', 10)
  line(
    'Each signing step above is also recorded in Stellr\'s audit trail, where every entry carries a hash of the one before it. ' +
    `The most recent entry's hash was ${input.auditHead ?? 'not available'}. ` +
    'Stellr keeps the SHA-256 of this complete file; a copy whose hash differs has been altered. ' +
    'To verify a copy, or to ask for a paper copy, email privacy@stellreducation.org.',
    8, MUTED,
  )
}

// ── Whole-document rendering ─────────────────────────────────────────────────

/** The document a signer reviews: template plus prefill, nothing signed. */
export async function renderPreview(input: Omit<RenderInput, 'signers'> & { signers?: SignerRender[] }): Promise<Uint8Array> {
  const { pdf } = await renderDocument({ ...input, signers: input.signers ?? [] })
  return pdf.save({ useObjectStreams: true })
}

export interface ExecutedDocument {
  bytes: Uint8Array
  sha256: string
  documentSha256: string
  substituted: Record<string, string>
}

/** The executed agreement: every signer's values and signature, then the certificate. */
export async function renderExecuted(
  input: RenderInput,
  certificate: Omit<CertificateInput, 'documentSha256'>,
): Promise<ExecutedDocument> {
  const { pdf, substituted } = await renderDocument(input)
  await drawDrawnSignatures(pdf, input.map, input.signers)
  const signedPages = await pdf.save({ useObjectStreams: true })
  const documentSha256 = sha256Hex(signedPages)

  const finalDoc = await PDFDocument.load(signedPages, { updateMetadata: false })
  finalDoc.setTitle(certificate.title)
  finalDoc.setProducer('Stellr signing')
  finalDoc.setCreator('Stellr signing')
  finalDoc.setKeywords([`stellr-agreement:${certificate.agreementId}`])
  await appendCertificate(finalDoc, { ...certificate, documentSha256 })
  const bytes = await finalDoc.save({ useObjectStreams: true })
  return { bytes, sha256: sha256Hex(bytes), documentSha256, substituted }
}
