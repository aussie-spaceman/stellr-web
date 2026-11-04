'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Download, Loader2, Play, Radio, RotateCcw, Trash2, X } from 'lucide-react'
import { Dialog } from '@stellr/web-ui'
import { VideoRoom, type JitsiApi } from '@/components/video/VideoRoom'
import type { RecordingPhase } from '@/lib/recording-view'

// Launches the JaaS/Jitsi recording room for a 'live' (Record) lesson, as host,
// and shows where the recording is from then on. The room name is the lesson id,
// so JaaS's webhook attaches the saved file back to this lesson. Rendered in the
// Course-builder lesson editor.

interface RoomConfig {
  domain: string
  scriptSrc: string
  roomName: string
  jwt: string
  displayName: string
  configured: boolean
}

interface Status {
  phase: RecordingPhase
  message: string
  hasFile: boolean
  canRetry: boolean
  retryUntil: string | null
  sizeBytes: number | null
  url: string | null
  fileLimitBytes: number | null
}

const API = '/api/admin/community/training/recording'
const POLL_MS = 5000
const MB = 1024 * 1024
// Roughly a 30-minute session. Below this, say so before anyone records.
const LONG_SESSION_BYTES = 500 * MB
// How long the room gets to report that recording started before we warn.
const START_GRACE_MS = 20_000

