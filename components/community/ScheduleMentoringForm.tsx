'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const DURATION_OPTIONS = [
  { label: '30 min', value: 30 },
  { label: '60 min', value: 60 },
  { label: '90 min', value: 90 },
  { label: '2 hrs', value: 120 },
]

// Mentor schedules a group session for one of their cohorts (FR-COM-11).
export function ScheduleMentoringForm({
  cohorts,
}: {
  cohorts: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [cohortId, setCohortId] = useState(cohorts[0]?.id ?? '')
  const [start, setStart] = useState('')
  const [durationMin, setDurationMin] = useState(60)
  const [busy, setBusy] = useState(false)

  if (cohorts.length === 0) return null

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone

  const schedule = async () => {
    if (!cohortId || !start) return
    setBusy(true)
    try {
      const res = await fetch('/api/community/host/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'schedule',
          cohortId,
          start: new Date(start).toISOString(),
          durationMin,
        }),
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
    <div className="space-y-2 rounded-md bg-brand-canvas p-3">
      <div className="flex flex-wrap items-end gap-2">
        <select
          value={cohortId}
          onChange={(e) => setCohortId(e.target.value)}
          className="rounded-md border border-brand-border px-2 py-1.5 text-sm"
        >
          {cohorts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <div className="flex flex-col gap-0.5">
          <input
            type="datetime-local"
            step={1800}
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="rounded-md border border-brand-border px-2 py-1.5 text-sm"
          />
          <span className="text-[11px] text-brand-muted-soft">{tz}</span>
        </div>
        <select
          value={durationMin}
          onChange={(e) => setDurationMin(Number(e.target.value))}
          className="rounded-md border border-brand-border px-2 py-1.5 text-sm"
        >
          {DURATION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          onClick={schedule}
          disabled={busy || !start}
          className="rounded-md bg-brand-blue-dark px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-blue-dark disabled:opacity-50"
        >
          {busy ? 'Scheduling…' : 'Schedule session'}
        </button>
      </div>
    </div>
  )
}
