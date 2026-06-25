'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Discount, Tier, TierBenefit, OfferingType, DiscountType } from '@/lib/entitlements'

const OFFERING_LABELS: Record<OfferingType, string> = {
  coaching_session: 'Coaching',
  mentoring_cohort: 'Mentoring cohort',
  call_series: 'Call series',
  training_content: 'Training',
}
const OFFERING_OPTS: OfferingType[] = ['coaching_session', 'mentoring_cohort', 'call_series', 'training_content']

function fmtPct(n: number | null) { return n == null ? '' : `${n}%` }
function fmtCents(n: number | null) { return n == null ? '' : `$${(n / 100).toFixed(2)}` }
function amount(d: Discount) { return d.discount_type === 'percent' ? fmtPct(d.percent) : fmtCents(d.amount_cents) }

export function DiscountsClient({
  discounts, tiers, allocations,
}: { discounts: Discount[]; tiers: Tier[]; allocations: TierBenefit[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const tierDiscounts = discounts.filter((d) => d.kind === 'tier')
  const coupons = discounts.filter((d) => d.kind === 'coupon')
  const tierName = (code: string | null) => tiers.find((t) => t.code === code)?.name ?? code ?? '—'

  async function call(method: string, url: string, body?: unknown) {
    setBusy(true); setErr(null)
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? `${method} failed`)
      }
      router.refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const saveDiscount = (d: Partial<Discount> & { kind: 'tier' | 'coupon'; discount_type: DiscountType }) =>
    call('POST', '/api/admin/entitlements/discounts', d)
  const removeDiscount = (id: string) => call('DELETE', `/api/admin/entitlements/discounts?id=${id}`)
  const setQty = (id: string, quantity: number) => call('PATCH', '/api/admin/entitlements/allocations', { id, quantity })

  return (
    <div className="flex flex-col gap-8">
      {err && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}

      {/* ── Tier discounts ── */}
      <section>
        <h2 className="font-display text-lg font-bold text-ink">Tier discounts</h2>
        <p className="mb-3 text-sm text-content-faint">Percentage off à-la-carte coaching/mentoring for members on a tier.</p>
        <table className="w-full text-sm">
          <thead className="text-left text-content-faint">
            <tr><th className="py-1">Tier</th><th>Applies to</th><th>Discount</th><th>Active</th><th /></tr>
          </thead>
          <tbody>
            {tierDiscounts.map((d) => (
              <tr key={d.id} className="border-t border-brand-border">
                <td className="py-2">{tierName(d.tier_code)}</td>
                <td>{d.applies_to ? OFFERING_LABELS[d.applies_to] : 'All'}</td>
                <td>{amount(d)}</td>
                <td>{d.is_active ? 'Yes' : 'No'}</td>
                <td className="text-right">
                  <button disabled={busy} onClick={() => removeDiscount(d.id)} className="text-red-600 hover:underline">Delete</button>
                </td>
              </tr>
            ))}
            {tierDiscounts.length === 0 && <tr><td colSpan={5} className="py-3 text-content-faint">No tier discounts configured.</td></tr>}
          </tbody>
        </table>
        <TierDiscountForm tiers={tiers} busy={busy} onSave={saveDiscount} />
      </section>

      {/* ── Coupons ── */}
      <section>
        <h2 className="font-display text-lg font-bold text-ink">Coupon codes</h2>
        <p className="mb-3 text-sm text-content-faint">Time-bounded promo codes. Leave dates blank for always-on; leave cap blank for unlimited.</p>
        <table className="w-full text-sm">
          <thead className="text-left text-content-faint">
            <tr><th className="py-1">Code</th><th>Applies to</th><th>Discount</th><th>Window</th><th>Used / cap</th><th>Active</th><th /></tr>
          </thead>
          <tbody>
            {coupons.map((d) => (
              <tr key={d.id} className="border-t border-brand-border">
                <td className="py-2 font-mono">{d.code}</td>
                <td>{d.applies_to ? OFFERING_LABELS[d.applies_to] : 'All'}</td>
                <td>{amount(d)}</td>
                <td className="text-xs text-content-faint">
                  {(d.valid_from?.slice(0, 10) ?? '—')} → {(d.valid_to?.slice(0, 10) ?? '—')}
                </td>
                <td>{d.times_redeemed}{d.max_redemptions != null ? ` / ${d.max_redemptions}` : ''}</td>
                <td>{d.is_active ? 'Yes' : 'No'}</td>
                <td className="text-right">
                  <button disabled={busy} onClick={() => removeDiscount(d.id)} className="text-red-600 hover:underline">Delete</button>
                </td>
              </tr>
            ))}
            {coupons.length === 0 && <tr><td colSpan={7} className="py-3 text-content-faint">No coupons yet.</td></tr>}
          </tbody>
        </table>
        <CouponForm busy={busy} onSave={saveDiscount} />
      </section>

      {/* ── Free allocations ── */}
      <section>
        <h2 className="font-display text-lg font-bold text-ink">Free allocations</h2>
        <p className="mb-3 text-sm text-content-faint">Included sessions/cohorts granted to each tier per period.</p>
        <table className="w-full text-sm">
          <thead className="text-left text-content-faint">
            <tr><th className="py-1">Tier</th><th>Kind</th><th>Period</th><th>Quantity</th></tr>
          </thead>
          <tbody>
            {allocations.map((a) => (
              <tr key={a.id} className="border-t border-brand-border">
                <td className="py-2">{tierName(a.tier_code)}</td>
                <td>{a.kind === 'coaching_session' ? 'Coaching' : a.kind === 'cohort_access' ? 'Mentoring cohort' : a.kind}</td>
                <td>{a.period}</td>
                <td>
                  <input
                    type="number" min={0} defaultValue={a.quantity ?? 0} disabled={busy}
                    onBlur={(e) => { const v = Number(e.target.value); if (v !== (a.quantity ?? 0)) setQty(a.id, v) }}
                    className="w-20 rounded border border-brand-border px-2 py-1"
                  />
                </td>
              </tr>
            ))}
            {allocations.length === 0 && <tr><td colSpan={4} className="py-3 text-content-faint">No allocations configured.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  )
}

function TierDiscountForm({ tiers, busy, onSave }: {
  tiers: Tier[]; busy: boolean
  onSave: (d: Partial<Discount> & { kind: 'tier'; discount_type: DiscountType }) => void
}) {
  const [tierCode, setTierCode] = useState(tiers[0]?.code ?? '')
  const [appliesTo, setAppliesTo] = useState<OfferingType | ''>('')
  const [percent, setPercent] = useState('')
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 rounded-md bg-surface-muted p-3">
      <label className="text-xs">Tier
        <select value={tierCode} onChange={(e) => setTierCode(e.target.value)} className="block rounded border border-brand-border px-2 py-1">
          {tiers.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
        </select>
      </label>
      <label className="text-xs">Applies to
        <select value={appliesTo} onChange={(e) => setAppliesTo(e.target.value as OfferingType | '')} className="block rounded border border-brand-border px-2 py-1">
          <option value="">All</option>
          {OFFERING_OPTS.map((o) => <option key={o} value={o}>{OFFERING_LABELS[o]}</option>)}
        </select>
      </label>
      <label className="text-xs">Percent off
        <input type="number" min={0} max={100} value={percent} onChange={(e) => setPercent(e.target.value)} className="block w-24 rounded border border-brand-border px-2 py-1" />
      </label>
      <button
        disabled={busy || !tierCode || !percent}
        onClick={() => onSave({ kind: 'tier', discount_type: 'percent', tier_code: tierCode, applies_to: appliesTo || null, percent: Number(percent), is_active: true })}
        className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >Add tier discount</button>
    </div>
  )
}

function CouponForm({ busy, onSave }: {
  busy: boolean
  onSave: (d: Partial<Discount> & { kind: 'coupon'; discount_type: DiscountType }) => void
}) {
  const [code, setCode] = useState('')
  const [type, setType] = useState<DiscountType>('percent')
  const [value, setValue] = useState('')
  const [appliesTo, setAppliesTo] = useState<OfferingType | ''>('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [cap, setCap] = useState('')
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 rounded-md bg-surface-muted p-3">
      <label className="text-xs">Code
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="block w-32 rounded border border-brand-border px-2 py-1 font-mono" />
      </label>
      <label className="text-xs">Type
        <select value={type} onChange={(e) => setType(e.target.value as DiscountType)} className="block rounded border border-brand-border px-2 py-1">
          <option value="percent">Percent</option>
          <option value="fixed">Fixed $</option>
        </select>
      </label>
      <label className="text-xs">{type === 'percent' ? 'Percent off' : 'Amount ($)'}
        <input type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} className="block w-24 rounded border border-brand-border px-2 py-1" />
      </label>
      <label className="text-xs">Applies to
        <select value={appliesTo} onChange={(e) => setAppliesTo(e.target.value as OfferingType | '')} className="block rounded border border-brand-border px-2 py-1">
          <option value="">All</option>
          {OFFERING_OPTS.map((o) => <option key={o} value={o}>{OFFERING_LABELS[o]}</option>)}
        </select>
      </label>
      <label className="text-xs">From
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="block rounded border border-brand-border px-2 py-1" />
      </label>
      <label className="text-xs">To
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="block rounded border border-brand-border px-2 py-1" />
      </label>
      <label className="text-xs">Max uses
        <input type="number" min={1} value={cap} onChange={(e) => setCap(e.target.value)} className="block w-20 rounded border border-brand-border px-2 py-1" />
      </label>
      <button
        disabled={busy || !code || !value}
        onClick={() => onSave({
          kind: 'coupon', discount_type: type, code,
          percent: type === 'percent' ? Number(value) : null,
          amount_cents: type === 'fixed' ? Math.round(Number(value) * 100) : null,
          applies_to: appliesTo || null,
          valid_from: from ? new Date(from).toISOString() : null,
          valid_to: to ? new Date(to).toISOString() : null,
          max_redemptions: cap ? Number(cap) : null,
          is_active: true,
        })}
        className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >Add coupon</button>
    </div>
  )
}
