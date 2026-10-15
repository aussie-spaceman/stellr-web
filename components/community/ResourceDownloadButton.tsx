'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'
import { openPendingTab } from '@/lib/open-in-new-tab'

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
    // A link opens in a new tab. Open it now, inside the tap: iOS Safari drops
    // a window opened after the fetch below.
    const tab = kind === 'link' ? openPendingTab() : null
    try {
      const res = await fetch(
        attachmentId
          ? `/api/community/resources/attachment/${attachmentId}/download`
          : `/api/community/resources/${resourceId}/download`
      )
      const json = await res.json()
      if (!res.ok) {
        tab?.close()
        setError(json.error ?? 'Download failed')
        return
      }
      if ((json.kind ?? kind) === 'link') {
        // No tab yet (the server says link, the button said file): go there here.
        if (tab) tab.go(json.url)
        else window.location.assign(json.url)
        return
      }
      tab?.close()
      // Trigger download without exposing the signed URL in the DOM.
      const a = document.createElement('a')
      a.href = json.url
      a.download = title
      a.rel = 'noopener noreferrer'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } catch {
      tab?.close()
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
