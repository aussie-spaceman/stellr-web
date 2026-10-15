'use client'

import { useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { Dialog } from '@stellr/web-ui'
import { formatUsd, COHORT_SESSION_PACKS } from '@/lib/mentoring-format'

// "Buy more sessions" entry point + modal on the Discover screen. Mentoring is
// accounted PER SESSION (a cohort enrollment draws its planned 4/6/8 sessions from
// the ledger — migration 106), so this sells SESSION credits, priced per session.
// Posts to the top-up checkout; the Stripe webhook (type 'mentoring_topup') grants
// the purchased sessions on success.
export function TopUpCredits({ unitPriceCents }: { unitPriceCents: number }) {
  const [open, setOpen] = useState(false)
  const [qty, setQty] = useState<number>(COHORT_SESSION_PACKS[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const buy = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/community/mentoring/topup', {
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
        <Plus className="h-3.5 w-3.5" /> Buy more sessions
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Buy mentoring sessions"
        description={
          <>
            Registering for a cohort uses its session count (4, 6 or 8 sessions). Sessions are{' '}
            {formatUsd(unitPriceCents)} each, stack with your membership allowance and never expire.
          </>
        }
        size="md"
        dismissible={!busy}
        footer={
          <>
            {error && (
              <p role="alert" className="w-full text-sm font-medium text-danger">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
              className="min-h-11 rounded-control px-4 text-sm font-medium text-content-secondary hover:bg-surface disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={buy}
              disabled={busy}
              className="min-h-11 rounded-control bg-space-violet px-5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Working…' : 'Continue to payment'}
            </button>
          </>
        }
      >
        {/* Quick picks matching the cohort formats */}
        <div className="grid grid-cols-3 gap-2">
          {COHORT_SESSION_PACKS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setQty(n)}
              aria-pressed={qty === n}
              className={`rounded-ds-card border px-3 py-2.5 text-center transition-colors ${qty === n ? 'border-space-violet bg-space-violet-bg' : 'border-line hover:border-space-violet/50'}`}
            >
              <span className="block font-display text-ds-h3 font-bold text-ink">{n}</span>
              <span className="block text-xs text-content-muted">sessions</span>
            </button>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between rounded-ds-card bg-surface p-4">
          <span className="text-sm font-medium text-content-body">Sessions</span>
          <div className="inline-flex items-center rounded-control border border-line-strong bg-white">
            <button
              type="button"
              onClick={() => setQty((n) => Math.max(1, n - 1))}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-control text-content-secondary hover:bg-surface"
              aria-label="Fewer"
            >
              <Minus className="h-4 w-4" aria-hidden="true" />
            </button>
            <span className="w-8 text-center font-display text-lg font-bold text-ink" aria-live="polite">
              {qty}
            </span>
            <button
              type="button"
              onClick={() => setQty((n) => Math.min(20, n + 1))}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-control text-content-secondary hover:bg-surface"
              aria-label="More"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="text-content-muted">Total</span>
          <span className="font-display text-ds-h3 font-bold text-ink">{formatUsd(unitPriceCents * qty)}</span>
        </div>
      </Dialog>
    </>
  )
}
