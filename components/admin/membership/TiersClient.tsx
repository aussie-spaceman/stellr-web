'use client'

import { useState } from 'react'
import { Pencil, Check, X, CreditCard, Users } from 'lucide-react'

export interface TierRow {
  id: string
  name: string
  is_free: boolean
  age_bracket: string | null
  description: string
  badge_color: string
  default_grant_months: number | null
  eligible_roles: string[]
  member_count: number
  price_annual: number | null
  price_monthly: number | null
  has_stripe_price: boolean
}

const BADGE: Record<string, string> = {
  green: 'bg-green-100 text-green-800',
  blue: 'bg-blue-100 text-blue-800',
  amber: 'bg-amber-100 text-amber-800',
  purple: 'bg-purple-100 text-purple-800',
  gray: 'bg-gray-100 text-gray-700',
}
const COLORS = ['green', 'blue', 'amber', 'purple', 'gray']

function priceLabel(t: TierRow): string {
  if (t.is_free) return 'Free'
  if (!t.has_stripe_price) return 'No Stripe price'
  if (t.price_annual == null) return '—'
  return `$${t.price_annual}/yr`
}

export function TiersClient({ tiers, stripeConnected }: { tiers: TierRow[]; stripeConnected: boolean }) {
  const [rows, setRows] = useState<TierRow[]>(tiers)
  const [editing, setEditing] = useState<string | null>(null)

  const save = async (id: string, patch: Partial<TierRow>) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))
    setEditing(null)
    await fetch('/api/admin/membership/tiers', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...patch }),
    })
  }

  return (
    <div>
      {!stripeConnected && (
        <p className="mb-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          Stripe is not configured in this environment — prices show as “—”. Set STRIPE_SECRET_KEY to read live pricing.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((t) => (
          <div key={t.id} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-medium text-gray-900">{t.name}</div>
                <div className="text-xs text-gray-400 mt-0.5">{t.age_bracket ?? '—'}</div>
              </div>
              <span className={'text-[11px] px-2 py-0.5 rounded-md ' + (BADGE[t.badge_color] ?? BADGE.gray)}>
                {t.is_free ? 'Free' : 'Paid'}
              </span>
            </div>

            <div className="mt-3 text-2xl font-semibold text-gray-900">{priceLabel(t)}</div>
            <div className="text-[11px] text-indigo-600 flex items-center gap-1 mt-0.5">
              <CreditCard className="w-3 h-3" />
              {t.is_free ? 'no charge' : 'live from Stripe'}
            </div>

            {editing === t.id ? (
              <TierEditForm row={t} onCancel={() => setEditing(null)} onSave={(patch) => save(t.id, patch)} />
            ) : (
              <>
                <p className="mt-3 text-sm text-gray-600 min-h-[2.5rem]">{t.description || <span className="text-gray-300">No description</span>}</p>
                <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" />
                    {t.member_count} active
                  </span>
                  <span>
                    {t.default_grant_months == null ? 'lifetime grant' : `${t.default_grant_months}mo grant`}
                  </span>
                </div>
                <button
                  onClick={() => setEditing(t.id)}
                  className="mt-3 w-full text-xs flex items-center justify-center gap-1 border border-gray-200 rounded-md py-1.5 text-gray-600 hover:bg-gray-50"
                >
                  <Pencil className="w-3 h-3" /> Edit metadata
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function TierEditForm({
  row,
  onCancel,
  onSave,
}: {
  row: TierRow
  onCancel: () => void
  onSave: (patch: Partial<TierRow>) => void
}) {
  const [description, setDescription] = useState(row.description)
  const [badge, setBadge] = useState(row.badge_color)
  const [months, setMonths] = useState<string>(row.default_grant_months == null ? '' : String(row.default_grant_months))

  return (
    <div className="mt-3 space-y-2">
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        className="w-full text-sm border border-gray-200 rounded-md px-2 py-1"
        placeholder="Description"
      />
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500">Badge</label>
        <div className="flex gap-1">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setBadge(c)}
              aria-label={c}
              className={
                'w-5 h-5 rounded-full border ' +
                (BADGE[c] ?? BADGE.gray) +
                (badge === c ? ' ring-2 ring-offset-1 ring-indigo-500' : '')
              }
            />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500">Default grant (months)</label>
        <input
          value={months}
          onChange={(e) => setMonths(e.target.value.replace(/[^0-9]/g, ''))}
          placeholder="blank = lifetime"
          className="w-28 text-sm border border-gray-200 rounded-md px-2 py-1"
        />
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={() => onSave({ description, badge_color: badge, default_grant_months: months === '' ? null : Number(months) })}
          className="flex-1 text-xs flex items-center justify-center gap-1 bg-indigo-600 text-white rounded-md py-1.5 hover:bg-indigo-700"
        >
          <Check className="w-3 h-3" /> Save
        </button>
        <button
          onClick={onCancel}
          className="flex-1 text-xs flex items-center justify-center gap-1 border border-gray-200 rounded-md py-1.5 text-gray-600 hover:bg-gray-50"
        >
          <X className="w-3 h-3" /> Cancel
        </button>
      </div>
    </div>
  )
}
