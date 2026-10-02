import type { SupabaseClient } from '@supabase/supabase-js'
import { sanitisePdf, sha256Hex } from '@/lib/esign/native/render'
import { parseFieldMap, type FieldMap } from '@/lib/esign/native/template'
import { TEMPLATE_BUCKET } from '@/lib/esign/native/templates-store'
import { DISCLOSURE_VERSION } from '@/lib/esign/disclosure'
import type { TemplateKey } from '@/lib/esign/native/plan'

// The field editor's server side (Admin → Consent forms → Agreement documents):
// accept an uploaded PDF, save an edited field map as a new version, approve a
// version. Every route that calls these checks the caller is an admin first.
//
// Versions are immutable once approved (a database trigger enforces it), so an
// edit is always a new, unapproved version; only an approval puts it in use.

export const TEMPLATE_KEYS: TemplateKey[] = ['minor', 'adult', 'mentor', 'membership_adult', 'membership_minor']
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const MAX_PAGES = 30
const DRAFT_PATH = /^drafts\/[0-9a-f]{64}\.pdf$/

export class TemplateAdminError extends Error {
  constructor(message: string, readonly issues: string[] = []) { super(message) }
}

/**
 * An uploaded agreement PDF, made safe to use: it must be a PDF by its first
 * bytes (not just its name or declared type), not encrypted, not oversized,
 * and it is rebuilt page by page so no script, form, attachment or old
 * signature comes along. The cleaned file is kept under drafts/ by its hash.
 */
export async function acceptUpload(db: SupabaseClient, bytes: Uint8Array): Promise<{ pdfPath: string; sha256: string; pageCount: number }> {
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new TemplateAdminError('The file is larger than 10 MB.')
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new TemplateAdminError('That file is not a PDF.')
  let clean: { bytes: Uint8Array; pageCount: number }
  try {
    clean = await sanitisePdf(bytes)
  } catch (err) {
    throw new TemplateAdminError(err instanceof Error && /Encrypted/.test(err.message) ? 'Encrypted PDFs cannot be used. Save an unprotected copy and upload that.' : 'The PDF could not be read.')
  }
  if (clean.pageCount > MAX_PAGES) throw new TemplateAdminError(`An agreement can have at most ${MAX_PAGES} pages.`)
  const { checkClean } = await import('@/lib/esign/native/template-check')
  const left = await checkClean(clean.bytes)
  if (left.length) throw new TemplateAdminError('The PDF could not be cleaned.', left.map((i) => i.message))

  const sha = sha256Hex(clean.bytes)
  const pdfPath = `drafts/${sha}.pdf`
  const { error } = await db.storage.from(TEMPLATE_BUCKET).upload(pdfPath, clean.bytes, { contentType: 'application/pdf', upsert: false })
  if (error && !/exists|duplicate/i.test(error.message)) throw new Error(`Saving the upload failed: ${error.message}`)
  return { pdfPath, sha256: sha, pageCount: clean.pageCount }
}

/** A draft upload or a published version's file, by its storage path. Paths are checked, never trusted. */
export async function loadTemplateFile(db: SupabaseClient, pdfPath: string): Promise<Uint8Array> {
  const published = /^(minor|adult|mentor|membership_adult|membership_minor)\/v\d+-[0-9a-f]{12}\.pdf$/
  if (!DRAFT_PATH.test(pdfPath) && !published.test(pdfPath)) throw new TemplateAdminError('Unknown document file.')
  const { data, error } = await db.storage.from(TEMPLATE_BUCKET).download(pdfPath)
  if (error || !data) throw new TemplateAdminError('The document file could not be read.')
  return new Uint8Array(await data.arrayBuffer())
}

/** Runs every check a version must pass. Returns the problems, if any. */
export async function checkVersion(pdf: Uint8Array, map: FieldMap): Promise<string[]> {
  const { checkClean, checkPlacement } = await import('@/lib/esign/native/template-check')
  const pages = (await (await import('pdf-lib')).PDFDocument.load(pdf)).getPageCount()
  const offPage = map.fields.filter((f) => f.page > pages).map((f) => `Field ${f.name} is on page ${f.page}; the document has ${pages}.`)
  if (offPage.length) return offPage
  const issues = await checkClean(pdf)
  try {
    issues.push(...await checkPlacement(pdf, map))
  } catch (err) {
    issues.push({ check: 'placement', message: `The fields could not be printed on the document: ${err instanceof Error ? err.message : String(err)}` })
  }
  return issues.map((i) => i.message)
}

