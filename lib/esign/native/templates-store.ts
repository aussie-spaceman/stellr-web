import type { SupabaseClient } from '@supabase/supabase-js'
import { parseFieldMap, type FieldMap } from '@/lib/esign/native/template'
import { sha256Hex } from '@/lib/esign/native/render'
import { isRealProductionApp } from '@/lib/env-guards'

// Loads the published versions of agreement documents. A version's PDF is
// identified by its hash and never changes, so it is cached per instance by
// hash and checked against it on first load.

export const TEMPLATE_BUCKET = 'agreement-templates'

export interface TemplateVersion {
  id: string
  key: string
  version: number
  title: string
  pdfPath: string
  pdfSha256: string
  map: FieldMap
  textHtml: string | null
  disclosureVersion: string
  approvedAt: string | null
}

const COLUMNS = 'id, key, version, title, pdf_path, pdf_sha256, field_map, text_html, disclosure_version, approved_at, active'

function fromRow(row: Record<string, unknown>): TemplateVersion {
  return {
    id: row.id as string,
    key: row.key as string,
    version: row.version as number,
    title: row.title as string,
    pdfPath: row.pdf_path as string,
    pdfSha256: row.pdf_sha256 as string,
    map: parseFieldMap(row.field_map),
    textHtml: (row.text_html as string | null) ?? null,
    disclosureVersion: row.disclosure_version as string,
    approvedAt: (row.approved_at as string | null) ?? null,
  }
}

export class TemplateUnavailableError extends Error {}

/**
 * The version new agreements of this kind use. In production only an approved
 * version may be used: an unchecked document must never reach a family.
 */
export async function loadActiveTemplate(db: SupabaseClient, key: string): Promise<TemplateVersion> {
  const { data, error } = await db.from('esign_templates').select(COLUMNS).eq('key', key).eq('active', true).maybeSingle()
  if (error) throw new Error(`Template lookup failed: ${error.message}`)
  if (!data) throw new TemplateUnavailableError(`No active "${key}" document is published for Stellr signing`)
  const t = fromRow(data as Record<string, unknown>)
  if (!t.approvedAt && isRealProductionApp()) {
    throw new TemplateUnavailableError(`The active "${key}" document has not been approved`)
  }
  return t
}

export async function loadTemplateById(db: SupabaseClient, id: string): Promise<TemplateVersion> {
  const { data, error } = await db.from('esign_templates').select(COLUMNS).eq('id', id).maybeSingle()
  if (error || !data) throw new TemplateUnavailableError(`Template ${id} not found`)
  return fromRow(data as Record<string, unknown>)
}

const pdfCache = new Map<string, Uint8Array>()

export async function loadTemplatePdf(db: SupabaseClient, t: TemplateVersion): Promise<Uint8Array> {
  const cached = pdfCache.get(t.pdfSha256)
  if (cached) return cached
  const { data, error } = await db.storage.from(TEMPLATE_BUCKET).download(t.pdfPath)
  if (error || !data) throw new TemplateUnavailableError(`Template PDF for ${t.key} v${t.version} could not be read`)
  const bytes = new Uint8Array(await data.arrayBuffer())
  if (sha256Hex(bytes) !== t.pdfSha256) {
    throw new TemplateUnavailableError(`Template PDF for ${t.key} v${t.version} does not match its recorded hash`)
  }
  pdfCache.set(t.pdfSha256, bytes)
  return bytes
}
