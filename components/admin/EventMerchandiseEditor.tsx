'use client'

import { useEffect, useState } from 'react'
import { Plus, Trash2, Loader2 } from 'lucide-react'

interface Offering {
  id: string
  treatment: string
  variantId: string | null
  sku: string | null
  label: string | null
  productName: string | null
}
interface ProductOpt {
  id: string
  name: string
  variants: { id: string; label: string | null; active: boolean }[]
}

// Per-event merchandise offerings: the free included shirt (auto-allocated to
// every participant by size) and any paid add-ons. Mirrors the refund-policy
// editor pattern.
export function EventMerchandiseEditor({ eventSlug }: { eventSlug: string }) {
  const [offerings, setOfferings] = useState<Offering[]>([])
  const [products, setProducts] = useState<ProductOpt[]>([])
  const [loading, setLoading] = useState(true)
  const [productId, setProductId] = useState('')
  const [variantId, setVariantId] = useState('')
  const [treatment, setTreatment] = useState<'included' | 'addon'>('included')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const res = await fetch(`/api/admin/events/${eventSlug}/offerings`)
    const json = await res.json().catch(() => ({}))
    setOfferings(json.offerings ?? [])
    setProducts(json.products ?? [])
    setLoading(false)
  }
  useEffect(() => {
    load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const product = products.find((p) => p.id === productId)
  const variants = (product?.variants ?? []).filter((v) => v.active)

  const add = async () => {
    if (!variantId) return
    setBusy(true)
    const res = await fetch(`/api/admin/events/${eventSlug}/offerings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variantId, treatment }),
    })
    setBusy(false)
    if (res.ok) {
      setProductId('')
      setVariantId('')
      setTreatment('included')
      load()
    } else {
      const j = await res.json().catch(() => ({}))
      alert(j.error || 'Could not add offering')
    }
  }

  const remove = async (id: string) => {
    await fetch(`/api/admin/events/${eventSlug}/offerings?id=${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="mb-3 text-xs text-gray-500">
        Included items are given free to every participant, auto-sized from their t-shirt size at confirmation. Add-ons
        are paid extras. Items are fulfilled in one bulk order to the venue (committed by the Event Manager).
      </p>

      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
      ) : (
        <div className="space-y-2">
          {offerings.map((o) => (
            <div key={o.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-sm">
              <div>
                <span
                  className={
                    'mr-2 rounded px-1.5 py-0.5 text-[11px] ' +
                    (o.treatment === 'included' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800')
                  }
                >
                  {o.treatment === 'included' ? 'Included' : 'Add-on'}
                </span>
                <span className="font-medium text-gray-900">{o.productName ?? 'Product'}</span>
                {o.label && <span className="text-gray-500"> — {o.label}</span>}
                {o.treatment === 'included' && <span className="text-gray-400"> (all sizes)</span>}
              </div>
              <button onClick={() => remove(o.id)} className="text-gray-400 hover:text-red-600" aria-label="Remove">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {offerings.length === 0 && <p className="text-sm text-gray-400">No merchandise configured for this event.</p>}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
        <select
          value={productId}
          onChange={(e) => {
            setProductId(e.target.value)
            setVariantId('')
          }}
          className="rounded-md border border-gray-200 px-2 py-1 text-sm"
        >
          <option value="">Product…</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select
          value={variantId}
          onChange={(e) => setVariantId(e.target.value)}
          disabled={!product}
          className="rounded-md border border-gray-200 px-2 py-1 text-sm disabled:opacity-50"
        >
          <option value="">Variant…</option>
          {variants.map((v) => (
            <option key={v.id} value={v.id}>{v.label ?? 'Default'}</option>
          ))}
        </select>
        <select
          value={treatment}
          onChange={(e) => setTreatment(e.target.value as 'included' | 'addon')}
          className="rounded-md border border-gray-200 px-2 py-1 text-sm"
        >
          <option value="included">Included (free)</option>
          <option value="addon">Add-on (paid)</option>
        </select>
        <button
          onClick={add}
          disabled={busy || !variantId}
          className="flex items-center gap-1 rounded-md bg-gray-900 px-3 py-1 text-xs text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Add
        </button>
      </div>
    </div>
  )
}
