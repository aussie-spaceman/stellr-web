'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog } from '@stellr/web-ui'
import { accessLabel, formatUsd, themeTile, type AccessKind, type CohortTheme } from '@/lib/mentoring-format'
import { MoneyBackGuarantee } from '@/components/ui/MoneyBackGuarantee'

export interface DiscoverCohort {
  id: string
  name: string
  theme: CohortTheme
  blurb: string | null
  mentorName: string | null
  startDate: string | null
  plannedSessions: number
  access: {
    kind: AccessKind
    priceCents: number | null
    creditCost: number
    canUseCredit: boolean
  }
}

function fmtStart(iso: string | null): string {
  if (!iso) return 'date TBC'
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(iso))
}

export function DiscoverGrid({ cohorts, creditsRemaining }: { cohorts: DiscoverCohort[]; creditsRemaining: number }) {
  const [active, setActive] = useState<DiscoverCohort | null>(null)

  if (cohorts.length === 0) {
    return (
      <div className="rounded-[14px] border border-dashed border-line bg-white py-12 text-center text-sm text-content-muted">
        No open cohorts right now. Check back soon.
      </div>
    )
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        {cohorts.map((c) => {
          const tile = themeTile(c.theme)
          const label = accessLabel(c.access.kind, { priceCents: c.access.priceCents, creditCost: c.access.creditCost })
          return (
            <div key={c.id} className="flex flex-col rounded-card border border-line bg-white p-5">
              <div className="flex items-start gap-3">
                <div
                  className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] font-display text-base font-bold text-white"
                  style={{ background: tile.gradient }}
                >
                  {c.name.charAt(0)}
                </div>
                <span className={`inline-flex items-center rounded-pill px-2.5 py-0.5 text-xs font-bold tracking-[0.04em] ${tile.chip}`}>
                  {tile.label}
                </span>
              </div>
              <h3 className="mt-3 font-display text-[19px] font-bold text-ink">{c.name}</h3>
              <p className="mt-0.5 text-[13.5px] text-content-secondary">
                {c.mentorName ?? 'Stellr mentor'} · starts {fmtStart(c.startDate)} · {c.plannedSessions} sessions
              </p>
              {c.blurb && <p className="mt-2 line-clamp-2 text-[13.5px] text-content-muted">{c.blurb}</p>}

              <div className="mt-auto flex items-center justify-between gap-3 pt-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-content-faint">Access</p>
                  <p className={`text-sm font-bold ${label.className}`}>{label.text}</p>
                </div>
                <button
                  onClick={() => setActive(c)}
                  className="rounded-[9px] bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-deep"
                >
                  Register
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {active && (
        <RegisterModal cohort={active} creditsRemaining={creditsRemaining} onClose={() => setActive(null)} />
      )}
    </>
  )
}

function RegisterModal({
  cohort,
  creditsRemaining,
  onClose,
}: {
  cohort: DiscoverCohort
  creditsRemaining: number
  onClose: () => void
}) {
  const router = useRouter()
  const tile = themeTile(cohort.theme)
  const isFree = cohort.access.kind === 'free'
  const canCredit = cohort.access.canUseCredit && cohort.access.kind !== 'free'
  const hasPaid = cohort.access.priceCents != null && cohort.access.priceCents > 0
  const [method, setMethod] = useState<'credit' | 'paid'>(canCredit ? 'credit' : 'paid')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const chosen = isFree ? 'free' : method
      const res = await fetch('/api/community/mentoring/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cohortId: cohort.id, method: chosen }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Could not register. Please try again.')
        setBusy(false)
        return
      }
      if (data.url) {
        window.location.href = data.url // Stripe checkout
        return
      }
      router.push(`/community/mentoring/${cohort.id}`)
    } catch {
      setError('Something went wrong. Please try again.')
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Register for this cohort"
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
            onClick={onClose}
            disabled={busy}
            className="min-h-11 rounded-control px-4 text-sm font-medium text-content-secondary hover:bg-surface disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || (!isFree && !canCredit && !hasPaid)}
            className="min-h-11 rounded-control bg-space-violet px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Working…' : isFree ? 'Confirm & join' : method === 'paid' ? 'Continue to payment' : 'Confirm & join'}
          </button>
        </>
      }
    >
      {/* Summary */}
      <div className="flex items-center gap-3 rounded-ds-card bg-surface p-3.5">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control font-display text-base font-bold text-white"
          style={{ background: tile.gradient }}
          aria-hidden="true"
        >
          {cohort.name.charAt(0)}
        </div>
        <div>
          <p className="font-display text-base font-bold text-ink">{cohort.name}</p>
          <p className="text-ds-meta text-content-secondary">
            {cohort.mentorName ?? 'Stellr mentor'} · {cohort.plannedSessions} sessions
          </p>
        </div>
      </div>

      {/* Pay choice */}
      {isFree ? (
        <p className="mt-4 rounded-control bg-enviro-green-bg px-4 py-3 text-sm font-medium text-enviro-green-text">
          Included with your membership — no payment needed.
        </p>
      ) : (
        <div className="mt-4 space-y-2">
          <p className="text-ds-meta font-semibold text-content-secondary">Choose how to pay</p>
          {canCredit && (
            <PayOption
              selected={method === 'credit'}
              onSelect={() => setMethod('credit')}
              title={`Use ${cohort.access.creditCost} session credit${cohort.access.creditCost === 1 ? '' : 's'}`}
              sub={`${creditsRemaining} session credit${creditsRemaining === 1 ? '' : 's'} remaining`}
            />
          )}
          {hasPaid && (
            <PayOption
              selected={method === 'paid'}
              onSelect={() => setMethod('paid')}
              title={`Pay ${formatUsd(cohort.access.priceCents ?? 0)} one-off`}
              sub="Secure payment via Stripe"
            />
          )}
          {hasPaid && method === 'paid' && <MoneyBackGuarantee variant="compact" className="pt-1" />}
          {!canCredit && !hasPaid && (
            <p className="rounded-control bg-surface px-4 py-3 text-sm text-content-muted">
              This cohort uses {cohort.access.creditCost} session credit{cohort.access.creditCost === 1 ? '' : 's'} and
              you have {creditsRemaining} remaining. Buy more sessions from the Discover page, or upgrade your membership.
            </p>
          )}
        </div>
      )}
    </Dialog>
  )
}

function PayOption({
  selected,
  onSelect,
  title,
  sub,
}: {
  selected: boolean
  onSelect: () => void
  title: string
  sub: string
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex w-full items-center gap-3 rounded-ds-card border px-4 py-3 text-left transition-colors ${
        selected ? 'border-space-violet bg-space-violet-bg' : 'border-line hover:border-content-faint'
      }`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${
          selected ? 'border-space-violet' : 'border-content-faint'
        }`}
      >
        {selected && <span className="h-2 w-2 rounded-full bg-space-violet" />}
      </span>
      <span>
        <span className="block text-sm font-semibold text-ink">{title}</span>
        <span className="block text-ds-meta text-content-muted">{sub}</span>
      </span>
    </button>
  )
}
