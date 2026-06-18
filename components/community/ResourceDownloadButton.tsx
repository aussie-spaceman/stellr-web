'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'

interface Props {
  resourceId: string
  title: string
}

// Fetches a short-lived signed URL from the server, then triggers a browser download.
// The storage path is never exposed to the client — the server validates the tier
// and generates the URL server-side (FR-COM-03).
export function ResourceDownloadButton({ resourceId, title }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const download = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/community/resources/${resourceId}/download`)
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Download failed')
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
        {loading ? 'Preparing…' : 'Download'}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
