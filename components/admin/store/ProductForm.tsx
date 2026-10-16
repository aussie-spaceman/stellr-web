'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Plus, Trash2, Download, Loader2 } from 'lucide-react'
import { Choice, Field, Input, Select, Textarea } from '@stellr/web-ui'
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
      <Field label="Name" className="mb-4">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Stellr 2026 Event Tee"
        />
      </Field>
      <Field label="Type" className="mb-4">
        <Select value={type} onChange={(e) => setType(e.target.value as ProductType)} className="capitalize">
          {TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </Select>
      </Field>
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name" labelSize="small" className="sm:col-span-2">
            <Input value={details.name} onChange={(e) => setDetails({ ...details, name: e.target.value })} />
          </Field>
          <Field label="Description" labelSize="small" className="sm:col-span-2">
            <Textarea
              value={details.description}
              onChange={(e) => setDetails({ ...details, description: e.target.value })}
              rows={3}
            />
          </Field>
          <Field label="Type" labelSize="small">
            <Select
              value={details.product_type}
              onChange={(e) => setDetails({ ...details, product_type: e.target.value as ProductType })}
              className="capitalize"
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <Field label="Status" labelSize="small">
            <Select
              value={details.status}
              onChange={(e) => setDetails({ ...details, status: e.target.value as typeof details.status })}
              className="capitalize"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          </Field>
          <Choice
            label="Eligible as an event's included shirt"
            checked={details.is_event_shirt}
            onChange={(e) => setDetails({ ...details, is_event_shirt: e.target.checked })}
          />
          <Choice
            label="Featured in storefront"
            checked={details.featured}
            onChange={(e) => setDetails({ ...details, featured: e.target.checked })}
          />
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
        {/* A row of compact fields: each one is named by aria-label, numbered by row. */}
        {variants.map((v, i) => (
          <div key={v.id} className="flex flex-wrap items-center gap-2">
            <div className="w-40">
              <Input
                value={v.sku}
                onChange={(e) => patch(v.id, { sku: e.target.value })}
                placeholder="SKU"
                aria-label={`Variant ${i + 1} SKU`}
              />
            </div>
            <div className="w-40">
              <Input
                value={v.label ?? ''}
                onChange={(e) => patch(v.id, { label: e.target.value })}
                placeholder="Label (e.g. Black / L)"
                aria-label={`Variant ${i + 1} label`}
              />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-sm text-brand-muted-soft" aria-hidden="true">$</span>
              <div className="w-24">
                <Input
                  value={dollars(v.market_price_cents)}
                  onChange={(e) => patch(v.id, { market_price_cents: toCents(e.target.value) })}
                  inputMode="decimal"
                  aria-label={`Variant ${i + 1} price in dollars`}
                />
              </div>
            </div>
            {v.pod_sync_variant_id && <span className="text-xs text-brand-blue">Printful</span>}
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
        <div className="w-40">
          <Input value={newSku} onChange={(e) => setNewSku(e.target.value)} placeholder="New SKU" aria-label="New variant SKU" />
        </div>
        <div className="w-40">
          <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Label" aria-label="New variant label" />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-sm text-brand-muted-soft" aria-hidden="true">$</span>
          <div className="w-24">
            <Input value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="0.00" inputMode="decimal" aria-label="New variant price in dollars" />
          </div>
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
          <div className="w-full sm:w-72">
            <Select value={selected} onChange={(e) => setSelected(e.target.value)} aria-label="Printful product">
              <option value="">Select a Printful product…</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} ({o.variants})
                </option>
              ))}
            </Select>
          </div>
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
