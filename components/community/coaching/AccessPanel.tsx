'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, X, Plus, CreditCard } from 'lucide-react'
import { formatUsd, tzAbbr } from '@/lib/mentoring-format'

export function AccessPanel({
  workshopId,
  coachName,
  included,
  remaining,
  extraCredits,
  tierName,
  periodEnd,
  sessionPriceCents,
  timezone,
}: {
  workshopId: string
  coachName: string | null
  included: number
  remaining: number
  extraCredits: number
  tierName: string | null
  periodEnd: string | null
  sessionPriceCents: number
  timezone: string
}) {
  const [buyOpen, setBuyOpen] = useState(false)
  const pct = included > 0 ? Math.round((remaining / included) * 100) : 0
  const tz = tzAbbr(timezone)

  return (
    <>
      <div className="grid gap-5 md:grid-cols-2">
        {/* Free sessions */}
        <div className="rounded-card border border-line bg-white p-5">
          <h2 className="font-display text-[15px] font-bold text-ink">Free sessions</h2>
          <p className="mt-3 font-display text-[34px] font-bold text-enviro-green-text">
            {remaining} <span className="text-[16px] font-semibold text-content-muted">of {included} remaining</span>
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-pill bg-[#EEF0F7]">
            <div className="h-full rounded-pill bg-enviro-green" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-3 text-[13px] text-content-muted">
            {tierName ? `Included with your ${tierName} membership.` : 'Free coaching sessions are included with eligible memberships.'}
            {periodEnd && (
              <> Resets {new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(periodEnd))}.</>
            )}
          </p>
          {extraCredits > 0 && (
            <p className="mt-1 text-[13px] font-semibold text-primary">+ {extraCredits} purchased session{extraCredits === 1 ? '' : 's'} available</p>
          )}
        </div>

        {/* Buy additional */}
        <div className="rounded-card border border-line bg-white p-5">
          <h2 className="font-display text-[15px] font-bold text-ink">Buy additional sessions</h2>
          <p className="mt-3 text-sm text-content-secondary">
            Out of free sessions? Buy more any time — {formatUsd(sessionPriceCents)} each, billed via Stripe in USD.
          </p>
          <button
            onClick={() => setBuyOpen(true)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-[9px] bg-space-violet px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#5B3FE0]"
          >
            <Plus className="h-4 w-4" /> Buy sessions
          </button>
        </div>
      </div>

      {/* Request a session time */}
      <RequestForm workshopId={workshopId} coachName={coachName} tz={tz} />

      {buyOpen && <BuyModal workshopId={workshopId} sessionPriceCents={sessionPriceCents} onClose={() => setBuyOpen(false)} />}
    </>
  )
}

function RequestForm({ workshopId, coachName, tz }: { workshopId: string; coachName: string | null; tz: string }) {
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/community/coaching/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workshopId, preferredDate: date || null, preferredTime: time || null, note: note || null }),
      })
      if (res.ok) {
        setDone(true)
        setDate(''); setTime(''); setNote('')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-card border border-line bg-white p-5">
      <h2 className="font-display text-[15px] font-bold text-ink">Request a session time</h2>
      <p className="mt-1 text-[13px] text-content-muted">
        Suggest a time and {coachName ?? 'your coach'} will confirm and schedule it. Times shown in {tz || 'CT'}.
      </p>
      {done ? (
        <div className="mt-4 flex items-center gap-2 rounded-[12px] bg-enviro-green-bg px-4 py-3 text-sm font-medium text-enviro-green-text">
          <Check className="h-4 w-4" /> Request sent to {coachName ?? 'your coach'}.
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Preferred date">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
            </Field>
            <Field label={`Preferred time (${tz || 'CT'})`}>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputCls} />
            </Field>
          </div>
          <Field label="Focus for the session (optional)">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="What would you like to work on?"
              className={`${inputCls} resize-none`}
            />
          </Field>
          <button
            onClick={submit}
            disabled={busy || (!date && !time && !note)}
            className="inline-flex items-center gap-1.5 rounded-[9px] bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#2C53C6] disabled:opacity-50"
          >
            {busy ? 'Sending…' : 'Send request to coach'}
          </button>
        </div>
      )}
    </div>
  )
}

function BuyModal({ workshopId, sessionPriceCents, onClose }: { workshopId: string; sessionPriceCents: number; onClose: () => void }) {
  const router = useRouter()
  const [qty, setQty] = useState<1 | 3>(1)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // 3-pack saves 10%.
  const total = qty === 3 ? Math.round(sessionPriceCents * 3 * 0.9) : sessionPriceCents

  const buy = async () => {
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/community/coaching/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: qty, workshopId }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.url) router.push(data.url as string)
      else setErr(data.error ?? 'Could not start checkout.')
    } catch {
      setErr('Could not start checkout.')
    } finally {
      setBusy(false)
    }
  }

  const Option = ({ value, label, sub }: { value: 1 | 3; label: string; sub?: string }) => (
    <button
      onClick={() => setQty(value)}
      className={`flex w-full items-center justify-between rounded-[12px] border px-4 py-3 text-left transition-colors ${qty === value ? 'border-space-violet bg-space-violet-bg' : 'border-line hover:border-space-violet/50'}`}
    >
      <div>
        <p className="font-semibold text-ink">{label}</p>
        {sub && <p className="text-[12.5px] text-enviro-green-text">{sub}</p>}
      </div>
      <span className="font-display text-[18px] font-bold text-ink">
        {value === 3 ? formatUsd(Math.round(sessionPriceCents * 3 * 0.9)) : formatUsd(sessionPriceCents)}
      </span>
    </button>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(14,19,48,.55)' }} onClick={onClose}>
      <div
        className="w-full max-w-[440px] rounded-[18px] bg-white p-6 shadow-[0_30px_70px_-20px_rgba(0,0,0,.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h3 className="font-display text-[20px] font-bold text-ink">Buy coaching sessions</h3>
          <button onClick={onClose} className="rounded-md p-1 text-content-faint hover:bg-surface" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-[13px] text-content-muted">Extra sessions never expire and stack on top of your free allowance.</p>
        <div className="mt-4 space-y-2.5">
          <Option value={1} label="1 session" />
          <Option value={3} label="3 sessions" sub="Save 10%" />
        </div>
        {err && <p className="mt-3 text-[13px] text-danger">{err}</p>}
        <button
          onClick={buy}
          disabled={busy}
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-[9px] bg-space-violet px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#5B3FE0] disabled:opacity-50"
        >
          <CreditCard className="h-4 w-4" /> {busy ? 'Starting…' : `Continue to payment · ${formatUsd(total)}`}
        </button>
        <p className="mt-2 text-center text-[12px] text-content-faint">Secured by Stripe · USD</p>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-semibold text-content-secondary">{label}</span>
      {children}
    </label>
  )
}

const inputCls = 'w-full rounded-[9px] border border-line px-3.5 py-2.5 text-sm text-content outline-none focus:border-space-violet'
