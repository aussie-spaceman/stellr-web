'use client'

import { useEffect, useRef, useState } from 'react'
import { Flag, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Dialog, fieldControlClass } from '@stellr/web-ui'

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
  const doneRef = useRef<HTMLButtonElement>(null)

  // The Report button is replaced by Close once sent; keep focus in the dialog.
  useEffect(() => {
    if (state !== 'idle') doneRef.current?.focus()
  }, [state])

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
        type="button"
        onClick={() => setOpen(true)}
        className="-m-3 inline-flex min-h-11 min-w-11 items-center justify-center text-brand-muted-soft hover:text-red-500"
        title="Report this resource"
        aria-label="Report this resource"
      >
        <Flag className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={
          <span className="inline-flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 shrink-0 text-danger" aria-hidden="true" />
            Report this resource
          </span>
        }
        size="md"
        dismissible={!busy}
        footer={
          state === 'idle' ? (
            <>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="min-h-11 rounded-control px-4 text-sm font-semibold text-content-secondary hover:bg-surface disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-control bg-danger px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                <Flag className="h-4 w-4" aria-hidden="true" />
                {busy ? 'Reporting…' : 'Report'}
              </button>
            </>
          ) : (
            <button
              ref={doneRef}
              type="button"
              onClick={() => setOpen(false)}
              className="min-h-11 rounded-control bg-ink px-4 text-sm font-semibold text-white"
            >
              Close
            </button>
          )
        }
      >
        {state === 'idle' ? (
          <>
            <fieldset className="space-y-1">
              <legend className="sr-only">Reason</legend>
              {REASONS.map((r) => (
                <label key={r.value} className="flex min-h-11 items-center gap-2 text-sm text-content-body">
                  <input
                    type="radio"
                    name={`flag-${binaryId}`}
                    value={r.value}
                    checked={reason === r.value}
                    onChange={() => setReason(r.value)}
                    className="accent-ink"
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
              aria-label="Add a note (optional)"
              className={`mt-3 ${fieldControlClass}`}
            />
          </>
        ) : (
          <p role="status" className="flex items-center gap-2 py-2 text-sm text-content-body">
            <CheckCircle2 className="h-4 w-4 text-enviro-green" aria-hidden="true" />
            {state === 'duplicate' ? 'You’ve already reported this.' : 'Reported — thank you.'}
          </p>
        )}
      </Dialog>
    </>
  )
}
