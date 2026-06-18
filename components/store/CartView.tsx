'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Trash2, Loader2, ShoppingBag } from 'lucide-react'
import { getCart, setQty, removeFromCart, type CartItem } from '@/lib/store/cart-client'

export function CartView() {
  const [items, setItems] = useState<CartItem[]>([])
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const sync = () => setItems(getCart())
    sync()
    setReady(true)
    window.addEventListener('cart-changed', sync)
    return () => window.removeEventListener('cart-changed', sync)
  }, [])

  const subtotal = items.reduce((s, i) => s + i.unitCents * i.qty, 0)

  const checkout = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/store/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: items.map((i) => ({ variantId: i.variantId, qty: i.qty })) }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.url) {
        setError(json.error || 'Could not start checkout')
        setBusy(false)
        return
      }
      window.location.href = json.url
    } catch {
      setError('Could not start checkout')
      setBusy(false)
    }
  }

  if (!ready) return <Loader2 className="h-5 w-5 animate-spin text-gray-400" />

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 p-10 text-center text-gray-500">
        <ShoppingBag className="mx-auto mb-2 h-6 w-6 text-gray-300" />
        Your cart is empty.
        <div className="mt-3">
          <Link href="/store" className="text-sm font-semibold text-brand-blue hover:underline">
            Browse the store
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="divide-y divide-gray-100 rounded-xl border border-gray-200">
        {items.map((i) => (
          <div key={i.variantId} className="flex items-center gap-4 p-4">
            <div className="flex-1">
              <div className="font-medium text-gray-900">{i.name}</div>
              {i.label && <div className="text-sm text-gray-500">{i.label}</div>}
              <div className="text-sm text-gray-500">${(i.unitCents / 100).toFixed(2)} each</div>
            </div>
            <input
              type="number"
              min={1}
              value={i.qty}
              onChange={(e) => setQty(i.variantId, Math.max(1, Math.floor(Number(e.target.value) || 1)))}
              className="w-16 rounded-md border border-gray-200 px-2 py-1 text-sm"
            />
            <div className="w-20 text-right font-medium text-gray-900">${((i.unitCents * i.qty) / 100).toFixed(2)}</div>
            <button onClick={() => removeFromCart(i.variantId)} className="text-gray-400 hover:text-red-600" aria-label="Remove">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500">Subtotal (shipping calculated at checkout)</span>
        <span className="text-lg font-semibold text-gray-900">${(subtotal / 100).toFixed(2)}</span>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        onClick={checkout}
        disabled={busy}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-brand-blue px-5 py-3 text-sm font-semibold text-white hover:bg-brand-blue-dark disabled:opacity-50 sm:w-auto"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Checkout
      </button>
    </div>
  )
}
