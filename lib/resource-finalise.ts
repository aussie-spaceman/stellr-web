import { supabaseServer } from '@/lib/supabase'
import { isPdf } from '@/lib/watermark/pdf'
import { stampPdfSandboxed } from '@/lib/pdf-sandbox'
import { PDF_BUSY, PDF_UNPROCESSABLE } from '@/lib/pdf-page-count'
import { sniffFileFormat } from '@/lib/file-sniff'
import {
  claimUpload,
  discardUpload,
  replaceUpload,
  type ClaimedUpload,
  type UploadPurpose,
  type UploadDenied,
} from '@/lib/uploads'

// Second half of a direct-to-storage upload that becomes a community_resources
// row. The browser has already put the bytes in the bucket via a signed URL;
// this claims the stored object, watermarks it in place, and records it.
//
// The watermark guarantee is unchanged by the move to direct uploads: it still
// happens server-side on every page. An object is unstamped only between the
// signed PUT and this call, inside a private bucket, before any row exists to
// reach it by.

type Finalised = { id: string }

export async function finaliseStoredUpload(args: {
  purpose: UploadPurpose
  storagePath: string
  title: string
  description?: string | null
  spaceId?: string | null
  /** Stored verbatim in file_type — a mime type or a short label, per caller. */
  fileType: string | null
  uploadedBy: string | null
  fromChat?: boolean
  contentHash?: string | null
  /** deep review MEM-13: forwarded to claimUpload to pin the namespace. */
  expectedPrefix?: string
  /**
   * What the caller's own claimUpload of this purpose and path returned, when
   * it made one first (to hash the bytes, say). It isn't claimed again: that
   * downloaded and sniffed up to 25MB a second time to learn nothing new.
   */
  claimed?: ClaimedUpload
}): Promise<Finalised | UploadDenied> {
  const claimed =
    args.claimed ??
    (await claimUpload({
      purpose: args.purpose,
      storagePath: args.storagePath,
      expectedPrefix: args.expectedPrefix,
    }))
  if ('error' in claimed) return claimed

  const { bucket } = claimed
  const bytes = await watermarkIfPdf(bucket, args.storagePath, claimed.bytes, args.fileType)
  if ('error' in bytes) return bytes

  const { data: resource, error: dbError } = await supabaseServer()
    .from('community_resources')
    .insert({
      space_id: args.spaceId ?? null,
      title: args.title,
      description: args.description ?? null,
      storage_path: args.storagePath,
      file_type: args.fileType,
      file_size_bytes: bytes.byteLength,
      uploaded_by: args.uploadedBy,
      ...(args.contentHash ? { content_hash: args.contentHash } : {}),
      ...(args.fromChat === undefined ? {} : { from_chat: args.fromChat }),
    })
    .select('id')
    .single()

  if (dbError || !resource) {
    // Don't leave the bucket holding a file nothing points at.
    await discardUpload(bucket, args.storagePath)
    console.error('[community] finalise: db insert error:', dbError)
    return { error: 'Failed to save resource', status: 500 }
  }

  return { id: resource.id as string }
}

/**
 * Copyright watermark on the bottom-right of every page of a stored PDF,
 * rewritten in place. Returns the bytes now in storage — the original when
 * pdf-lib can't read the file or the rewrite fails, since losing the upload
 * would be worse than missing a stamp.
 *
 * pdf-lib runs in the sandbox (lib/pdf-sandbox.ts), never on this thread. A
 * file the sandbox had to stop — past the timeout or the heap limit, or a
 * worker that died, or one its own scan refused — is refused, as is one no
 * worker came free for in time (PDF_BUSY, 503): the object is discarded and a denial
 * returned, for the caller to send back as it sends a claimUpload denial.
 */
export async function watermarkIfPdf(
  bucket: string,
  storagePath: string,
  bytes: Uint8Array,
  fileType: string | null,
): Promise<Uint8Array | UploadDenied> {
  const name = storagePath.split('/').pop() ?? ''
  if (!isPdf(name, fileType)) return bytes
  // The type is the browser's word. pdf-lib reads any bytes as a PDF if a
  // `%PDF-` sits somewhere inside, so only bytes claimUpload judged a PDF —
  // and page-counted, for a member's — ever reach it.
  if (sniffFileFormat(bytes, ['pdf']) !== 'pdf') return bytes

  const stamped = await stampPdfSandboxed(bytes)
  if (!stamped.ok) {
    if (stamped.reason === 'invalid') {
      console.error('[community] watermark failed, keeping original:', stamped.detail)
      return bytes
    }
    // The sandbox has logged it (console and app_errors).
    await discardUpload(bucket, storagePath)
    // No worker came free in time: the file wasn't judged, so ask again later.
    // Stored unstamped, it would be served without its mark.
    if (stamped.reason === 'busy') return { error: PDF_BUSY, status: 503 }
    return { error: PDF_UNPROCESSABLE, status: 422 }
  }
  if (await replaceUpload(bucket, storagePath, stamped.value, 'application/pdf')) return stamped.value
  return bytes
}
