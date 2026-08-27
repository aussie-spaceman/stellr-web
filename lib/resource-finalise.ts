import { supabaseServer } from '@/lib/supabase'
import { RESOURCES_BUCKET } from '@/lib/community'
import { isPdf, stampPdfBytes } from '@/lib/watermark/pdf'
import { MAX_DIRECT_UPLOAD_BYTES } from '@/lib/upload-client'

// Second half of a direct-to-storage upload. The browser has already put the
// bytes in the bucket via a signed URL (which is how a file larger than the
// platform's 4.5MB request-body limit gets in at all); this takes it from
// there — watermark the stored object in place, then record the row.
//
// The watermark still happens server-side, so the guarantee is unchanged: an
// object sits unstamped only between the signed PUT and this call, inside a
// private bucket, before any row exists to reach it by.

// Only paths this app issues. An admin is trusted, but a typo shouldn't be able
// to rewrite an unrelated object (a lesson recording, say).
const ALLOWED_PREFIXES = ['resources/', 'community-resources/']

type Finalised = { id: string }
type FinaliseError = { error: string; status: number }

export async function finaliseStoredUpload(args: {
  storagePath: string
  title: string
  description?: string | null
  spaceId?: string | null
  /** Stored verbatim in file_type — a mime type or a short label, per caller. */
  fileType: string | null
  uploadedBy: string | null
  fromChat?: boolean
}): Promise<Finalised | FinaliseError> {
  const { storagePath } = args
  if (!ALLOWED_PREFIXES.some((p) => storagePath.startsWith(p)) || storagePath.includes('..')) {
    return { error: 'That upload path is not one we issued.', status: 400 }
  }

  const db = supabaseServer()

  const { data: stored, error: downloadError } = await db.storage
    .from(RESOURCES_BUCKET)
    .download(storagePath)
  if (downloadError || !stored) {
    console.error('[community] finalise: stored object missing:', storagePath, downloadError)
    return { error: 'The uploaded file could not be found. Please try uploading it again.', status: 400 }
  }

  let bytes = new Uint8Array(await stored.arrayBuffer())

  // Re-check the real size here: the signed URL was issued against a size the
  // browser claimed, and this is the first point we see the actual object.
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_DIRECT_UPLOAD_BYTES) {
    await db.storage.from(RESOURCES_BUCKET).remove([storagePath])
    return {
      error: bytes.byteLength === 0 ? 'That file arrived empty — please try again.' : 'File too large.',
      status: bytes.byteLength === 0 ? 400 : 413,
    }
  }

  // Copyright watermark on the bottom-right of every page of uploaded PDFs.
  const name = storagePath.split('/').pop() ?? ''
  if (isPdf(name, args.fileType)) {
    try {
      const stamped = new Uint8Array(await stampPdfBytes(bytes))
      const { error: reuploadError } = await db.storage
        .from(RESOURCES_BUCKET)
        .upload(storagePath, stamped, { contentType: 'application/pdf', upsert: true })
      if (reuploadError) {
        console.error('[community] finalise: watermark re-upload failed:', reuploadError)
      } else {
        bytes = stamped
      }
    } catch (err) {
      console.error('[community] finalise: watermark failed, keeping original:', err)
    }
  }

  const { data: resource, error: dbError } = await db
    .from('community_resources')
    .insert({
      space_id: args.spaceId ?? null,
      title: args.title,
      description: args.description ?? null,
      storage_path: storagePath,
      file_type: args.fileType,
      file_size_bytes: bytes.byteLength,
      uploaded_by: args.uploadedBy,
      ...(args.fromChat === undefined ? {} : { from_chat: args.fromChat }),
    })
    .select('id')
    .single()

  if (dbError || !resource) {
    // Don't leave the bucket holding a file nothing points at.
    await db.storage.from(RESOURCES_BUCKET).remove([storagePath])
    console.error('[community] finalise: db insert error:', dbError)
    return { error: 'Failed to save resource', status: 500 }
  }

  return { id: resource.id as string }
}
