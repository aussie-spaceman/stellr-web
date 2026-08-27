// Browser-side half of every file upload in the app.
//
// Bytes never pass through a route handler: Vercel rejects a request body over
// 4.5MB before the function runs, and no configuration changes that. Instead the
// browser asks /api/uploads/sign for a short-lived Supabase signed upload URL,
// PUTs the file straight to storage, and posts back only the path — the owning
// route then claims and verifies the stored object. Per-purpose limits and
// authorisation live in lib/uploads.ts, which is the single source of truth.
//
// The one thing that still happens here is reading the file off disk FIRST. A
// picked File is only a handle to bytes; files on a cloud-synced mount (Google
// Drive File Stream, iCloud "Optimise Mac Storage") are often placeholders, and
// streaming straight from the handle fails mid-upload with nothing to show for
// it. Reading waits out a lazy download and names a file that genuinely can't
// be read.

// Client-side backstop only. The real, per-purpose limit is enforced server-side
// in lib/uploads.ts; this just avoids reading a hopeless file into memory before
// asking. Keep it at or above the largest purpose there (training video).
export const MAX_DIRECT_UPLOAD_BYTES = 200 * 1024 * 1024

type UploadFailure = { error: string }

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Read a picked file fully into memory, ready to be sent as a request body.
 * Returns the blob, or a message explaining why the file can't be uploaded.
 */
export async function readUploadBlob(
  file: File,
  maxBytes: number,
): Promise<{ blob: Blob } | UploadFailure> {
  if (file.size > maxBytes) {
    return {
      error: `“${file.name}” is ${mb(file.size)}. Uploads are limited to ${mb(maxBytes)} — add it as a link instead.`,
    }
  }

  let buffer: ArrayBuffer
  try {
    buffer = await file.arrayBuffer()
  } catch {
    return { error: unreadable(file) }
  }
  // A cloud placeholder can also read back as zero bytes instead of throwing.
  if (buffer.byteLength === 0) return { error: unreadable(file) }

  return { blob: new Blob([buffer], { type: file.type || 'application/octet-stream' }) }
}

function unreadable(file: File): string {
  return `Could not read “${file.name}” from disk. If it lives in Google Drive or iCloud, open it once so it downloads locally, then try again.`
}

/**
 * POST a body and normalise every failure into a message. Never throws, so a
 * caller's busy state always clears and the user always sees a reason.
 */
export async function postUpload(
  url: string,
  body: BodyInit,
  init?: RequestInit,
): Promise<{ data: Record<string, unknown> } | UploadFailure> {
  let res: Response
  try {
    res = await fetch(url, { method: 'POST', body, ...init })
  } catch {
    return { error: 'The upload never reached the server. Check your connection and try again.' }
  }

  // Platform-level rejections (413, 502, 504) answer with HTML, not JSON — read
  // as text first so a parse failure can't masquerade as a network error.
  const text = await res.text().catch(() => '')
  let data: Record<string, unknown> = {}
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    data = {}
  }

  if (!res.ok) {
    if (typeof data.error === 'string') return { error: data.error }
    if (res.status === 413) return { error: 'That file is too large to upload.' }
    return { error: `Upload failed (HTTP ${res.status}). Please try again.` }
  }
  return { data }
}

export type StoredUpload = {
  storagePath: string
  fileName: string
  fileType: string
  fileSize: number
}

/**
 * Send a file straight to Supabase Storage for a given purpose.
 *
 * The purpose decides the bucket, the size limit and who may upload — all of it
 * server-side in lib/uploads.ts. On success the caller posts the returned
 * storagePath to whichever route owns the resulting record.
 */
export async function uploadDirectToStorage(
  file: File,
  purpose: string,
  context: Record<string, string | undefined> = {},
): Promise<StoredUpload | UploadFailure> {
  const contentType = file.type || 'application/octet-stream'

  // Read before signing: no point burning a signed URL on a file we can't read,
  // and the size the server signs against should be the size we actually hold.
  const read = await readUploadBlob(file, MAX_DIRECT_UPLOAD_BYTES)
  if ('error' in read) return read

  const ticket = await postUpload(
    '/api/uploads/sign',
    JSON.stringify({ purpose, context, fileName: file.name, fileSize: read.blob.size, contentType }),
    { headers: { 'Content-Type': 'application/json' } },
  )
  if ('error' in ticket) return ticket

  const path = ticket.data.path as string | undefined
  const token = ticket.data.token as string | undefined
  const bucket = ticket.data.bucket as string | undefined
  if (!path || !token || !bucket) {
    return { error: 'Could not start the upload. Please try again.' }
  }

  // Loaded on demand so route handlers importing the size constants above don't
  // pull the browser client into a server bundle.
  const { createStorageUploadClient } = await import('@/lib/supabase-browser')
  try {
    const { error } = await createStorageUploadClient()
      .storage.from(bucket)
      .uploadToSignedUrl(path, token, read.blob, { contentType, upsert: true })
    if (error) return { error: `Storage rejected the file: ${error.message}` }
  } catch {
    return { error: 'The file did not reach storage. Check your connection and try again.' }
  }

  return { storagePath: path, fileName: file.name, fileType: contentType, fileSize: read.blob.size }
}