export interface NewVersionInput {
  key: string
  title: string
  pdfPath: string
  fieldMap: unknown
  textHtml?: string | null
  createdBy: string
}

/** Saves an edited document as the next, unapproved version of its key. */
export async function createVersion(db: SupabaseClient, input: NewVersionInput): Promise<{ id: string; version: number }> {
  if (!TEMPLATE_KEYS.includes(input.key as TemplateKey)) throw new TemplateAdminError('Unknown document type.')
  const title = input.title.trim()
  if (title.length < 3 || title.length > 120) throw new TemplateAdminError('Give the document a title signers will recognise (3 to 120 characters).')
  let map: FieldMap
  try {
    map = parseFieldMap(input.fieldMap)
  } catch (err) {
    const issues = (err as { issues?: { path: (string | number)[]; message: string }[] }).issues?.map((i) => `${i.path.join('.')}: ${i.message}`)
    throw new TemplateAdminError('The fields are not valid.', issues ?? [String(err)])
  }
  const pdf = await loadTemplateFile(db, input.pdfPath)
  const issues = await checkVersion(pdf, map)
  if (issues.length) throw new TemplateAdminError('The document did not pass its checks.', issues)

  const sha = sha256Hex(pdf)
  const { data: latest } = await db.from('esign_templates').select('version').eq('key', input.key).order('version', { ascending: false }).limit(1).maybeSingle()
  const version = ((latest?.version as number | undefined) ?? 0) + 1
  const pdfPath = `${input.key}/v${version}-${sha.slice(0, 12)}.pdf`
  if (pdfPath !== input.pdfPath) {
    const { error } = await db.storage.from(TEMPLATE_BUCKET).upload(pdfPath, pdf, { contentType: 'application/pdf', upsert: false })
    if (error && !/exists|duplicate/i.test(error.message)) throw new Error(`Saving the version's file failed: ${error.message}`)
  }
  const { data, error } = await db.from('esign_templates').insert({
    key: input.key,
    version,
    title,
    pdf_path: pdfPath,
    pdf_sha256: sha,
    page_count: (await (await import('pdf-lib')).PDFDocument.load(pdf)).getPageCount(),
    field_map: map,
    text_html: input.textHtml ?? null,
    disclosure_version: DISCLOSURE_VERSION,
    source: 'editor',
    created_by: input.createdBy,
  }).select('id').single()
  if (error) throw new Error(`Recording the version failed: ${error.message}`)
  return { id: data.id as string, version }
}

/**
 * Approves a version and puts it in use. The approver retypes "<key> v<n>"
 * so a version cannot be approved by a stray click, and the checks run again:
 * nothing unchecked reaches a family.
 */
export async function approveVersion(db: SupabaseClient, id: string, opts: { by: string; confirm: string }): Promise<{ key: string; version: number }> {
  const { data: row } = await db.from('esign_templates').select('id, key, version, pdf_path, pdf_sha256, field_map, approved_at').eq('id', id).maybeSingle()
  if (!row) throw new TemplateAdminError('That version does not exist.')
  const expected = `${row.key} v${row.version}`
  if (opts.confirm.trim() !== expected) throw new TemplateAdminError(`Type "${expected}" to confirm.`)
  const pdf = await loadTemplateFile(db, row.pdf_path as string)
  if (sha256Hex(pdf) !== row.pdf_sha256) throw new TemplateAdminError('The stored file does not match this version. It cannot be approved.')
  const issues = await checkVersion(pdf, parseFieldMap(row.field_map))
  if (issues.length) throw new TemplateAdminError('The document did not pass its checks.', issues)

  if (!row.approved_at) {
    const { error } = await db.from('esign_templates').update({ approved_by: opts.by, approved_at: new Date().toISOString() }).eq('id', id)
    if (error) throw new Error(`Recording the approval failed: ${error.message}`)
  }
  await db.from('esign_templates').update({ active: false }).eq('key', row.key).eq('active', true)
  const { error } = await db.from('esign_templates').update({ active: true }).eq('id', id)
  if (error) throw new Error(`Putting the version in use failed: ${error.message}`)
  return { key: row.key as string, version: row.version as number }
}
