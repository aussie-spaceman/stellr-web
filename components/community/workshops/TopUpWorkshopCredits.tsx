'use client'

import { useState } from 'react'
import { Minus, Plus, X } from 'lucide-react'
import { formatUsd } from '@/lib/mentoring-format'

// "Buy more workshop credits" entry point + modal on the workshops Discover
// screen. Posts to the workshop top-up checkout; the Stripe webhook
// (type 'workshop_topup') grants the credits on success.
export function TopUpWorkshopCredits({ unitPriceCents }: { unitPriceCents: number }) {
  const [open, setOpen] = useState(false)
  const [qty, setQty] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const buy = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/community/workshops/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: qty }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.url) {
        setError(data.error ?? 'Could not start checkout.')
        setBusy(false)
        return
      }
      window.location.href = data.url
    } catch {
      setError('Something went wrong.')
      setBusy(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-pill border border-space-violet/40 px-3.5 py-1.5 text-[13px] font-semibold text-space-violet transition-colors hover:bg-space-violet-bg"
      >
        <Plus className="h-3.5 w-3.5" /> Buy more credits
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(14,19,48,.55)' }} onClick={() => setOpen(false)}>
          <div className="w-full max-w-[420px] rounded-[18px] bg-white p-6 shadow-[0_30px_70px_-20px_rgba(0,0,0,.5)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <h2 className="font-display text-[20px] font-bold text-ink">Buy workshop credits</h2>
              <button onClick={() => setOpen(false)} className="rounded-md p-1 text-content-faint hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <p className="mt-2 text-[13.5px] text-content-secondary">
              Each credit registers you for one workshop and never expires. {formatUsd(unitPriceCents)} per credit.
            </p>

            <div className="mt-4 flex items-center justify-between rounded-[12px] bg-surface p-4">
              <span className="text-sm font-medium text-content-body">Credits</span>
              <div className="inline-flex items-center gap-3 rounded-[9px] border border-line bg-white px-2 py-1.5">
                <button onClick={() => setQty((n) => Math.max(1, n - 1))} className="rounded-md p-1.5 text-content-secondary hover:bg-surface" aria-label="Fewer"><Minus className="h-4 w-4" /></button>
                <span className="w-6 text-center font-display text-lg font-bold text-ink">{qty}</span>
                <button onClick={() => setQty((n) => Math.min(20, n + 1))} className="rounded-md p-1.5 text-content-secondary hover:bg-surface" aria-label="More"><Plus className="h-4 w-4" /></button>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-content-muted">Total</span>
              <span className="font-display text-[18px] font-bold text-ink">{formatUsd(unitPriceCents * qty)}</span>
            </div>

            {error && <p className="mt-3 text-sm font-medium text-danger">{error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="rounded-[9px] px-4 py-2.5 text-sm font-medium text-content-secondary hover:bg-surface">Cancel</button>
              <button onClick={buy} disabled={busy} className="rounded-[9px] bg-space-violet px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#5B3FE0] disabled:opacity-50">
                {busy ? 'Working…' : 'Continue to payment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
