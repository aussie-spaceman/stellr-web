'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Plus, Trash2, Download, Loader2 } from 'lucide-react'
import type { ProductType, StoreProductWithVariants, StoreVariant } from '@/lib/store/types'

const TYPES: ProductType[] = ['apparel', 'merch', 'sticker', 'digital']
const STATUSES = ['draft', 'active', 'archived'] as const

const dollars = (cents: number) => (cents / 100).toFixed(2)
const toCents = (v: string) => Math.max(0, Math.round((parseFloat(v) || 0) * 100))

export function ProductForm(props: {
  mode: 'create' | 'edit'
  product?: StoreProductWithVariants
  printfulEnabled?: boolean
}) {
  if (props.mode === 'create') return <CreateForm />
  return <EditForm product={props.product!} printfulEnabled={!!props.printfulEnabled} />
}

function CreateForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [type, setType] = useState<ProductType>('merch')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const create = async () => {
    if (!name.trim()) return
    setBusy(true)
    setError('')
    const res = await fetch('/api/admin/store/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), product_type: type }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setError(json.error || 'Could not create product')
      return
    }
    router.push(`/admin/store/${json.id}`)
  }

  return (
    <div className="max-w-md rounded-xl border border-brand-border bg-white p-5">
      <label className="mb-1 block text-sm font-medium text-brand-muted">Name</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="mb-4 w-full rounded-md border border-brand-border px-3 py-2 text-sm"
        placeholder="e.g. Stellr 2026 Event Tee"
      />
      <label className="mb-1 block text-sm font-medium text-brand-muted">Type</label>
      <select
        value={type}
        onChange={(e) => setType(e.target.value as ProductType)}
        className="mb-4 w-full rounded-md border border-brand-border px-3 py-2 text-sm capitalize"
      >
        {TYPES.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <button
        onClick={create}
        disabled={busy || !name.trim()}
        className="flex items-center gap-1 rounded-md bg-brand-blue px-4 py-2 text-sm text-white hover:bg-brand-blue-dark disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create product
      </button>
    </div>
  )
}

interface PrintfulOption {
  id: number
  name: string
  variants: number
}

