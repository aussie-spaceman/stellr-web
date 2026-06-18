'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ShoppingCart, Check } from 'lucide-react'
import { addToCart } from '@/lib/store/cart-client'

interface Variant {
  id: string
  label: string | null
  market_price_cents: number
  active: boolean
}

export function AddToCart({
  productSlug,
  productName,
  image,
  variants,
}: {
  productSlug: string
  productName: string
  image: string | null
  variants: Variant[]
}) {
  const active = variants.filter((v) => v.active)
  const [variantId, setVariantId] = useState(active[0]?.id ?? '')
  const [qty, setQty] = useState(1)
  const [added, setAdded] = useState(false)

  const selected = active.find((v) => v.id === variantId) ?? active[0]

  if (active.length === 0) {
    return <p className="text-sm text-gray-500">Currently unavailable.</p>
  }

  const add = () => {
    if (!selected) return
    addToCart({
      variantId: selected.id,
      productSlug,
      name: productName,
      label: selected.label,
      unitCents: selected.market_price_cents,
      qty,
      image,
    })
    setAdded(true)
    setTimeout(() => setAdded(false), 2500)
  }

  return (
    <div className="space-y-4">
      <div className="text-2xl font-semibold text-gray-900">
        ${((selected?.market_price_cents ?? 0) / 100).toFixed(2)}
      </div>

      {active.length > 1 && (
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Option</label>
          <select
            value={variantId}
            onChange={(e) => setVariantId(e.target.value)}
            className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
          >
            {active.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label ?? 'Default'} — ${(v.market_price_cents / 100).toFixed(2)}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700">Qty</label>
        <input
          type="number"
          min={1}
          value={qty}
          onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
          className="w-20 rounded-md border border-gray-200 px-3 py-2 text-sm"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={add}
          className="inline-flex items-center gap-2 rounded-md bg-brand-blue px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-blue-dark"
        >
          {added ? <Check className="h-4 w-4" /> : <ShoppingCart className="h-4 w-4" />}
          {added ? 'Added to cart' : 'Add to cart'}
        </button>
        <Link href="/store/cart" className="text-sm font-semibold text-brand-blue hover:underline">
          View cart
        </Link>
      </div>
      <p className="text-xs text-gray-400">Shipping calculated at checkout. Membership discounts apply automatically.</p>
    </div>
  )
}
