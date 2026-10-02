import type { SupabaseClient } from '@supabase/supabase-js'
import { SIGNED_BUCKET, sha256Hex } from '@/lib/esign/storage'
import { notifyCommunityAdmins } from '@/lib/notify'

// Checks that stored signed records are still what was signed. Each day a
// slice of the archive is re-hashed against the hash recorded when it was
// stored, and each Stellr-signing agreement in the slice has its audit trail
// re-verified link by link. The whole archive is covered over successive days.
// A mismatch is the one thing here that should never happen, so it alerts.

const DAILY_SAMPLE = 15

export interface IntegrityResult {
  checked: number
  hashMismatches: string[]
  brokenTrails: string[]
  unreadable: string[]
}

export async function checkIntegrity(
  db: SupabaseClient,
  opts: { now?: Date; sample?: number } = {},
): Promise<IntegrityResult> {
  const now = opts.now ?? new Date()
  const sample = opts.sample ?? DAILY_SAMPLE
  const { count } = await db
    .from('docusign_envelopes')
    .select('id', { count: 'exact', head: true })
    .not('signed_pdf_path', 'is', null)
  const total = count ?? 0
  const result: IntegrityResult = { checked: 0, hashMismatches: [], brokenTrails: [], unreadable: [] }
  if (!total) return result

  // A different slice each day, cycling through the whole archive.
  const day = Math.floor(now.getTime() / 86_400_000)
  const offset = (day * sample) % total
  const { data } = await db
    .from('docusign_envelopes')
    .select('id, provider, signed_pdf_path, signed_pdf_sha256')
    .not('signed_pdf_path', 'is', null)
    .order('id', { ascending: true })
    .range(offset, offset + sample - 1)

  for (const row of (data ?? []) as { id: string; provider: string | null; signed_pdf_path: string; signed_pdf_sha256: string | null }[]) {
    result.checked++
    const { data: blob, error } = await db.storage.from(SIGNED_BUCKET).download(row.signed_pdf_path)
    if (error || !blob) {
      result.unreadable.push(row.id)
      continue
    }
    if (row.signed_pdf_sha256 && sha256Hex(await blob.arrayBuffer()) !== row.signed_pdf_sha256) {
      result.hashMismatches.push(row.id)
    }
    if ((row.provider ?? 'docusign') === 'native') {
      const { data: badId, error: verifyError } = await db.rpc('esign_verify_audit', { p_envelope: row.id })
      if (verifyError || badId !== null) result.brokenTrails.push(row.id)
    }
  }

  const problems = [...result.hashMismatches, ...result.brokenTrails, ...result.unreadable]
  if (problems.length) {
    const body =
      `The daily check of stored signed agreements found a problem. ` +
      `${result.hashMismatches.length} document(s) no longer match their recorded fingerprint, ` +
      `${result.brokenTrails.length} audit trail(s) failed verification, and ` +
      `${result.unreadable.length} could not be read. Agreement ids: ${problems.join(', ')}. ` +
      `Restore these from the encrypted backup (scripts/esign-restore-drill.ts) and investigate how they changed.`
    await notifyCommunityAdmins({
      type: 'action',
      body,
      email: { subject: 'Signed agreement integrity check failed', html: `<p>${body}</p>`, text: body },
    }).catch(() => {})
  }
  return result
}
