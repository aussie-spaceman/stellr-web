'use client'

import { useEffect, useState } from 'react'
import { Loader2, Truck, Package } from 'lucide-react'

interface OrderItem {
  name: string
  qty: number
  line_source: string
  fulfillment_status: string
}
interface Order {
  id: string
  status: string
  channel: string
  event_slug: string | null
  total_cents: number
  tracking_url: string | null
  created_at: string
  merchCollected: boolean
  items: OrderItem[]
}

const STATUS_BADGE: Record<string, string> = {
  paid: 'bg-brand-blue/10 text-brand-blue',
  fulfilling: 'bg-brand-orange/10 text-brand-gold-ink',
  shipped: 'bg-green-100 text-green-700',
  delivered: 'bg-green-100 text-green-700',
  refunded: 'bg-brand-hairline text-brand-muted',
  cancelled: 'bg-brand-hairline text-brand-muted-soft',
  pending: 'bg-brand-hairline text-brand-muted-soft',
}

export function OrdersList() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const load = async () => {
    const res = await fetch('/api/members/orders')
    const json = await res.json().catch(() => ({}))
    setOrders(json.orders ?? [])
    setLoading(false)
  }
  useEffect(() => {
    load()
  }, [])

  const reship = async (orderId: string) => {
    setBusy(orderId)
    const res = await fetch('/api/store/reship', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId }),
    })
    const json = await res.json().catch(() => ({}))
    if (res.ok && json.url) window.location.href = json.url
    else {
      alert(json.error || 'Could not start reship')
      setBusy(null)
    }
  }

  const requestReturn = async (orderId: string) => {
    const reason = prompt('Reason for return (optional):') ?? ''
    setBusy(orderId)
    const res = await fetch('/api/store/returns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, reason }),
    })
    setBusy(null)
    alert(res.ok ? 'Return requested — we’ll be in touch.' : 'Could not submit return.')
  }

  return (
    <div>
      <h2 className="mb-1 text-sm font-semibold text-brand-blue-dark">Store orders</h2>
      <p className="mb-3 text-xs text-brand-muted-soft">Merchandise purchases and event merch.</p>

      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-brand-muted-soft" />
      ) : orders.length === 0 ? (
        <p className="text-sm text-brand-muted-soft">No orders yet.</p>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => {
            const isEvent = o.channel === 'event_registration'
            const canReship = isEvent && !o.merchCollected && o.items.length > 0
            const canReturn = o.channel === 'storefront' && (o.status === 'shipped' || o.status === 'delivered')
            return (
              <div key={o.id} className="rounded-lg border border-brand-border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-brand-blue-dark">
                    {isEvent ? 'Event merch' : 'Store order'} · {new Date(o.created_at).toLocaleDateString()}
                  </span>
                  <span className={'rounded px-1.5 py-0.5 text-[11px] ' + (STATUS_BADGE[o.status] ?? STATUS_BADGE.pending)}>
                    {o.status}
                  </span>
                </div>
                <ul className="mt-1 text-brand-muted">
                  {o.items.map((it, i) => (
                    <li key={i} className="flex items-center gap-1">
                      <Package className="h-3 w-3 text-brand-muted-soft" />
                      {it.name}
                      {it.qty > 1 ? ` ×${it.qty}` : ''}
                      {it.line_source === 'event_included' && <span className="text-brand-gold-ink"> (included)</span>}
                    </li>
                  ))}
                </ul>
                {o.tracking_url && (
                  <a href={o.tracking_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-brand-blue hover:underline">
                    <Truck className="h-3 w-3" /> Track
                  </a>
                )}
                {(canReship || canReturn) && (
                  <div className="mt-2 flex gap-3">
                    {canReship && (
                      <button onClick={() => reship(o.id)} disabled={busy === o.id} className="text-xs font-medium text-brand-blue hover:underline disabled:opacity-50">
                        {busy === o.id ? 'Starting…' : 'Ship uncollected merch to me'}
                      </button>
                    )}
                    {canReturn && (
                      <button onClick={() => requestReturn(o.id)} disabled={busy === o.id} className="text-xs font-medium text-brand-muted-soft hover:text-brand-blue-dark disabled:opacity-50">
                        Request return
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
