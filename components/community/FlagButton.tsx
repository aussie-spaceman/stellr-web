'use client'

import { useState } from 'react'
import { Flag } from 'lucide-react'

interface Props {
  contentType: 'post' | 'comment'
  contentId: string
}

// Inline flag button for posts and comments (FR-COM-07).
// Sends a report to the admin moderation queue.
export function FlagButton({ contentType, contentId }: Props) {
  const [state, setState] = useState<'idle' | 'open' | 'done'>('idle')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    setSubmitting(true)
    await fetch('/api/community/flag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType, contentId, reason }),
    })
    setState('done')
    setSubmitting(false)
  }

  if (state === 'done') {
    return <span className="text-xs text-brand-muted-soft">Reported</span>
  }

  if (state === 'open') {
    return (
      <div className="mt-2 space-y-2">
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Optional: describe the issue"
          rows={2}
          maxLength={500}
          className="w-full rounded-md border border-brand-border px-2 py-1.5 text-xs focus:border-brand-border focus:outline-none"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={submit}
            disabled={submitting}
            className="rounded bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {submitting ? 'Sending…' : 'Report'}
          </button>
          <button
            onClick={() => setState('idle')}
            className="text-xs text-brand-muted-soft hover:text-brand-muted"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <button
      onClick={() => setState('open')}
      className="flex items-center gap-1 text-xs text-brand-muted-soft hover:text-red-500"
      title="Report this content"
    >
      <Flag className="h-3 w-3" />
      Report
    </button>
  )
}
