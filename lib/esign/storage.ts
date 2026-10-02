import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

// Where signed records are kept, and how they are written. Dependency-free on
// purpose: both engines and the archive job use it, and it must not pull the
// engines in after it.
//
// Layout of the private bucket:
//   {provider}/{yyyy}/{envelope row id}/signed.pdf
//   {provider}/{yyyy}/{envelope row id}/certificate.pdf   (DocuSign)
//   {provider}/{yyyy}/{envelope row id}/audit.json        (Stellr signing)
// No names in paths: an object listing reveals nothing about who signed.

export const SIGNED_BUCKET = 'signed-agreements'

/** Signed agreements are kept this long after signing (Privacy Policy §10). */
export const RETENTION_YEARS = 7

export function sha256Hex(bytes: ArrayBuffer | Uint8Array): string {
  return createHash('sha256').update(new Uint8Array(bytes as ArrayBuffer)).digest('hex')
}

export function retainUntil(completedAt: string): string {
  const d = new Date(completedAt)
  d.setUTCFullYear(d.getUTCFullYear() + RETENTION_YEARS)
  return d.toISOString()
}

export function archivePaths(row: { id: string; provider?: string | null; completed_at?: string | null }) {
  const provider = row.provider ?? 'docusign'
  const year = new Date(row.completed_at ?? Date.now()).getUTCFullYear()
  const dir = `${provider}/${year}/${row.id}`
  return {
    pdf: `${dir}/signed.pdf`,
    certificate: provider === 'docusign' ? `${dir}/certificate.pdf` : `${dir}/audit.json`,
  }
}

/**
 * Writes an object that must never be overwritten. If an earlier attempt
 * already stored it, the stored bytes win and their hash is returned: a second
 * fetch from the engine may not be byte-identical, and the record is the first
 * copy we kept.
 */
export async function putImmutable(
  db: SupabaseClient,
  path: string,
  bytes: ArrayBuffer | Uint8Array,
  contentType: string,
): Promise<string> {
  const body = new Uint8Array(bytes as ArrayBuffer)
  const { error } = await db.storage.from(SIGNED_BUCKET).upload(path, body, { contentType, upsert: false })
  if (!error) return sha256Hex(body)

  const exists = /exists|duplicate/i.test(error.message)
  if (!exists) throw new Error(`Storage upload failed for ${path}: ${error.message}`)
  const { data, error: readError } = await db.storage.from(SIGNED_BUCKET).download(path)
  if (readError || !data) throw new Error(`Stored copy of ${path} exists but could not be read`)
  return sha256Hex(await data.arrayBuffer())
}
