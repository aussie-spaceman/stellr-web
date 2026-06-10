'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

// Mentor schedules a group session for one of their cohorts (FR-COM-11).
export function ScheduleMentoringForm({
  cohorts,
}: {
  cohorts: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [cohortId, setCohortId] = useState(cohorts[0]?.id ?? '')
  const [start, setStart] = useState('')
  const [busy, setBusy] = useState(false)

  if (cohorts.length === 0) return null

  const schedule = async () => {
    if (!cohortId || !start) return
    setBusy(true)
    try {
      const res = await fetch('/api/community/host/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'schedule', cohortId, start: new Date(start).toISOString() }),
      })
      if (res.ok) {
        setStart('')
        router.refresh()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md bg-gray-50 p-3">
      <select
        value={cohortId}
        onChange={(e) => setCohortId(e.target.value)}
        className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
      >
        {cohorts.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <input
        type="datetime-local"
        value={start}
        onChange={(e) => setStart(e.target.value)}
        className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
      />
      <button
        onClick={schedule}
        disabled={busy}
        className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {busy ? 'Scheduling…' : 'Schedule session'}
      </button>
    </div>
  )
}
