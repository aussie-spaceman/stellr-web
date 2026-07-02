'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

const TEAL = '#0E8C99'

/** Coach availability window: weekday (0=Sun..6=Sat, matching JS getDay) + minutes-of-day. */
export interface AvailabilityWindow {
  weekday: number
  startMinute: number
  endMinute: number
}

interface Slot {
  iso: string
  dayKey: string
  dayLabel: string
  timeLabel: string
}

const HORIZON_DAYS = 21
const MAX_SLOTS = 18
const MIN_SESSION_MIN = 30

// Build concrete upcoming slots from the coach's weekly windows, in the member's
// local timezone (same wall-clock semantics as the free datetime picker). One slot
// per hour within each window, only in the future, capped for a tidy list.
function buildSlots(windows: AvailabilityWindow[]): Slot[] {
  if (windows.length === 0) return []
  const now = Date.now()
  const slots: Slot[] = []
  const base = new Date()
  base.setHours(0, 0, 0, 0)

  for (let d = 0; d < HORIZON_DAYS && slots.length < MAX_SLOTS; d++) {
    const day = new Date(base)
    day.setDate(base.getDate() + d)
    const weekday = day.getDay()
    for (const w of windows.filter((x) => x.weekday === weekday)) {
      for (let m = w.startMinute; m <= w.endMinute - MIN_SESSION_MIN; m += 60) {
        const slot = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(m / 60), m % 60, 0, 0)
        if (slot.getTime() <= now) continue
        slots.push({
          iso: slot.toISOString(),
          dayKey: day.toDateString(),
          dayLabel: slot.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
          timeLabel: slot.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
        })
        if (slots.length >= MAX_SLOTS) break
      }
      if (slots.length >= MAX_SLOTS) break
    }
  }
  return slots
}

export function CoachingBookForm({
  requestId,
  isPaid,
  priceLabel,
  windows = [],
}: {
  requestId: string
  isPaid: boolean
  priceLabel: string | null
  windows?: AvailabilityWindow[]
}) {
  const router = useRouter()
  const slots = useMemo(() => buildSlots(windows), [windows])
  const hasSlots = slots.length > 0

  const [selectedIso, setSelectedIso] = useState('') // chosen availability slot
  const [customStart, setCustomStart] = useState('') // free datetime-local fallback
  const [customOpen, setCustomOpen] = useState(!hasSlots)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const grouped = useMemo(() => {
    const map = new Map<string, Slot[]>()
    for (const s of slots) {
      const arr = map.get(s.dayKey) ?? []
      arr.push(s)
      map.set(s.dayKey, arr)
    }
    return [...map.values()]
  }, [slots])

  const pickSlot = (iso: string) => {
    setSelectedIso(iso)
    setCustomStart('')
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    // A chosen slot is already an ISO instant; a custom local time is converted here.
    const iso = selectedIso || (customStart ? new Date(customStart).toISOString() : '')
    if (!iso) {
      setError('Please choose a time.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/community/coaching/requests/${requestId}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start: iso }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Could not book. Please try again.')
        setBusy(false)
        return
      }
      if (data.url) {
        window.location.href = data.url // Stripe checkout
        return
      }
      router.push(data.redirect ?? `/community/coaching/request/${requestId}`)
    } catch {
      setError('Something went wrong. Please try again.')
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {hasSlots && (
        <div>
          <span className="block text-sm font-bold text-ink">Choose a time your coach is available</span>
          <p className="mt-0.5 text-[12.5px] text-content-muted">Times shown in your local timezone.</p>
          <div className="mt-3 space-y-3">
            {grouped.map((daySlots) => (
              <div key={daySlots[0].dayKey}>
                <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-content-faint">{daySlots[0].dayLabel}</p>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {daySlots.map((s) => {
                    const active = selectedIso === s.iso
                    return (
                      <button
                        type="button"
                        key={s.iso}
                        onClick={() => pickSlot(s.iso)}
                        aria-pressed={active}
                        className={`rounded-[9px] border px-3.5 py-2 text-sm font-semibold transition-colors ${
                          active ? 'border-[#0E8C99] bg-[#E3F6F8] text-[#0E8C99]' : 'border-line bg-white text-content-secondary hover:border-content-faint'
                        }`}
                      >
                        {s.timeLabel}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setCustomOpen((v) => !v)}
            className="mt-3 text-[13px] font-semibold text-[#0E8C99] hover:underline"
          >
            {customOpen ? 'Hide custom time' : 'Prefer a different time?'}
          </button>
        </div>
      )}

      {(customOpen || !hasSlots) && (
        <div>
          <label htmlFor="start" className="block text-sm font-bold text-ink">
            {hasSlots ? 'Or pick another time' : 'Choose a time'}
          </label>
          <input
            id="start"
            type="datetime-local"
            value={customStart}
            onChange={(e) => {
              setCustomStart(e.target.value)
              setSelectedIso('')
            }}
            className="mt-2 w-full rounded-panel border border-line bg-white px-4 py-3 text-[15px] text-ink focus:border-[#0E8C99] focus:outline-none focus:ring-2 focus:ring-[#0E8C99]/20"
          />
          <p className="mt-1.5 text-[13px] text-content-muted">
            Pick a slot that fits your availability — your coach will confirm and share a join link.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between rounded-panel bg-surface px-4 py-3">
        <span className="text-sm font-semibold text-content-secondary">Cost</span>
        <span className="text-sm font-bold text-ink">
          {isPaid ? (priceLabel ?? 'Shown at checkout') : 'Included — no payment'}
        </span>
      </div>

      {error && <p className="text-sm font-medium text-danger">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="inline-flex w-full items-center justify-center gap-2 rounded-control px-6 py-3 text-sm font-semibold text-white transition-colors disabled:opacity-50"
        style={{ background: TEAL }}
      >
        {busy ? 'Working…' : isPaid ? 'Continue to payment' : 'Confirm booking'}
      </button>
    </form>
  )
}
