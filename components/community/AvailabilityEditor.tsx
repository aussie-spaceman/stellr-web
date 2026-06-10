'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Plus } from 'lucide-react'

export interface Window {
  id: string
  weekday: number
  start_minute: number
  end_minute: number
  session_type: 'coaching' | 'mentoring' | 'both'
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function fmt(m: number): string {
  return `${Math.floor(m / 60)
    .toString()
    .padStart(2, '0')}:${(m % 60).toString().padStart(2, '0')}`
}
function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

// Coach/mentor weekly availability editor (FR-COM-11/12).
export function AvailabilityEditor({ windows }: { windows: Window[] }) {
  const router = useRouter()
  const [weekday, setWeekday] = useState(1)
  const [from, setFrom] = useState('09:00')
  const [to, setTo] = useState('17:00')
  const [busy, setBusy] = useState(false)

  const add = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/community/host/availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weekday,
          startMinute: toMinutes(from),
          endMinute: toMinutes(to),
        }),
      })
      if (res.ok) router.refresh()
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setBusy(true)
    try {
      const res = await fetch('/api/community/host/availability', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (res.ok) router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {windows.map((w) => (
          <li
            key={w.id}
            className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-2 text-sm"
          >
            <span>
              {DAYS[w.weekday]} · {fmt(w.start_minute)}–{fmt(w.end_minute)}
            </span>
            <button onClick={() => remove(w.id)} disabled={busy} className="text-gray-400 hover:text-red-600">
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
        {windows.length === 0 && <li className="text-sm text-gray-400">No availability set.</li>}
      </ul>

      <div className="flex flex-wrap items-end gap-2 rounded-md bg-gray-50 p-3">
        <select
          value={weekday}
          onChange={(e) => setWeekday(Number(e.target.value))}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        >
          {DAYS.map((d, i) => (
            <option key={d} value={i}>
              {d}
            </option>
          ))}
        </select>
        <input
          type="time"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        />
        <span className="text-sm text-gray-400">to</span>
        <input
          type="time"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
        />
        <button
          onClick={add}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>
    </div>
  )
}
