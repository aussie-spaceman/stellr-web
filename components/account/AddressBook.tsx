'use client'

import { useEffect, useState } from 'react'
import { Plus, Trash2, Star, Loader2 } from 'lucide-react'

interface Address {
  id: string
  label: string | null
  line1: string
  line2: string | null
  city: string
  state: string
  postcode: string
  country: string
  is_default: boolean
}

const empty = { label: '', line1: '', line2: '', city: '', state: '', postcode: '', country: 'US', is_default: false }
const inputCls = 'rounded-md border border-brand-border px-2 py-1.5 text-sm'

// Member shipping address book — used by storefront checkout and reship.
export function AddressBook() {
  const [addresses, setAddresses] = useState<Address[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(empty)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const res = await fetch('/api/members/addresses')
    const json = await res.json().catch(() => ({}))
    setAddresses(json.addresses ?? [])
    setLoading(false)
  }
  useEffect(() => {
    load()
  }, [])

  const add = async () => {
    if (!form.line1 || !form.city || !form.state || !form.postcode) return
    setBusy(true)
    const res = await fetch('/api/members/addresses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setBusy(false)
    if (res.ok) {
      setForm(empty)
      setAdding(false)
      load()
    }
  }

  const remove = async (id: string) => {
    await fetch(`/api/members/addresses?id=${id}`, { method: 'DELETE' })
    load()
  }

  const makeDefault = async (id: string) => {
    await fetch('/api/members/addresses', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_default: true }),
    })
    load()
  }

  return (
    <div>
      <h2 className="mb-1 text-sm font-semibold text-brand-blue-dark">Shipping addresses</h2>
      <p className="mb-3 text-xs text-brand-muted-soft">Used for store orders and event merch reshipped to you.</p>

      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-brand-muted-soft" />
      ) : (
        <div className="space-y-2">
          {addresses.map((a) => (
            <div key={a.id} className="flex items-start justify-between rounded-lg border border-brand-border p-3 text-sm">
              <div>
                <div className="font-medium text-brand-blue-dark">
                  {a.label || 'Address'}
                  {a.is_default && (
                    <span className="ml-2 rounded bg-brand-blue/5 px-1.5 py-0.5 text-[11px] text-brand-blue">Default</span>
                  )}
                </div>
                <div className="text-brand-muted">
                  {a.line1}
                  {a.line2 ? `, ${a.line2}` : ''}, {a.city}, {a.state} {a.postcode}, {a.country}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!a.is_default && (
                  <button onClick={() => makeDefault(a.id)} className="text-brand-muted-soft hover:text-brand-blue" aria-label="Make default">
                    <Star className="h-4 w-4" />
                  </button>
                )}
                <button onClick={() => remove(a.id)} className="text-brand-muted-soft hover:text-red-600" aria-label="Delete address">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
          {addresses.length === 0 && <p className="text-sm text-brand-muted-soft">No saved addresses.</p>}
        </div>
      )}

      {adding ? (
        <div className="mt-3 grid gap-2 rounded-lg border border-brand-border p-3 sm:grid-cols-2">
          <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Label (Home)" className={inputCls + ' sm:col-span-2'} />
          <input value={form.line1} onChange={(e) => setForm({ ...form, line1: e.target.value })} placeholder="Address line 1" className={inputCls + ' sm:col-span-2'} />
          <input value={form.line2} onChange={(e) => setForm({ ...form, line2: e.target.value })} placeholder="Address line 2" className={inputCls + ' sm:col-span-2'} />
          <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="City" className={inputCls} />
          <input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} placeholder="State" className={inputCls} />
          <input value={form.postcode} onChange={(e) => setForm({ ...form, postcode: e.target.value })} placeholder="Postcode" className={inputCls} />
          <input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} placeholder="Country" className={inputCls} />
          <label className="flex items-center gap-2 text-sm text-brand-muted sm:col-span-2">
            <input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} />
            Set as default
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button onClick={add} disabled={busy} className="flex items-center gap-1 rounded-md bg-brand-blue px-3 py-1.5 text-sm text-white hover:bg-brand-blue-dark disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Save address
            </button>
            <button onClick={() => setAdding(false)} className="rounded-md border border-brand-border px-3 py-1.5 text-sm text-brand-muted hover:bg-brand-canvas">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="mt-3 flex items-center gap-1 rounded-md border border-brand-border px-3 py-1.5 text-sm text-brand-muted hover:bg-brand-canvas"
        >
          <Plus className="h-4 w-4" /> Add address
        </button>
      )}
    </div>
  )
}
