'use client'

import { useState } from 'react'
import { Flag, AlertTriangle, CheckCircle2 } from 'lucide-react'

const REASONS: { value: string; label: string }[] = [
  { value: 'inappropriate', label: 'Inappropriate or offensive' },
  { value: 'broken', label: 'Broken or won’t open' },
  { value: 'outdated', label: 'Out of date' },
  { value: 'duplicate', label: 'Duplicate' },
]

// Inline flag affordance for the catalogue rows (handover §4.1 "flag from anywhere
// the resource renders"). Opens a small modal with reason radios + optional note,
// posting to the shared moderation queue. Idempotent ("already reported").
export function ResourceFlagModal({ binaryId, containerRef }: { binaryId: string; containerRef: string }) {
  const [open, setOpen] = useState(false)
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

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-brand-muted-soft hover:text-red-500"
        title="Report this resource"
      >
        <Flag className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
            {state === 'idle' ? (
              <>
                <div className="mb-3 flex items-center gap-2 text-red-600">
                  <AlertTriangle className="h-5 w-5" />
                  <h3 className="font-heading text-lg text-brand-blue-dark">Report this resource</h3>
                </div>
                <fieldset className="space-y-2">
                  {REASONS.map((r) => (
                    <label key={r.value} className="flex items-center gap-2 text-sm text-brand-muted">
                      <input
                        type="radio"
                        name={`flag-${binaryId}`}
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
                  className="mt-3 w-full rounded-md border border-brand-border px-3 py-2 text-sm focus:border-brand-blue-dark focus:outline-none"
                />
                <div className="mt-4 flex items-center justify-end gap-3">
                  <button onClick={() => setOpen(false)} className="text-sm font-medium text-brand-muted-soft hover:text-brand-muted">
                    Cancel
                  </button>
                  <button
                    onClick={submit}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    <Flag className="h-4 w-4" />
                    {busy ? 'Reporting…' : 'Report'}
                  </button>
                </div>
              </>
            ) : (
              <div className="py-2">
                <p className="flex items-center gap-2 text-sm text-brand-muted">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  {state === 'duplicate' ? 'You’ve already reported this.' : 'Reported — thank you.'}
                </p>
                <div className="mt-4 text-right">
                  <button onClick={() => setOpen(false)} className="rounded-md bg-brand-blue-dark px-4 py-2 text-sm font-medium text-white">
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
