'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import type { EventDiscount, TierDiscount } from '@/lib/store/types'

type Lookup = { id: string; name: string }

export function DiscountMatrix({
  tier,
  event,
  tiers,
  products,
}: {
  tier: TierDiscount[]
  event: EventDiscount[]
  tiers: Lookup[]
  products: Lookup[]
}) {
  const router = useRouter()
  const tierName = (id: string) => tiers.find((t) => t.id === id)?.name ?? id
  const productName = (id: string | null) => (id ? products.find((p) => p.id === id)?.name ?? id : '—')

  const save = async (body: Record<string, unknown>) => {
    const res = await fetch('/api/admin/store/discounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      alert(j.error || 'Could not save')
      return
    }
    router.refresh()
  }

  const remove = async (axis: 'tier' | 'event', id: string) => {
    await fetch(`/api/admin/store/discounts?axis=${axis}&id=${id}`, { method: 'DELETE' })
    router.refresh()
  }

  return (
    <div className="space-y-8">
      {/* Tier discounts */}
      <section>
        <h2 className="mb-1 text-sm font-semibold text-gray-900">Membership-tier discounts</h2>
        <p className="mb-3 text-xs text-gray-500">Applied automatically in the storefront for members on the tier.</p>
        <div className="overflow-hidden rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">Tier</th>
                <th className="px-4 py-2 font-medium">Applies to</th>
                <th className="px-4 py-2 font-medium">Discount</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tier.map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-2">{tierName(d.tier_id)}</td>
                  <td className="px-4 py-2 text-gray-600">
                    {d.scope === 'all' ? 'All products' : d.scope === 'product' ? productName(d.product_id) : `Category: ${d.category}`}
                  </td>
                  <td className="px-4 py-2">{d.percent_off}% off</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => remove('tier', d.id)} className="text-gray-400 hover:text-red-600" aria-label="Delete">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {tier.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-3 text-gray-400">No tier discounts.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <AddTierDiscount tiers={tiers} products={products} onSave={save} />
      </section>

      {/* Event discounts */}
      <section>
        <h2 className="mb-1 text-sm font-semibold text-gray-900">Event merch discounts</h2>
        <p className="mb-3 text-xs text-gray-500">
          A global default plus per-event overrides. 100% = the free included shirt.
        </p>
        <div className="overflow-hidden rounded-xl border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">Scope</th>
                <th className="px-4 py-2 font-medium">Applies to</th>
                <th className="px-4 py-2 font-medium">Discount</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {event.map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-2">{d.scope === 'global' ? 'Global default' : `Event: ${d.event_slug}`}</td>
                  <td className="px-4 py-2 text-gray-600">
                    {d.product_id ? productName(d.product_id) : d.category ? `Category: ${d.category}` : 'All products'}
                  </td>
                  <td className="px-4 py-2">{d.percent_off}% off</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => remove('event', d.id)} className="text-gray-400 hover:text-red-600" aria-label="Delete">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {event.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-3 text-gray-400">No event discounts.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <AddEventDiscount products={products} onSave={save} />
      </section>
    </div>
  )
}

const inputCls = 'rounded-md border border-gray-200 px-2 py-1 text-sm'

function AddTierDiscount({
  tiers,
  products,
  onSave,
}: {
  tiers: Lookup[]
  products: Lookup[]
  onSave: (body: Record<string, unknown>) => void
}) {
  const [tierId, setTierId] = useState('')
  const [scope, setScope] = useState<'all' | 'product' | 'category'>('all')
  const [productId, setProductId] = useState('')
  const [category, setCategory] = useState('')
  const [percent, setPercent] = useState('')

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <select value={tierId} onChange={(e) => setTierId(e.target.value)} className={inputCls}>
        <option value="">Tier…</option>
        {tiers.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
      <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} className={inputCls}>
        <option value="all">All products</option>
        <option value="product">One product</option>
        <option value="category">Category</option>
      </select>
      {scope === 'product' && (
        <select value={productId} onChange={(e) => setProductId(e.target.value)} className={inputCls}>
          <option value="">Product…</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      )}
      {scope === 'category' && (
        <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="apparel" className={inputCls} />
      )}
      <input
        value={percent}
        onChange={(e) => setPercent(e.target.value.replace(/[^0-9]/g, ''))}
        placeholder="% off"
        className={inputCls + ' w-20'}
      />
      <button
        disabled={!tierId || !percent}
        onClick={() =>
          onSave({
            axis: 'tier',
            tier_id: tierId,
            scope,
            product_id: scope === 'product' ? productId : null,
            category: scope === 'category' ? category : null,
            percent_off: Number(percent),
          })
        }
        className="flex items-center gap-1 rounded-md bg-gray-900 px-3 py-1 text-xs text-white hover:bg-gray-700 disabled:opacity-50"
      >
        <Plus className="h-3 w-3" /> Add
      </button>
    </div>
  )
}

function AddEventDiscount({
  products,
  onSave,
}: {
  products: Lookup[]
  onSave: (body: Record<string, unknown>) => void
}) {
  const [scope, setScope] = useState<'global' | 'event'>('global')
  const [eventSlug, setEventSlug] = useState('')
  const [productId, setProductId] = useState('')
  const [percent, setPercent] = useState('')

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} className={inputCls}>
        <option value="global">Global default</option>
        <option value="event">Specific event</option>
      </select>
      {scope === 'event' && (
        <input value={eventSlug} onChange={(e) => setEventSlug(e.target.value)} placeholder="event-slug" className={inputCls} />
      )}
      <select value={productId} onChange={(e) => setProductId(e.target.value)} className={inputCls}>
        <option value="">All products</option>
        {products.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <input
        value={percent}
        onChange={(e) => setPercent(e.target.value.replace(/[^0-9]/g, ''))}
        placeholder="% off"
        className={inputCls + ' w-20'}
      />
      <button
        disabled={!percent || (scope === 'event' && !eventSlug)}
        onClick={() =>
          onSave({
            axis: 'event',
            scope,
            event_slug: scope === 'event' ? eventSlug : null,
            product_id: productId || null,
            percent_off: Number(percent),
          })
        }
        className="flex items-center gap-1 rounded-md bg-gray-900 px-3 py-1 text-xs text-white hover:bg-gray-700 disabled:opacity-50"
      >
        <Plus className="h-3 w-3" /> Add
      </button>
    </div>
  )
}
