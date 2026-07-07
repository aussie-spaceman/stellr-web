'use client'

import { useState, useEffect } from 'react'
import { Radio, X, AlertCircle, Play, Download } from 'lucide-react'
import { VideoRoom } from '@/components/video/VideoRoom'

// Launches the JaaS/Jitsi recording room for a 'live' (Record) lesson, as host.
// The room name is the lesson id, so JaaS's recording webhook attaches the saved
// recording back to this lesson. Rendered in the Course-builder lesson editor.

interface RoomConfig {
  domain: string
  scriptSrc: string
  roomName: string
  jwt: string
  displayName: string
  configured: boolean
}

const STATUS_COPY: Record<string, { label: string; color: string }> = {
  available: { label: 'Recording saved to this lesson', color: '#158463' },
  pending: { label: 'Recording is processing…', color: '#B07A1E' },
  none: { label: 'No recording yet', color: '#8A91AB' },
}

export function RecordSession({
  itemId,
  recordingStatus,
}: {
  itemId: string
  recordingStatus?: string | null
}) {
  const [config, setConfig] = useState<RoomConfig | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null)
  const [showPlayer, setShowPlayer] = useState(false)

  // When a recording has been offloaded to storage, fetch a short-lived signed
  // URL so the saved session can be played back / downloaded here.
  useEffect(() => {
    if (recordingStatus !== 'available') { setRecordingUrl(null); return }
    let active = true
    ;(async () => {
      const res = await fetch(`/api/admin/community/training/recording?itemId=${itemId}`)
      if (!active || !res.ok) return
      const d = await res.json().catch(() => ({}))
      if (active) setRecordingUrl(d.url ?? null)
    })()
    return () => { active = false }
  }, [itemId, recordingStatus])

  const launch = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/training/live-room?itemId=${itemId}`)
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || 'Could not start the session.')
        return
      }
      setConfig(await res.json())
      setOpen(true)
    } finally {
      setLoading(false)
    }
  }

  const status = STATUS_COPY[recordingStatus ?? 'none'] ?? STATUS_COPY.none

  return (
    <div className="rounded-xl border border-brand-border p-4">
      <div className="flex items-center gap-2">
        <Radio className="h-4 w-4 text-brand-blue-bright" />
        <p className="text-sm font-semibold text-brand-blue-dark">Recording session</p>
      </div>
      <p className="mt-0.5 text-xs text-brand-muted-soft">
        Launch the live room as host and admit yourself from the prejoin screen — file recording starts
        automatically on join. If it doesn&rsquo;t, start it from the room toolbar (Record → file). When the
        session ends the recording attaches to this lesson automatically.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          onClick={launch}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-bright disabled:opacity-50"
        >
          <Radio className="h-4 w-4" /> {loading ? 'Starting…' : 'Launch recording session'}
        </button>
        <span className="text-xs font-medium" style={{ color: status.color }}>
          {status.label}
        </span>
        {recordingStatus === 'available' && recordingUrl && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowPlayer((v) => !v)}
              className="inline-flex items-center gap-1 rounded-lg border border-brand-border px-2.5 py-1.5 text-xs font-semibold text-brand-muted hover:border-brand-blue hover:text-brand-blue"
            >
              <Play className="h-3.5 w-3.5" /> {showPlayer ? 'Hide recording' : 'View recording'}
            </button>
            <a
              href={recordingUrl}
              download
              className="inline-flex items-center gap-1 rounded-lg border border-brand-border px-2.5 py-1.5 text-xs font-semibold text-brand-muted hover:border-brand-blue hover:text-brand-blue"
            >
              <Download className="h-3.5 w-3.5" /> Download
            </a>
          </div>
        )}
      </div>

      {showPlayer && recordingUrl && (
        <video src={recordingUrl} controls className="mt-3 w-full rounded-lg border border-brand-border bg-black" />
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {open && config && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/80 p-4">
          <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col overflow-hidden rounded-2xl bg-[#0E1330]">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div className="flex items-center gap-2 text-white">
                <Radio className="h-4 w-4" />
                <span className="text-sm font-semibold">Recording session (host)</span>
                {!config.configured && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/20 px-2 py-0.5 text-[11px] font-medium text-amber-200">
                    <AlertCircle className="h-3 w-3" /> Dev room — recording capture needs JaaS configured
                  </span>
                )}
              </div>
              <button
                onClick={() => setOpen(false)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/20"
              >
                <X className="h-4 w-4" /> End &amp; close
              </button>
            </div>
            <VideoRoom
              scriptSrc={config.scriptSrc}
              domain={config.domain}
              roomName={config.roomName}
              jwt={config.jwt}
              displayName={config.displayName}
              isHost
              autoRecord={config.configured}
              className="w-full flex-1 bg-black"
            />
          </div>
        </div>
      )}
    </div>
  )
}
