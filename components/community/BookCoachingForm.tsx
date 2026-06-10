'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export interface Coach {
  id: string
  name: string
  bio: string | null
  availability: { weekday: number; start_minute: number; end_minute: number }[]
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function fmtMinutes(m: number): string {
  const h = Math.floor(m / 60)
  const mm = (m % 60).toString().padStart(2, '0')
  return `${h.toString().padStart(2, '0')}:${mm}`
}

// Pick a coach + date/time and book (FR-COM-12). Availability is shown for
// reference; the server re-checks entitlement before confirming.
export function BookCoachingForm({ coaches, hasRemaining }: { coaches: Coach[]; hasRemaining: boolean }) {
  const router = useRouter()
  const [coachId, setCoachId] = useState(coaches[0]?.id ?? '')
  const [start, setStart] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const coach = coaches.find((c) => c.id === coachId)

  const book = async () => {
    setError(null)
    if (!coachId || !start) {
      setError('Choose a coach and a time.')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/community/sessions/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId: coachId, start: new Date(start).toISOString() }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Could not book.')
        return
      }
      setStart('')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  if (coaches.length === 0) {
    return <p className="text-sm text-gray-400">No coaches are available right now.</p>
  }

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-700">Book a coaching session</h3>
      {!hasRemaining && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
          You have no included sessions remaining. Booking will require purchasing an extra session.
        </p>
      )}
      <select
        value={coachId}
        onChange={(e) => setCoachId(e.target.value)}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
      >
        {coaches.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      {coach && (
        <div className="text-xs text-gray-500">
          {coach.bio && <p className="mb-1">{coach.bio}</p>}
          {coach.availability.length > 0 ? (
            <p>
              Usually available:{' '}
              {coach.availability
                .map((a) => `${DAYS[a.weekday]} ${fmtMinutes(a.start_minute)}–${fmtMinutes(a.end_minute)}`)
                .join(', ')}
            </p>
          ) : (
            <p>No set availability — request a time and the coach will confirm.</p>
          )}
        </div>
      )}

      <input
        type="datetime-local"
        value={start}
        onChange={(e) => setStart(e.target.value)}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button
        onClick={book}
        disabled={busy}
        className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {busy ? 'Booking…' : 'Book session'}
      </button>
    </div>
  )
}
