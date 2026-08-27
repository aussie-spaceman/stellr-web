import { supabaseServer } from '@/lib/supabase'
import { isPdf, stampPdfBytes } from '@/lib/watermark/pdf'
import { claimUpload, discardUpload, replaceUpload, type UploadPurpose, type UploadDenied } from '@/lib/uploads'

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
}): Promise<Finalised | UploadDenied> {
  const claimed = await claimUpload({ purpose: args.purpose, storagePath: args.storagePath })
  if ('error' in claimed) return claimed

  const { bucket } = claimed
  const bytes = await watermarkIfPdf(bucket, args.storagePath, claimed.bytes, args.fileType)

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
 * rewritten in place. Returns the bytes now in storage — the original on any
 * failure, since losing the upload would be worse than missing a stamp.
 */
export async function watermarkIfPdf(
  bucket: string,
  storagePath: string,
  bytes: Uint8Array,
  fileType: string | null,
): Promise<Uint8Array> {
  const name = storagePath.split('/').pop() ?? ''
  if (!isPdf(name, fileType)) return bytes

  try {
    const stamped = new Uint8Array(await stampPdfBytes(bytes))
    if (await replaceUpload(bucket, storagePath, stamped, 'application/pdf')) return stamped
  } catch (err) {
    console.error('[community] watermark failed, keeping original:', err)
  }
  return bytes
}
