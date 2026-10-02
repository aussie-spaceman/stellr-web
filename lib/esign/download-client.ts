'use client'

/**
 * Downloads a signed agreement from one of the download routes. They answer
 * either with JSON carrying a short-lived storage link (the normal case) or,
 * for a record not stored here yet, with the PDF itself.
 */
export async function downloadSignedRecord(endpoint: string, fallbackFilename: string): Promise<void> {
  const res = await fetch(endpoint, { cache: 'no-store' })
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: string } | null
    throw new Error(body?.error ?? 'Download failed')
  }

  const a = document.createElement('a')
  a.rel = 'noopener noreferrer'
  if ((res.headers.get('content-type') ?? '').includes('application/json')) {
    const { url, filename } = await res.json() as { url: string; filename?: string }
    a.href = url
    a.download = filename ?? fallbackFilename
    a.click()
    return
  }

  const blobUrl = URL.createObjectURL(await res.blob())
  a.href = blobUrl
  a.download = fallbackFilename
  a.click()
  URL.revokeObjectURL(blobUrl)
}
