'use client'

import { useState } from 'react'
import { Dialog, fieldControlClass } from '@stellr/web-ui'

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
  const sending = state === 'sending'

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

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Request deletion"
        description={<>Ask an administrator to delete {label}. This is reviewed before anything is removed.</>}
        size="md"
        role="alertdialog"
        dismissible={!sending}
        footer={
          <>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={sending}
              className="min-h-11 rounded-control px-4 text-sm font-semibold text-content-secondary hover:bg-surface disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={sending}
              className="min-h-11 rounded-control bg-danger px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
            >
              {sending ? 'Sending…' : 'Send request'}
            </button>
          </>
        }
      >
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional)"
          aria-label="Reason (optional)"
          rows={3}
          className={fieldControlClass}
        />
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
      </Dialog>
    </>
  )
}
