// Browser-side helpers shared by every "pick a file and POST it" form.
//
// Two failure modes used to surface as an opaque "Network error" (or, where a
// form forgot its catch, as nothing at all — a modal stuck on "Uploading…"):
//
//  1. The picked File is only a handle to bytes on disk. Files on a virtual or
//     cloud-synced mount (Google Drive File Stream, iCloud "Optimise Mac
//     Storage", a network share) are frequently placeholders, so the read fails
//     at the moment fetch() streams the request body. The fetch rejects and the
//     request never reaches the server at all — nothing to see in any log.
//     readUploadBlob() pulls the bytes into memory FIRST, which both waits for
//     a lazy download to finish and turns an unreadable file into a message.
//
//  2. The body is over the platform's request limit, so it is rejected at the
//     edge before the function runs. Guard it here rather than let the browser
//     report a bare transport failure.

// Vercel rejects a request body larger than 4.5 MB before the function runs.
// Cap the file itself a little under that so the multipart envelope and the
// other form fields still fit.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024

type UploadFailure = { error: string }

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Read a picked file fully into memory, ready to be sent as a request body.
 * Returns the blob, or a message explaining why the file can't be uploaded.
 */
export async function readUploadBlob(file: File): Promise<{ blob: Blob } | UploadFailure> {
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      error: `“${file.name}” is ${mb(file.size)}. Uploads are limited to ${mb(MAX_UPLOAD_BYTES)} — add it as a link instead.`,
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
    if (res.status === 413) return { error: `That file is too large to upload (max ${mb(MAX_UPLOAD_BYTES)}).` }
    return { error: `Upload failed (HTTP ${res.status}). Please try again.` }
  }
  return { data }
}
