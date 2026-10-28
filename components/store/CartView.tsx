'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Trash2, Loader2, ShoppingBag } from 'lucide-react'
import { getCart, setQty, removeFromCart, type CartItem } from '@/lib/store/cart-client'
import { MoneyBackGuarantee } from '@/components/ui/MoneyBackGuarantee'

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

  if (!ready) return <Loader2 className="h-5 w-5 animate-spin text-content-faint" />

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line p-10 text-center text-content-muted">
        <ShoppingBag className="mx-auto mb-2 h-6 w-6 text-content-faint" />
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
      <div className="divide-y divide-line-light rounded-xl border border-line">
        {items.map((i) => (
          // Name on its own line on a phone, then quantity, total and remove
          // (side by side, the name got about 48px at 320px).
          <div key={i.variantId} className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
            <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
              <div className="font-medium text-ink [overflow-wrap:anywhere]">{i.name}</div>
              {i.label && <div className="text-sm text-content-muted">{i.label}</div>}
              <div className="text-sm text-content-muted">${(i.unitCents / 100).toFixed(2)} each</div>
            </div>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={i.qty}
              aria-label={`Quantity of ${i.name}`}
              onChange={(e) => setQty(i.variantId, Math.max(1, Math.floor(Number(e.target.value) || 1)))}
              className="min-h-11 w-20 rounded-md border border-line-strong px-2 text-input mouse:text-sm"
            />
            <div className="ml-auto w-20 text-right font-medium text-ink sm:ml-0">${((i.unitCents * i.qty) / 100).toFixed(2)}</div>
            <button
              onClick={() => removeFromCart(i.variantId)}
              className="-mr-2 inline-flex min-h-11 min-w-11 items-center justify-center text-content-muted hover:text-danger"
              aria-label={`Remove ${i.name}`}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm text-content-muted">Subtotal (shipping calculated at checkout)</span>
        <span className="text-lg font-semibold text-ink">${(subtotal / 100).toFixed(2)}</span>
      </div>

      {error && <p className="text-sm text-danger" role="alert">{error}</p>}

      <button
        onClick={checkout}
        disabled={busy}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-brand-blue px-5 py-3 text-sm font-semibold text-white hover:bg-brand-blue-dark disabled:opacity-50 sm:w-auto"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Checkout
      </button>
      <MoneyBackGuarantee variant="compact" />
    </div>
  )
}
