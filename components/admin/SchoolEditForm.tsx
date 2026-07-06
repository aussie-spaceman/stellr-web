'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type School = {
  id: string
  name: string
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  postcode: string | null
  is_active: boolean | null
}

// Inline edit card for a school's name, address and active flag. Read-only until
// the admin clicks Edit; PATCHes /api/admin/schools/[id] and refreshes on save.
export function SchoolEditForm({ school }: { school: School }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: school.name ?? '',
    address_line1: school.address_line1 ?? '',
    address_line2: school.address_line2 ?? '',
    city: school.city ?? '',
    state: school.state ?? '',
    postcode: school.postcode ?? '',
    is_active: school.is_active !== false,
  })

  const set = (key: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement>
  ) => setForm((f) => ({ ...f, [key]: key === 'is_active' ? e.target.checked : e.target.value }))

  const reset = () => {
    setForm({
      name: school.name ?? '',
      address_line1: school.address_line1 ?? '',
      address_line2: school.address_line2 ?? '',
      city: school.city ?? '',
      state: school.state ?? '',
      postcode: school.postcode ?? '',
      is_active: school.is_active !== false,
    })
    setError(null)
    setEditing(false)
  }

  const save = async () => {
    if (!form.name.trim()) { setError('School name is required.'); return }
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/admin/schools/${school.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || 'Could not save school.')
        return
      }
      setEditing(false)
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-brand-border overflow-hidden">
      <div className="px-5 py-4 border-b border-brand-hairline flex items-center justify-between">
        <h2 className="text-sm font-semibold text-brand-muted">School details</h2>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-xs font-semibold text-brand-blue hover:text-brand-blue-bright"
          >
            Edit
          </button>
        )}
      </div>

      <div className="px-5 py-4">
        {!editing ? (
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
            <Field label="Name" value={school.name} />
            <Field label="Status" value={school.is_active !== false ? 'Active' : 'Inactive'} />
            <Field label="Address line 1" value={school.address_line1} />
            <Field label="Address line 2" value={school.address_line2} />
            <Field label="City" value={school.city} />
            <Field label="State" value={school.state} />
            <Field label="Postcode" value={school.postcode} />
          </dl>
        ) : (
          <div className="space-y-3">
            <Input label="Name" value={form.name} onChange={set('name')} required />
            <Input label="Address line 1" value={form.address_line1} onChange={set('address_line1')} />
            <Input label="Address line 2" value={form.address_line2} onChange={set('address_line2')} />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Input label="City" value={form.city} onChange={set('city')} />
              <Input label="State" value={form.state} onChange={set('state')} />
              <Input label="Postcode" value={form.postcode} onChange={set('postcode')} />
            </div>
            <label className="flex items-center gap-2 text-sm text-brand-muted">
              <input type="checkbox" checked={form.is_active} onChange={set('is_active')} />
              Active — visible in search and selectable for new registrations
            </label>

            {error && <p className="text-xs text-red-600">{error}</p>}

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={save}
                disabled={busy || !form.name.trim()}
                className="rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-bright disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Save changes'}
              </button>
              <button onClick={reset} disabled={busy} className="px-2 py-2 text-sm text-brand-muted-soft hover:text-brand-muted">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-brand-muted-soft">{label}</dt>
      <dd className="text-sm text-brand-blue-dark">{value || <span className="text-brand-muted-soft">—</span>}</dd>
    </div>
  )
}

function Input({
  label, value, onChange, required,
}: {
  label: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  required?: boolean
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-brand-muted-soft">
        {label}{required && <span className="text-red-500"> *</span>}
      </span>
      <input
        value={value}
        onChange={onChange}
        className="mt-1 w-full rounded-md border border-brand-border px-3 py-2 text-sm focus:border-brand-blue focus:outline-none"
      />
    </label>
  )
}
