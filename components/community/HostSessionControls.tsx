'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Post-session controls for a coach/mentor (FR-COM-11/12): mark complete/cancel,
// save notes, and set close-out actions for a member.
export function HostSessionControls({
  sessionId,
  memberId,
  initialNotes,
  status,
}: {
  sessionId: string
  memberId: string | null
  initialNotes: string | null
  status: string
}) {
  const router = useRouter()
  const [notes, setNotes] = useState(initialNotes ?? '')
  const [actionsText, setActionsText] = useState('')
  const [busy, setBusy] = useState(false)

  const call = async (payload: Record<string, unknown>) => {
    setBusy(true)
    try {
      const res = await fetch('/api/community/host/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.ok) router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 border-t border-brand-hairline pt-3">
      <div className="flex flex-wrap gap-2">
        {status !== 'completed' && (
          <button
            onClick={() => call({ action: 'respond', sessionId, status: 'completed' })}
            disabled={busy}
            className="rounded-md border border-green-300 bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-50"
          >
            Mark complete
          </button>
        )}
        {status !== 'cancelled' && (
          <button
            onClick={() => call({ action: 'respond', sessionId, status: 'cancelled' })}
            disabled={busy}
            className="rounded-md border border-brand-border px-2.5 py-1 text-xs font-medium text-brand-muted hover:bg-brand-hairline disabled:opacity-50"
          >
            Cancel
          </button>
        )}
      </div>

      <div>
        <label className="text-xs font-medium text-brand-muted-soft">Session notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-md border border-brand-border px-3 py-2 text-sm"
        />
        <button
          onClick={() => call({ action: 'notes', sessionId, notes })}
          disabled={busy}
          className="mt-1 rounded-md border border-brand-border px-2.5 py-1 text-xs font-medium text-brand-muted hover:bg-brand-hairline disabled:opacity-50"
        >
          Save notes
        </button>
      </div>

      {memberId && (
        <div>
          <label className="text-xs font-medium text-brand-muted-soft">
            Set actions (one per line)
          </label>
          <textarea
            value={actionsText}
            onChange={(e) => setActionsText(e.target.value)}
            rows={2}
            placeholder="Watch the recording&#10;Draft your project brief"
            className="mt-1 w-full rounded-md border border-brand-border px-3 py-2 text-sm"
          />
          <button
            onClick={() => {
              const titles = actionsText.split('\n').map((t) => t.trim()).filter(Boolean)
              if (titles.length) call({ action: 'actions', sessionId, memberId, titles })
              setActionsText('')
            }}
            disabled={busy}
            className="mt-1 rounded-md border border-brand-border px-2.5 py-1 text-xs font-medium text-brand-muted hover:bg-brand-hairline disabled:opacity-50"
          >
            Assign actions
          </button>
        </div>
      )}
    </div>
  )
}
