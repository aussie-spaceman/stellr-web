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

/**
 * Signed agreements are kept for the life of the membership and this long
 * after it ends (Participation Agreements V2.3; Privacy Policy §10).
 */
export const RETENTION_YEARS = 7

export function sha256Hex(bytes: ArrayBuffer | Uint8Array): string {
  return createHash('sha256').update(new Uint8Array(bytes as ArrayBuffer)).digest('hex')
}

/** Seven years on from `from`: the end of retention once its clock has started. */
export function retainUntil(from: string): string {
  const d = new Date(from)
  d.setUTCFullYear(d.getUTCFullYear() + RETENTION_YEARS)
  return d.toISOString()
}

/**
 * retain_until for a record as it completes. One linked to a member account is
 * kept while the account is open, so it has no end date yet: the clock starts
 * when the account is deactivated or a deletion request is met
 * (startRetentionClock). One with no account starts its clock at signing.
 */
export function retainUntilOnCompletion(completedAt: string, memberId: string | null | undefined): string | null {
  return memberId ? null : retainUntil(completedAt)
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
