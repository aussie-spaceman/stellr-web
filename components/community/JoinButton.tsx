'use client'

import { useState } from 'react'
import { Video } from 'lucide-react'

// Fetches a fresh join token for a session and opens the room. The host receives
// a moderator token (recording rights); participants a guest token (FR-COM-11/12).
export function JoinButton({ sessionId }: { sessionId: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const join = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/community/sessions/${sessionId}/join`)
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Could not join')
        return
      }
      const url = json.token ? `${json.joinUrl}?jwt=${encodeURIComponent(json.token)}` : json.joinUrl
      window.open(url, '_blank', 'noopener,noreferrer')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <button
        onClick={join}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        <Video className="h-3.5 w-3.5" />
        {busy ? 'Joining…' : 'Join'}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
