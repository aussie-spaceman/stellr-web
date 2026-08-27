'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'

interface Props {
  /** community_resources id — used when the file is not a catalogue attachment. */
  resourceId: string
  /**
   * container_contents id when the file is LINKED in from the global catalogue.
   * Those binaries carry no space_id, so the by-binary route cannot gate them —
   * open them through the container-gated attachment route instead.
   */
  attachmentId?: string | null
  /** Links open in a new tab; files download. */
  kind?: 'file' | 'link'
  title: string
}

// Fetches a short-lived signed URL from the server, then triggers a browser download.
// The storage path is never exposed to the client — the server validates access
// and generates the URL server-side (FR-COM-03).
export function ResourceDownloadButton({ resourceId, attachmentId, kind = 'file', title }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const download = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        attachmentId
          ? `/api/community/resources/attachment/${attachmentId}/download`
          : `/api/community/resources/${resourceId}/download`
      )
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Download failed')
        return
      }
      if ((json.kind ?? kind) === 'link') {
        window.open(json.url, '_blank', 'noopener,noreferrer')
        return
      }
      // Trigger download without exposing the signed URL in the DOM.
      const a = document.createElement('a')
      a.href = json.url
      a.download = title
      a.rel = 'noopener noreferrer'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } catch {
      setError('Network error — please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <button
        onClick={download}
        disabled={loading}
        className="inline-flex items-center gap-1.5 rounded-md bg-brand-blue-dark px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-blue-dark disabled:opacity-50"
      >
        <Download className="h-3.5 w-3.5" />
        {loading ? 'Preparing…' : kind === 'link' ? 'Open' : 'Download'}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
