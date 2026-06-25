'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { formatUsd } from '@/lib/mentoring-format'

interface TierRow {
  id: string
  name: string
  monthlyPriceCents: number | null
  freeSessions: number
}
interface WorkshopRow {
  id: string
  name: string
  freeForTierIds: string[]
  oneOffPriceCents: number | null
}

const DEFAULT_FREE_SESSIONS = 6

async function adminPost(payload: Record<string, unknown>) {
  const res = await fetch('/api/admin/community/coaching', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return res.ok
}

export function CoachingMembershipAccess({ tiers: initialTiers, workshops: initialWorkshops }: { tiers: TierRow[]; workshops: WorkshopRow[] }) {
  const [tiers, setTiers] = useState(initialTiers)
  const [workshops, setWorkshops] = useState(initialWorkshops)
  const [editing, setEditing] = useState<WorkshopRow | null>(null)

  const setFreeSessions = async (id: string, value: number) => {
    const v = Math.max(0, Math.floor(value))
    setTiers((p) => p.map((t) => (t.id === id ? { ...t, freeSessions: v } : t)))
    await adminPost({ action: 'updateTier', tierId: id, freeSessions: v })
  }
  const toggleCoaching = async (t: TierRow) => {
    const next = t.freeSessions > 0 ? 0 : DEFAULT_FREE_SESSIONS
    await setFreeSessions(t.id, next)
  }

  return (
    <div className="space-y-8 pt-1">
      <p className="text-[14px] text-content-secondary">
        Set which membership tiers include free coaching. Prices are in USD, read from Stripe. Free sessions reset each
        membership year (annual, no rollover).
      </p>

      {/* Tiers */}
      <section className="rounded-card border border-line bg-white p-5">
        <h2 className="font-display text-[17px] font-bold text-ink">Membership tiers</h2>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="border-b border-line-light text-left text-[12px] font-semibold uppercase tracking-[0.05em] text-content-faint">
              <th className="py-2.5">Tier</th>
              <th className="py-2.5">Price / mo</th>
              <th className="py-2.5">Coaching</th>
              <th className="py-2.5">Free sessions / yr</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((t) => (
              <tr key={t.id} className="border-b border-line-light last:border-0">
                <td className="py-3 font-medium text-ink">{t.name}</td>
                <td className="py-3 text-content-secondary">{t.monthlyPriceCents != null ? formatUsd(t.monthlyPriceCents) : '—'}</td>
                <td className="py-3">
                  <button
                    onClick={() => toggleCoaching(t)}
                    className={`rounded-pill px-2.5 py-1 text-[12px] font-semibold ${t.freeSessions > 0 ? 'bg-enviro-green-bg text-enviro-green-text' : 'bg-surface text-content-muted'}`}
                  >
                    {t.freeSessions > 0 ? 'Free coaching' : 'No coaching access'}
                  </button>
                </td>
                <td className="py-3">
                  <input
                    type="number"
                    min={0}
                    value={t.freeSessions}
                    onChange={(e) => setFreeSessions(t.id, Number(e.target.value) || 0)}
                    className="w-20 rounded-[8px] border border-line px-2.5 py-1.5 text-sm"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-[12px] text-content-faint">
          The 9 buyable tiers. A tier with 1+ free sessions/yr shows &ldquo;Free coaching&rdquo;. Set 0 for no free coaching access (members buy sessions à la carte).
        </p>
      </section>

      {/* Workshop access */}
      <section className="rounded-card border border-line bg-white p-5">
        <h2 className="font-display text-[17px] font-bold text-ink">Workshop access</h2>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="border-b border-line-light text-left text-[12px] font-semibold uppercase tracking-[0.05em] text-content-faint">
              <th className="py-2.5">Workshop</th>
              <th className="py-2.5">Free for tiers</th>
              <th className="py-2.5">One-off price</th>
              <th className="py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {workshops.length === 0 ? (
              <tr><td colSpan={4} className="py-8 text-center text-content-muted">No active workshops.</td></tr>
            ) : (
              workshops.map((w) => (
                <tr key={w.id} className="border-b border-line-light last:border-0">
                  <td className="py-3 font-medium text-ink">{w.name}</td>
                  <td className="py-3 text-content-secondary">{w.freeForTierIds.length === 0 ? '—' : `${w.freeForTierIds.length} tier${w.freeForTierIds.length === 1 ? '' : 's'}`}</td>
                  <td className="py-3 text-content-secondary">{w.oneOffPriceCents != null ? formatUsd(w.oneOffPriceCents) : '—'}</td>
                  <td className="py-3 text-right">
                    <button onClick={() => setEditing(w)} className="text-[13px] font-semibold text-primary hover:underline">Edit</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {editing && (
        <EditAccessModal
          workshop={editing}
          tiers={tiers}
          onClose={() => setEditing(null)}
          onSaved={(next) => { setWorkshops((p) => p.map((w) => (w.id === next.id ? next : w))); setEditing(null) }}
        />
      )}
    </div>
  )
}

function EditAccessModal({ workshop, tiers, onClose, onSaved }: { workshop: WorkshopRow; tiers: TierRow[]; onClose: () => void; onSaved: (next: WorkshopRow) => void }) {
  const [freeTiers, setFreeTiers] = useState<string[]>(workshop.freeForTierIds)
  const [price, setPrice] = useState(workshop.oneOffPriceCents != null ? String(workshop.oneOffPriceCents / 100) : '')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    const oneOffPriceCents = price ? Math.round(Number(price) * 100) : null
    const ok = await adminPost({ action: 'updateWorkshop', workshopId: workshop.id, freeForTierIds: freeTiers, oneOffPriceCents })
    if (ok) onSaved({ ...workshop, freeForTierIds: freeTiers, oneOffPriceCents })
    else setBusy(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(14,19,48,.55)' }} onClick={onClose}>
      <div className="w-full max-w-[460px] rounded-[18px] bg-white p-6 shadow-[0_30px_70px_-20px_rgba(0,0,0,.5)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <h2 className="font-display text-[20px] font-bold text-ink">Edit access · {workshop.name}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-content-faint hover:bg-surface" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1.5 block text-[12.5px] font-semibold text-content-secondary">Free for membership tiers</label>
            <div className="flex flex-wrap gap-1.5">
              {tiers.map((t) => {
                const on = freeTiers.includes(t.id)
                return (
                  <button key={t.id} onClick={() => setFreeTiers((p) => (on ? p.filter((x) => x !== t.id) : [...p, t.id]))} className={`rounded-pill px-2.5 py-1 text-[12.5px] font-medium ${on ? 'bg-space-violet text-white' : 'bg-surface text-content-secondary'}`}>
                    {t.name}
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-[12.5px] font-semibold text-content-secondary">One-off price (USD)</label>
            <div className="inline-flex items-center gap-1.5 rounded-[9px] border border-line px-3 py-2">
              <span className="text-sm text-content-muted">$</span>
              <input value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0" inputMode="decimal" className="w-24 text-sm outline-none" />
            </div>
            <p className="mt-1 text-[12px] text-content-faint">Set 0 for free; paid via Stripe.</p>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded-[9px] px-4 py-2.5 text-sm font-medium text-content-secondary hover:bg-surface">Cancel</button>
            <button onClick={save} disabled={busy} className="rounded-[9px] bg-space-violet px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#5B3FE0] disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
