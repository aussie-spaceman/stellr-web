'use client'

import { useState } from 'react'

interface Props {
  /** One of the member-requestable entity types: 'event_participation' | 'school' | 'session'. */
  entity: 'event_participation' | 'school' | 'session'
  id: string
  /** Short description shown in the dialog, e.g. "this event activity". */
  label: string
  className?: string
}

// Member-facing control for the three deletion cases that require admin
// approval. Submits a request to /api/members/deletion-requests; the actual
// deletion happens later when an admin approves it in the Activity Review Log.
export function RequestDeletionButton({ entity, id, label, className }: Props) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setState('sending')
    setError(null)
    try {
      const res = await fetch('/api/members/deletion-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity, id, reason: reason || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not submit request')
      setState('sent')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit request')
      setState('error')
    }
  }

  if (state === 'sent') {
    return <span className="text-xs text-green-600">Sent for admin approval</span>
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={className ?? 'text-xs text-brand-muted-soft hover:text-red-500'}
      >
        Request deletion
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => state !== 'sending' && setOpen(false)}>
          <div className="bg-white rounded-xl border border-brand-border shadow-xl max-w-md w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-brand-blue-dark">Request deletion</h2>
            <p className="text-sm text-brand-muted">
              Ask an administrator to delete {label}. This is reviewed before anything is removed.
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (optional)"
              rows={3}
              className="w-full border border-brand-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue"
            />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex items-center justify-end gap-3">
              <button onClick={() => setOpen(false)} className="text-sm text-brand-muted-soft hover:text-brand-muted px-3 py-1.5">Cancel</button>
              <button
                onClick={submit}
                disabled={state === 'sending'}
                className="bg-brand-blue text-white text-sm font-medium px-4 py-1.5 rounded-lg hover:bg-brand-blue-dark disabled:opacity-50"
              >
                {state === 'sending' ? 'Sending…' : 'Send request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
