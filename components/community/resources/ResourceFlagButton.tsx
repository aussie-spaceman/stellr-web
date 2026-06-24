'use client'

import { useState } from 'react'
import { Flag, CheckCircle2 } from 'lucide-react'

const REASONS: { value: string; label: string }[] = [
  { value: 'inappropriate', label: 'Inappropriate or offensive' },
  { value: 'broken', label: 'Broken or won’t open' },
  { value: 'outdated', label: 'Out of date' },
  { value: 'duplicate', label: 'Duplicate' },
]

// Resource flag (handover §4.3). Reason radios + optional note → the SHARED chat
// moderation queue (community_flags). Idempotent: re-flagging shows "already
// reported". Captures the container the resource was viewed in for context.
export function ResourceFlagButton({ binaryId, containerRef }: { binaryId: string; containerRef: string }) {
  const [reason, setReason] = useState('inappropriate')
  const [note, setNote] = useState('')
  const [state, setState] = useState<'idle' | 'done' | 'duplicate'>('idle')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    const res = await fetch('/api/community/flag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType: 'resource', contentId: binaryId, reason, note, containerRef }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (res.ok) setState(json.duplicate ? 'duplicate' : 'done')
  }

  if (state !== 'idle') {
    return (
      <p className="flex items-center gap-2 text-sm text-brand-muted">
        <CheckCircle2 className="h-4 w-4 text-green-600" />
        {state === 'duplicate' ? 'You’ve already reported this.' : 'Reported — thank you. An admin will review it.'}
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <fieldset className="space-y-2">
        {REASONS.map((r) => (
          <label key={r.value} className="flex items-center gap-2 text-sm text-brand-muted">
            <input
              type="radio"
              name="flag-reason"
              value={r.value}
              checked={reason === r.value}
              onChange={() => setReason(r.value)}
              className="accent-brand-blue-dark"
            />
            {r.label}
          </label>
        ))}
      </fieldset>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={700}
        placeholder="Add a note (optional)"
        className="w-full rounded-md border border-brand-border px-3 py-2 text-sm focus:border-brand-blue-dark focus:outline-none"
      />
      <button
        onClick={submit}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
      >
        <Flag className="h-4 w-4" />
        {busy ? 'Reporting…' : 'Report this resource'}
      </button>
    </div>
  )
}
