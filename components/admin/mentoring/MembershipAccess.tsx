'use client'

import { useId, useState } from 'react'
import { Dialog } from '@stellr/web-ui'
import { formatUsd } from '@/lib/mentoring-format'

interface TierRow {
  id: string
  name: string
  monthlyPriceCents: number | null
  includesFreeMentoring: boolean
  creditsGrant: number
  workshopCreditsGrant: number
}
interface CohortRow {
  id: string
  name: string
  freeForTierIds: string[]
  oneOffPriceCents: number | null
  creditCost: number
}

async function adminPost(payload: Record<string, unknown>) {
  const res = await fetch('/api/admin/community/mentoring', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return res.ok
}

export function MembershipAccess({ tiers: initialTiers, cohorts: initialCohorts }: { tiers: TierRow[]; cohorts: CohortRow[] }) {
  const [tiers, setTiers] = useState(initialTiers)
  const [cohorts, setCohorts] = useState(initialCohorts)
  const [editing, setEditing] = useState<CohortRow | null>(null)

  const toggleFree = async (id: string, value: boolean) => {
    setTiers((p) => p.map((t) => (t.id === id ? { ...t, includesFreeMentoring: value } : t)))
    await adminPost({ action: 'updateTier', tierId: id, includesFreeMentoring: value })
  }
  const setCredits = async (id: string, value: number) => {
    setTiers((p) => p.map((t) => (t.id === id ? { ...t, creditsGrant: value } : t)))
    await adminPost({ action: 'updateTier', tierId: id, creditsGrant: value })
  }
  const setWorkshopCredits = async (id: string, value: number) => {
    setTiers((p) => p.map((t) => (t.id === id ? { ...t, workshopCreditsGrant: value } : t)))
    await adminPost({ action: 'updateTier', tierId: id, workshopCreditsGrant: value })
  }

  return (
    <div className="space-y-8 pt-4">
      {/* Tiers */}
      <section className="rounded-card border border-line bg-white p-5">
        <h2 className="font-display text-[17px] font-bold text-ink">Membership tiers</h2>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="border-b border-line-light text-left text-[12px] font-semibold uppercase tracking-[0.05em] text-content-faint">
              <th className="py-2.5">Tier</th>
              <th className="py-2.5">Price / mo</th>
              <th className="py-2.5">Mentoring</th>
              <th className="py-2.5">Cohort credits / yr</th>
              <th className="py-2.5">Workshop credits / yr</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((t) => (
              <tr key={t.id} className="border-b border-line-light last:border-0">
                <td className="py-3 font-medium text-ink">{t.name}</td>
                <td className="py-3 text-content-secondary">{t.monthlyPriceCents != null ? formatUsd(t.monthlyPriceCents) : '—'}</td>
                <td className="py-3">
                  <button
                    onClick={() => toggleFree(t.id, !t.includesFreeMentoring)}
                    className={`rounded-pill px-2.5 py-1 text-[12px] font-semibold ${t.includesFreeMentoring ? 'bg-enviro-green-bg text-enviro-green-text' : 'bg-surface text-content-muted'}`}
                  >
                    {t.includesFreeMentoring ? 'Free mentoring' : 'No mentoring access'}
                  </button>
                </td>
                <td className="py-3">
                  <input
                    type="number"
                    min={0}
                    value={t.creditsGrant}
                    onChange={(e) => setCredits(t.id, Math.max(0, Number(e.target.value) || 0))}
                    aria-label={`Cohort credits per year, ${t.name}`}
                    className="w-20 rounded-control border border-line-strong px-2.5 py-1.5 text-input mouse:text-sm"
                  />
                </td>
                <td className="py-3">
                  <input
                    type="number"
                    min={0}
                    value={t.workshopCreditsGrant}
                    onChange={(e) => setWorkshopCredits(t.id, Math.max(0, Number(e.target.value) || 0))}
                    aria-label={`Workshop credits per year, ${t.name}`}
                    className="w-20 rounded-control border border-line-strong px-2.5 py-1.5 text-input mouse:text-sm"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-[12px] text-content-faint">
          The 9 buyable tiers. Toggle free mentoring per tier; credits roll over. 1 cohort credit = 1 cohort enrollment; 1 workshop credit = 1 workshop enrollment.
        </p>
      </section>

      {/* Cohort access */}
      <section className="rounded-card border border-line bg-white p-5">
        <h2 className="font-display text-[17px] font-bold text-ink">Cohort access</h2>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="border-b border-line-light text-left text-[12px] font-semibold uppercase tracking-[0.05em] text-content-faint">
              <th className="py-2.5">Cohort</th>
              <th className="py-2.5">Free for tiers</th>
              <th className="py-2.5">One-off price</th>
              <th className="py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {cohorts.length === 0 ? (
              <tr><td colSpan={4} className="py-8 text-center text-content-muted">No active cohorts.</td></tr>
            ) : (
              cohorts.map((c) => (
                <tr key={c.id} className="border-b border-line-light last:border-0">
                  <td className="py-3 font-medium text-ink">{c.name}</td>
                  <td className="py-3 text-content-secondary">
                    {c.freeForTierIds.length === 0 ? '—' : `${c.freeForTierIds.length} tier${c.freeForTierIds.length === 1 ? '' : 's'}`}
                  </td>
                  <td className="py-3 text-content-secondary">{c.oneOffPriceCents != null ? formatUsd(c.oneOffPriceCents) : '—'}</td>
                  <td className="py-3 text-right">
                    <button onClick={() => setEditing(c)} className="text-[13px] font-semibold text-primary hover:underline">Edit</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {editing && (
        <EditAccessModal
          cohort={editing}
          tiers={tiers}
          onClose={() => setEditing(null)}
          onSaved={(next) => {
            setCohorts((p) => p.map((c) => (c.id === next.id ? next : c)))
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function EditAccessModal({
  cohort,
  tiers,
  onClose,
  onSaved,
}: {
  cohort: CohortRow
  tiers: TierRow[]
  onClose: () => void
  onSaved: (next: CohortRow) => void
}) {
  const [freeTiers, setFreeTiers] = useState<string[]>(cohort.freeForTierIds)
  const [price, setPrice] = useState(cohort.oneOffPriceCents != null ? String(cohort.oneOffPriceCents / 100) : '')
  const [busy, setBusy] = useState(false)
  const tiersLabelId = useId()
  const priceId = useId()

  const save = async () => {
    setBusy(true)
    const oneOffPriceCents = price ? Math.round(Number(price) * 100) : null
    const ok = await adminPost({ action: 'updateCohort', cohortId: cohort.id, freeForTierIds: freeTiers, oneOffPriceCents })
    if (ok) onSaved({ ...cohort, freeForTierIds: freeTiers, oneOffPriceCents })
    else setBusy(false)
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Edit access · ${cohort.name}`}
      size="lg"
      dismissible={!busy}
      bodyClassName="space-y-4"
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className="min-h-11 rounded-control px-4 text-sm font-medium text-content-secondary hover:bg-surface disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={save} disabled={busy} className="min-h-11 rounded-control bg-space-violet px-5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div role="group" aria-labelledby={tiersLabelId}>
        <p id={tiersLabelId} className="mb-1.5 text-xs font-semibold text-content-secondary">Free for membership tiers</p>
        <div className="flex flex-wrap gap-1.5">
          {tiers.map((t) => {
            const on = freeTiers.includes(t.id)
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={on}
                onClick={() => setFreeTiers((p) => (on ? p.filter((x) => x !== t.id) : [...p, t.id]))}
                className={`rounded-pill px-2.5 py-1 text-xs font-medium ${on ? 'bg-space-violet text-white' : 'bg-surface text-content-secondary'}`}
              >
                {t.name}
              </button>
            )
          })}
        </div>
      </div>
      <div>
        <label htmlFor={priceId} className="mb-1.5 block text-xs font-semibold text-content-secondary">One-off price (USD)</label>
        <div className="inline-flex min-h-11 items-center gap-1.5 rounded-control border border-line-strong px-3 focus-within:border-space-violet">
          <span className="text-sm text-content-muted" aria-hidden="true">$</span>
          <input
            id={priceId}
            value={price}
            onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder="0"
            inputMode="decimal"
            aria-describedby={`${priceId}-hint`}
            className="w-24 bg-transparent text-input outline-hidden mouse:text-sm"
          />
        </div>
        <p id={`${priceId}-hint`} className="mt-1 text-xs text-content-faint">Set 0 (or blank) for free; paid via Stripe.</p>
      </div>
    </Dialog>
  )
}
