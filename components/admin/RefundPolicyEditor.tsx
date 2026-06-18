'use client'

import { useState } from 'react'

interface Tier {
  minDaysOut: number
  cashPct: number | null
  creditPct: number | null
  creditValidityDays: number | null
}

interface Props {
  scope: 'global' | 'event'
  eventSlug?: string
  initialTiers: Tier[]
  /** For event scope: whether an override currently exists (enables "remove override"). */
  hasOverride?: boolean
}

function numOrNull(v: string): number | null {
  if (v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Editor for a refund schedule (global default or per-event override). Each row
// is a tier: from `minDaysOut` days before the event, offer cash% and/or credit%
// (with a validity window). Leave a percentage blank to not offer that option.
export function RefundPolicyEditor({ scope, eventSlug, initialTiers, hasOverride }: Props) {
  const [tiers, setTiers] = useState<Tier[]>(initialTiers)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  function update(i: number, field: keyof Tier, value: string) {
    setTiers((prev) => prev.map((t, idx) => (idx === i ? { ...t, [field]: numOrNull(value) } : t)))
  }
  function addRow() {
    setTiers((prev) => [...prev, { minDaysOut: 0, cashPct: null, creditPct: null, creditValidityDays: 730 }])
  }
  function removeRow(i: number) {
    setTiers((prev) => prev.filter((_, idx) => idx !== i))
  }

  async function save() {
    setSaving(true)
    setMsg(null)
    const sorted = [...tiers].sort((a, b) => b.minDaysOut - a.minDaysOut)
    const res = await fetch('/api/admin/refund-policies', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope, eventSlug, tiers: sorted }),
    })
    setSaving(false)
    setMsg(res.ok ? 'Saved.' : 'Save failed.')
  }

  async function removeOverride() {
    if (!eventSlug || !confirm('Remove the per-event override and fall back to the global policy?')) return
    setSaving(true)
    const res = await fetch(`/api/admin/refund-policies?event=${encodeURIComponent(eventSlug)}`, { method: 'DELETE' })
    setSaving(false)
    if (res.ok) window.location.reload()
  }

  const input = 'w-20 border border-brand-border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue'

  return (
    <div className="space-y-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-brand-muted-soft">
            <th className="py-2 pr-3">From (days out)</th>
            <th className="py-2 pr-3">Cash %</th>
            <th className="py-2 pr-3">Credit %</th>
            <th className="py-2 pr-3">Credit validity (days)</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {tiers.map((t, i) => (
            <tr key={i} className="border-t border-brand-hairline">
              <td className="py-2 pr-3"><input className={input} type="number" value={t.minDaysOut} onChange={(e) => update(i, 'minDaysOut', e.target.value)} /></td>
              <td className="py-2 pr-3"><input className={input} type="number" value={t.cashPct ?? ''} placeholder="—" onChange={(e) => update(i, 'cashPct', e.target.value)} /></td>
              <td className="py-2 pr-3"><input className={input} type="number" value={t.creditPct ?? ''} placeholder="—" onChange={(e) => update(i, 'creditPct', e.target.value)} /></td>
              <td className="py-2 pr-3"><input className={input} type="number" value={t.creditValidityDays ?? ''} placeholder="—" onChange={(e) => update(i, 'creditValidityDays', e.target.value)} /></td>
              <td className="py-2"><button onClick={() => removeRow(i)} className="text-xs text-red-500 hover:text-red-700">remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex items-center gap-3">
        <button onClick={addRow} className="text-sm text-brand-blue hover:text-brand-blue">+ Add tier</button>
        <button onClick={save} disabled={saving} className="bg-brand-blue text-white text-sm font-medium px-4 py-1.5 rounded-lg hover:bg-brand-blue-dark disabled:opacity-50">
          {saving ? 'Saving…' : scope === 'event' ? 'Save override' : 'Save policy'}
        </button>
        {scope === 'event' && hasOverride && (
          <button onClick={removeOverride} disabled={saving} className="text-sm text-brand-muted-soft hover:text-red-600">Remove override</button>
        )}
        {msg && <span className="text-sm text-brand-muted-soft">{msg}</span>}
      </div>
      <p className="text-xs text-brand-muted-soft">A tier applies from its “days out” up to the next-higher tier. Leave Cash or Credit blank to not offer it; when both are set, the admin chooses at deletion.</p>
    </div>
  )
}