function EditForm({ product, printfulEnabled }: { product: StoreProductWithVariants; printfulEnabled: boolean }) {
  const router = useRouter()
  const [details, setDetails] = useState({
    name: product.name,
    description: product.description ?? '',
    product_type: product.product_type,
    status: product.status,
    is_event_shirt: product.is_event_shirt,
    featured: product.featured,
  })
  const [variants, setVariants] = useState<StoreVariant[]>(product.variants ?? [])
  const [savedFlash, setSavedFlash] = useState(false)

  const saveDetails = async () => {
    await fetch(`/api/admin/store/products/${product.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(details),
    })
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 1500)
    router.refresh()
  }

  return (
    <div className="space-y-6">
      {/* Details */}
      <section className="rounded-xl border border-brand-border bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-brand-blue-dark">Details</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs text-brand-muted-soft">Name</label>
            <input
              value={details.name}
              onChange={(e) => setDetails({ ...details, name: e.target.value })}
              className="w-full rounded-md border border-brand-border px-3 py-2 text-sm"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs text-brand-muted-soft">Description</label>
            <textarea
              value={details.description}
              onChange={(e) => setDetails({ ...details, description: e.target.value })}
              rows={3}
              className="w-full rounded-md border border-brand-border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-brand-muted-soft">Type</label>
            <select
              value={details.product_type}
              onChange={(e) => setDetails({ ...details, product_type: e.target.value as ProductType })}
              className="w-full rounded-md border border-brand-border px-3 py-2 text-sm capitalize"
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-brand-muted-soft">Status</label>
            <select
              value={details.status}
              onChange={(e) => setDetails({ ...details, status: e.target.value as typeof details.status })}
              className="w-full rounded-md border border-brand-border px-3 py-2 text-sm capitalize"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-brand-muted">
            <input
              type="checkbox"
              checked={details.is_event_shirt}
              onChange={(e) => setDetails({ ...details, is_event_shirt: e.target.checked })}
            />
            Eligible as an event&apos;s included shirt
          </label>
          <label className="flex items-center gap-2 text-sm text-brand-muted">
            <input
              type="checkbox"
              checked={details.featured}
              onChange={(e) => setDetails({ ...details, featured: e.target.checked })}
            />
            Featured in storefront
          </label>
        </div>
        <button
          onClick={saveDetails}
          className="mt-4 flex items-center gap-1 rounded-md bg-brand-blue px-4 py-2 text-sm text-white hover:bg-brand-blue-dark"
        >
          {savedFlash ? <Check className="h-4 w-4" /> : null} {savedFlash ? 'Saved' : 'Save details'}
        </button>
      </section>

      {/* Variants */}
      <VariantsSection productId={product.id} variants={variants} setVariants={setVariants} />

      {/* Printful */}
      <PrintfulSection productId={product.id} enabled={printfulEnabled} linkedId={product.pod_sync_product_id} />
    </div>
  )
}

function VariantsSection({
  productId,
  variants,
  setVariants,
}: {
  productId: string
  variants: StoreVariant[]
  setVariants: (v: StoreVariant[]) => void
}) {
  const [newSku, setNewSku] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newPrice, setNewPrice] = useState('')

  const addVariant = async () => {
    if (!newSku.trim()) return
    const res = await fetch(`/api/admin/store/products/${productId}/variants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku: newSku.trim(), label: newLabel.trim() || null, market_price_cents: toCents(newPrice) }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return alert(json.error || 'Could not add variant')
    setVariants([
      ...variants,
      {
        id: json.id,
        product_id: productId,
        sku: newSku.trim(),
        label: newLabel.trim() || null,
        options: {},
        market_price_cents: toCents(newPrice),
        pod_sync_variant_id: null,
        inventory_qty: null,
        active: true,
      },
    ])
    setNewSku('')
    setNewLabel('')
    setNewPrice('')
  }

  const saveVariant = async (v: StoreVariant) => {
    await fetch(`/api/admin/store/products/${productId}/variants`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ variantId: v.id, sku: v.sku, label: v.label, market_price_cents: v.market_price_cents, active: v.active }),
    })
  }

  const removeVariant = async (id: string) => {
    await fetch(`/api/admin/store/products/${productId}/variants?variantId=${id}`, { method: 'DELETE' })
    setVariants(variants.filter((v) => v.id !== id))
  }

  const patch = (id: string, p: Partial<StoreVariant>) =>
    setVariants(variants.map((v) => (v.id === id ? { ...v, ...p } : v)))

  return (
    <section className="rounded-xl border border-brand-border bg-white p-5">
      <h2 className="mb-3 text-sm font-semibold text-brand-blue-dark">Variants</h2>
      <div className="space-y-2">
        {variants.map((v) => (
          <div key={v.id} className="flex flex-wrap items-center gap-2">
            <input
              value={v.sku}
              onChange={(e) => patch(v.id, { sku: e.target.value })}
              className="w-40 rounded-md border border-brand-border px-2 py-1 text-sm"
              placeholder="SKU"
            />
            <input
              value={v.label ?? ''}
              onChange={(e) => patch(v.id, { label: e.target.value })}
              className="w-40 rounded-md border border-brand-border px-2 py-1 text-sm"
              placeholder="Label (e.g. Black / L)"
            />
            <div className="flex items-center gap-1">
              <span className="text-sm text-brand-muted-soft">$</span>
              <input
                value={dollars(v.market_price_cents)}
                onChange={(e) => patch(v.id, { market_price_cents: toCents(e.target.value) })}
                className="w-24 rounded-md border border-brand-border px-2 py-1 text-sm"
                inputMode="decimal"
              />
            </div>
            {v.pod_sync_variant_id && <span className="text-[11px] text-brand-blue">Printful</span>}
            <button
              onClick={() => saveVariant(v)}
              className="rounded-md border border-brand-border px-2 py-1 text-xs text-brand-muted hover:bg-brand-canvas"
            >
              Save
            </button>
            <button onClick={() => removeVariant(v.id)} className="text-brand-muted-soft hover:text-red-600" aria-label="Delete variant">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        {variants.length === 0 && <p className="text-sm text-brand-muted-soft">No variants yet.</p>}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-brand-hairline pt-4">
        <input value={newSku} onChange={(e) => setNewSku(e.target.value)} placeholder="New SKU" className="w-40 rounded-md border border-brand-border px-2 py-1 text-sm" />
        <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Label" className="w-40 rounded-md border border-brand-border px-2 py-1 text-sm" />
        <div className="flex items-center gap-1">
          <span className="text-sm text-brand-muted-soft">$</span>
          <input value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="0.00" inputMode="decimal" className="w-24 rounded-md border border-brand-border px-2 py-1 text-sm" />
        </div>
        <button
          onClick={addVariant}
          disabled={!newSku.trim()}
          className="flex items-center gap-1 rounded-md bg-brand-blue-dark px-3 py-1 text-xs text-white hover:bg-brand-blue-dark disabled:opacity-50"
        >
          <Plus className="h-3 w-3" /> Add variant
        </button>
      </div>
    </section>
  )
}

function PrintfulSection({
  productId,
  enabled,
  linkedId,
}: {
  productId: string
  enabled: boolean
  linkedId: string | null
}) {
  const router = useRouter()
  const [options, setOptions] = useState<PrintfulOption[] | null>(null)
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  if (!enabled) {
    return (
      <section className="rounded-xl border border-brand-border bg-white p-5">
        <h2 className="mb-1 text-sm font-semibold text-brand-blue-dark">Printful</h2>
        <p className="text-sm text-brand-muted-soft">Printful is not configured in this environment.</p>
      </section>
    )
  }

  const load = async () => {
    setBusy(true)
    setMsg('')
    const res = await fetch('/api/admin/store/printful')
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) return setMsg(json.error || 'Could not load Printful products')
    setOptions(json.products ?? [])
  }

  const importVariants = async () => {
    if (!selected) return
    setBusy(true)
    setMsg('')
    const res = await fetch(`/api/admin/store/products/${productId}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ printfulSyncProductId: Number(selected) }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) return setMsg(json.error || 'Import failed')
    setMsg(`Imported ${json.imported} variant(s).`)
    router.refresh()
  }

  return (
    <section className="rounded-xl border border-brand-border bg-white p-5">
      <h2 className="mb-1 text-sm font-semibold text-brand-blue-dark">Printful</h2>
      <p className="mb-3 text-xs text-brand-muted-soft">
        {linkedId ? `Linked to Printful product ${linkedId}.` : 'Import variants from a Printful sync product.'}
      </p>
      {!options ? (
        <button
          onClick={load}
          disabled={busy}
          className="flex items-center gap-1 rounded-md border border-brand-border px-3 py-1.5 text-sm text-brand-muted hover:bg-brand-canvas disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Load Printful products
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="rounded-md border border-brand-border px-3 py-1.5 text-sm"
          >
            <option value="">Select a Printful product…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.variants})
              </option>
            ))}
          </select>
          <button
            onClick={importVariants}
            disabled={busy || !selected}
            className="flex items-center gap-1 rounded-md bg-brand-blue px-3 py-1.5 text-sm text-white hover:bg-brand-blue-dark disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Import variants
          </button>
        </div>
      )}
      {msg && <p className="mt-2 text-xs text-brand-muted">{msg}</p>}
    </section>
  )
}
