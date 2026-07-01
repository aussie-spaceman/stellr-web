'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const TEAL = '#0E8C99'

export function CoachingBookForm({
  requestId,
  isPaid,
  priceLabel,
}: {
  requestId: string
  isPaid: boolean
  priceLabel: string | null
}) {
  const router = useRouter()
  const [start, setStart] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!start) {
      setError('Please choose a date and time.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      // datetime-local yields local wall-time; convert to a real instant (ISO).
      const iso = new Date(start).toISOString()
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
      <div>
        <label htmlFor="start" className="block text-sm font-bold text-ink">
          Choose a time
        </label>
        <input
          id="start"
          type="datetime-local"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          required
          className="mt-2 w-full rounded-panel border border-line bg-white px-4 py-3 text-[15px] text-ink focus:border-[#0E8C99] focus:outline-none focus:ring-2 focus:ring-[#0E8C99]/20"
        />
        <p className="mt-1.5 text-[13px] text-content-muted">
          Pick a slot that fits your availability — your coach will confirm and share a join link.
        </p>
      </div>

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