const PHASE_CLASS: Record<RecordingPhase, string> = {
  none: 'text-content-faint',
  recording: 'text-danger',
  processing: 'text-gold-ink',
  saving: 'text-gold-ink',
  failed: 'text-danger',
  saved: 'text-enviro-green-text',
}

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function RecordSession({ itemId, onChanged }: { itemId: string; onChanged?: () => void }) {
  const [config, setConfig] = useState<RoomConfig | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [showPlayer, setShowPlayer] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [busy, setBusy] = useState(false)

  // In the room.
  const [recordingSince, setRecordingSince] = useState<number | null>(null)
  const isRecording = useRef(false)
  const [roomError, setRoomError] = useState<string | null>(null)
  const [slowStart, setSlowStart] = useState(false)
  const [ending, setEnding] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const apiRef = useRef<JitsiApi | null>(null)

  const refresh = useCallback(async () => {
    const res = await fetch(`${API}?itemId=${itemId}`)
    if (!res.ok) return
    setStatus((await res.json()) as Status)
  }, [itemId])

  useEffect(() => { void refresh() }, [refresh])

  // Follow a recording that is on its way. These phases end by themselves, and
  // whoever is watching needs to see it land or fail without reloading.
  const phase = status?.phase ?? null
  useEffect(() => {
    if (phase !== 'processing' && phase !== 'saving' && !(phase === 'recording' && !open)) return
    const t = setInterval(() => { void refresh() }, POLL_MS)
    return () => clearInterval(t)
  }, [phase, open, refresh])

  // Keep the lesson list's status chip in step.
  const lastPhase = useRef<RecordingPhase | null>(null)
  useEffect(() => {
    if (phase && lastPhase.current && lastPhase.current !== phase) onChanged?.()
    if (phase) lastPhase.current = phase
  }, [phase, onChanged])

  // Leaving ends the room, and with it the recording.
  useEffect(() => {
    if (!open) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [open])

  useEffect(() => {
    if (recordingSince === null) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [recordingSince])

  useEffect(() => {
    if (!open || recordingSince !== null) { setSlowStart(false); return }
    const t = setTimeout(() => setSlowStart(true), START_GRACE_MS)
    return () => clearTimeout(t)
  }, [open, recordingSince])

  const report = useCallback(
    (action: 'started' | 'ended' | 'retry') =>
      fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId, action }) }),
    [itemId],
  )

  // Stable, or the room would remount (and drop the host) on every status change.
  const onRecordingChange = useCallback(
    ({ on, error: why }: { on: boolean; error?: string }) => {
      if (why) setRoomError(`Recording stopped or could not start (${why}). Use Record in the room toolbar to try again.`)
      if (on && !isRecording.current) {
        isRecording.current = true
        setRoomError(null)
        setNow(Date.now())
        setRecordingSince(Date.now())
        void report('started').then(refresh)
      } else if (!on && isRecording.current) {
        isRecording.current = false
        setRecordingSince(null)
        void report('ended').then(refresh)
      }
    },
    [report, refresh],
  )
  const onApi = useCallback((api: JitsiApi) => { apiRef.current = api }, [])

  const launch = async () => {
    setLoading(true)
    setError(null)
    setRoomError(null)
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

  const endAndClose = async () => {
    setEnding(true)
    try {
      if (isRecording.current) {
        // Stop first, then give the room a moment to act on it before it unmounts.
        try { apiRef.current?.executeCommand('stopRecording', 'file') } catch { /* the room ending stops it too */ }
        isRecording.current = false
        setRecordingSince(null)
        await report('ended')
        await new Promise((r) => setTimeout(r, 1500))
      }
      setOpen(false)
      setConfig(null)
      apiRef.current = null
      await refresh()
    } finally {
      setEnding(false)
    }
  }

  const retry = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await report('retry')
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || 'Could not retry.')
      }
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`${API}?itemId=${itemId}`, { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || 'Could not delete the recording.')
        return
      }
      setShowPlayer(false)
      setConfirmingDelete(false)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const current = phase ?? 'none'
  const working = current === 'processing' || current === 'saving'
  const url = status?.url ?? null
  const limit = status?.fileLimitBytes ?? null
  const limited = limit !== null && limit < LONG_SESSION_BYTES

  return (
    <div className="rounded-xl border border-brand-border p-4">
      <div className="flex items-center gap-2">
        <Radio className="h-4 w-4 text-brand-blue-bright" aria-hidden="true" />
        <p className="text-sm font-semibold text-brand-blue-dark">Recording session</p>
      </div>
      <p className="mt-0.5 text-xs text-brand-muted-soft">
        Launch the live room as host and admit yourself from the prejoin screen. File recording starts
        automatically on join, and the session window shows whether it is running. When you end the session the
        recording attaches to this lesson.
        {status?.hasFile && ' Recording again replaces the saved video once the new one has saved.'}
      </p>

      {limited && (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs font-medium text-gold-ink">
          <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Storage is limited to {Math.round((limit as number) / MB)} MB per file, so a session longer than a few minutes
            will not save. Use a video link for longer lessons until the limit is raised.
          </span>
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          onClick={launch}
          disabled={loading || working}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-bright disabled:opacity-50"
        >
          <Radio className="h-4 w-4" aria-hidden="true" /> {loading ? 'Starting…' : 'Launch recording session'}
        </button>
        {status?.hasFile && url && !confirmingDelete && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setShowPlayer((v) => !v)}
              className="inline-flex items-center gap-1 rounded-lg border border-brand-border px-2.5 py-1.5 text-xs font-semibold text-brand-muted hover:border-brand-blue hover:text-brand-blue"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" /> {showPlayer ? 'Hide recording' : 'View recording'}
            </button>
            <a
              href={url}
              download
              className="inline-flex items-center gap-1 rounded-lg border border-brand-border px-2.5 py-1.5 text-xs font-semibold text-brand-muted hover:border-brand-blue hover:text-brand-blue"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download
            </a>
            <button
              onClick={() => setConfirmingDelete(true)}
              disabled={working || current === 'recording'}
              className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-danger hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete recording
            </button>
          </div>
        )}
      </div>

      {confirmingDelete && (
        <div role="alertdialog" aria-label="Delete this recording?" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-xs font-medium text-ink">
            Delete this recording? Members will no longer be able to watch it, and it cannot be recovered.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={remove}
              disabled={busy}
              className="rounded-lg bg-danger px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy ? 'Deleting…' : 'Delete recording'}
            </button>
            <button onClick={() => setConfirmingDelete(false)} disabled={busy} className="px-2 py-1.5 text-xs text-brand-muted">
              Keep it
            </button>
          </div>
        </div>
      )}

      {/* The one place that says where the recording is. */}
      <div aria-live="polite" className={`mt-3 flex items-start gap-1.5 text-xs font-medium ${PHASE_CLASS[current]}`}>
        {working && <Loader2 className="mt-px h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
        {current === 'failed' && <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        {current === 'saved' && <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        <span>
          {status ? status.message : 'Checking…'}
          {current === 'failed' && status?.hasFile && ' The previous recording is still in place.'}
        </span>
      </div>

      {current === 'failed' && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {status?.canRetry && (
            <button
              onClick={retry}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-lg border border-brand-border px-2.5 py-1.5 text-xs font-semibold text-brand-muted hover:border-brand-blue hover:text-brand-blue disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> {busy ? 'Retrying…' : 'Retry saving'}
            </button>
          )}
          {status?.canRetry && status.retryUntil && (
            <span className="text-xs text-brand-muted-soft">
              Available until {new Date(status.retryUntil).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
            </span>
          )}
          {!status?.hasFile && (
            <button onClick={remove} disabled={busy} className="text-xs font-medium text-brand-muted-soft hover:text-brand-muted disabled:opacity-50">
              Dismiss
            </button>
          )}
        </div>
      )}

      {showPlayer && url && (
        <video src={url} controls className="mt-3 w-full rounded-lg border border-brand-border bg-black" />
      )}

      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}

      {/* Not dismissible: Escape or a stray tap on the scrim would drop the host
          out of a recording. "End & close" is the one way out. The panel takes
          the full height so the room gets as much of the screen as it can. */}
      <Dialog
        open={open && config !== null}
        onClose={() => setOpen(false)}
        title="Recording session (host)"
        description={
          config && !config.configured ? (
            <span className="inline-flex items-center gap-1 font-medium text-gold-ink">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" /> Dev room. Recording capture needs JaaS configured.
            </span>
          ) : recordingSince !== null ? (
            <span role="status" className="inline-flex items-center gap-1.5 font-semibold text-danger">
              <span className="h-2 w-2 rounded-full bg-danger" aria-hidden="true" />
              Recording {clock(now - recordingSince)}. Use End &amp; close when you finish.
            </span>
          ) : roomError || slowStart ? (
            <span role="alert" className="inline-flex items-center gap-1 font-medium text-danger">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              {roomError ?? 'Not recording yet. If you have joined, use Record in the room toolbar and choose file recording.'}
            </span>
          ) : (
            <span role="status" className="font-medium text-brand-muted">Not recording yet. It starts when you join the room.</span>
          )
        }
        size="3xl"
        dismissible={false}
        className="h-[calc(100dvh-1rem)] sm:h-[calc(100dvh-2rem)]"
        bodyClassName="flex flex-col"
        footer={
          <button
            type="button"
            onClick={endAndClose}
            disabled={ending}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-control bg-ink px-4 text-sm font-semibold text-white hover:bg-midnight disabled:opacity-60"
          >
            <X className="h-4 w-4" aria-hidden="true" />{' '}{ending ? 'Ending…' : 'End & close'}
          </button>
        }
      >
        {config && (
          <VideoRoom
            scriptSrc={config.scriptSrc}
            domain={config.domain}
            roomName={config.roomName}
            jwt={config.jwt}
            displayName={config.displayName}
            isHost
            autoRecord={config.configured}
            onApi={onApi}
            onRecordingChange={onRecordingChange}
            className="min-h-0 w-full flex-1 overflow-hidden rounded-control bg-black"
          />
        )}
      </Dialog>
    </div>
  )
}
