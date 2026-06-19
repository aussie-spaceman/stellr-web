'use client'

import { useEffect, useState } from 'react'
import { formatDateShort } from '@/lib/utils'
import { Loader2, Truck, CheckCircle } from 'lucide-react'

interface Summary {
  awaitingCount: number
  batch: { id: string; status: string; pod_order_id: string | null; tracking_url: string | null; committed_at: string | null } | null
}

const inputCls = 'rounded-md border border-brand-border px-2 py-1.5 text-sm'

// Event Manager bulk-commit: turn all awaiting event-merch items into one Printful
// order shipped to the venue. Once committed, event merch is locked from refunds.
export function EventMerchBatch({
  eventSlug,
  defaultShipTo,
}: {
  eventSlug: string
  defaultShipTo: { name: string; city: string; state: string }
}) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [form, setForm] = useState({
    name: defaultShipTo.name,
    line1: '',
    line2: '',
    city: defaultShipTo.city,
    state: defaultShipTo.state,
    postcode: '',
    country: 'US',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const api = `/api/admin/events/${eventSlug}/merch/commit`
  const load = async () => {
    const res = await fetch(api)
    if (res.ok) setSummary(await res.json())
  }
  useEffect(() => {
    load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const commit = async () => {
    if (!confirm('Commit one bulk Printful order to the venue? Event merch is non-refundable after this.')) return
    setBusy(true)
    setError('')
    const res = await fetch(api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shipTo: form }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setError(json.error || 'Commit failed')
      return
    }
    load()
  }

  if (!summary) return <Loader2 className="h-4 w-4 animate-spin text-brand-muted-soft" />

  const committed = summary.batch && summary.batch.status !== 'open'

  if (committed) {
    const b = summary.batch!
    return (
      <div className="rounded-xl border border-brand-border bg-white p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-green-700">
          <CheckCircle className="h-4 w-4" /> Bulk order committed
        </div>
        <p className="mt-1 text-xs text-brand-muted-soft">
          Status: {b.status}
          {b.pod_order_id && ` · Printful order ${b.pod_order_id}`}
          {b.committed_at && ` · ${formatDateShort(b.committed_at)}`}
        </p>
        {b.tracking_url && (
          <a href={b.tracking_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm text-brand-blue hover:underline">
            <Truck className="h-4 w-4" /> Track shipment
          </a>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-brand-border bg-white p-5">
      <p className="text-sm text-brand-muted">
        <span className="font-semibold">{summary.awaitingCount}</span> item{summary.awaitingCount === 1 ? '' : 's'} awaiting fulfilment.
      </p>
      <p className="mb-3 text-xs text-brand-muted-soft">Confirm the venue ship-to address, then commit one bulk order.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Venue / recipient name" className={inputCls + ' sm:col-span-2'} />
        <input value={form.line1} onChange={(e) => setForm({ ...form, line1: e.target.value })} placeholder="Address line 1" className={inputCls + ' sm:col-span-2'} />
        <input value={form.line2} onChange={(e) => setForm({ ...form, line2: e.target.value })} placeholder="Address line 2" className={inputCls + ' sm:col-span-2'} />
        <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="City" className={inputCls} />
        <input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} placeholder="State" className={inputCls} />
        <input value={form.postcode} onChange={(e) => setForm({ ...form, postcode: e.target.value })} placeholder="Postcode" className={inputCls} />
        <input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} placeholder="Country" className={inputCls} />
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <button
        onClick={commit}
        disabled={busy || summary.awaitingCount === 0}
        className="mt-3 inline-flex items-center gap-2 rounded-md bg-brand-blue px-4 py-2 text-sm font-semibold text-white hover:bg-brand-blue-dark disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />} Commit bulk order
      </button>
    </div>
  )
}
