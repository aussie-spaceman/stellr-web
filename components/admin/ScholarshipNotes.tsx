'use client'

import { useState } from 'react'

// Reviewer notes on a scholarship application — staff-only, never emailed.
export function ScholarshipNotes({ id, initial }: { id: string; initial: string }) {
  const [value, setValue] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle')

  async function save() {
    if (value === saved) return
    setState('saving')
    const res = await fetch(`/api/admin/scholarships/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminNotes: value }),
    }).catch(() => null)
    if (res?.ok) {
      setSaved(value)
      setState('idle')
    } else setState('error')
  }

  return (
    <div>
      <label htmlFor="sch-notes" className="block text-sm text-content-body mb-1">Reviewer notes (staff only)</label>
      <textarea
        id="sch-notes"
        rows={3}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        className="w-full rounded-control border border-line px-3 py-2 text-sm text-ink"
      />
      <p className="text-xs text-content-body h-4">
        {state === 'saving' ? 'Saving…' : state === 'error' ? 'Couldn’t save — try again.' : value !== saved ? 'Saves when you click away.' : ''}
      </p>
    </div>
  )
}
