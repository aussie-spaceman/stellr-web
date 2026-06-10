'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'

interface Props {
  /** Server endpoint that validates access and returns { url, title }. */
  endpoint: string
  title: string
  label?: string
}

// Generic signed-URL download button. The endpoint does the server-side access
// check (entitlement engine / participant guard) and returns a short-lived URL;
// the storage path is never exposed to the client.
export function MaterialDownloadButton({ endpoint, title, label = 'Download' }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const download = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(endpoint)
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Download failed')
        return
      }
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
        className="inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        <Download className="h-3.5 w-3.5" />
        {loading ? 'Preparing…' : label}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
