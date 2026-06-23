'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus, Pencil, Archive, ArchiveRestore, Settings2 } from 'lucide-react'

export interface SpaceRow {
  id: string
  slug: string
  name: string
  description: string | null
  min_tier_rank: number
  display_order: number
  is_archived: boolean
}

const emptyDraft = (): Partial<SpaceRow> => ({ name: '', description: '', min_tier_rank: 0, display_order: 0 })

// Dedicated Spaces admin (P3). Create / edit community Spaces and set who can see
// them (min_tier_rank: 0 = open to all members, 1 = paid tiers). Finer tier rules
// live in the Access map. Archiving hides a space without deleting its content.
export function SpacesManager({ initial }: { initial: SpaceRow[] }) {
  const [spaces, setSpaces] = useState<SpaceRow[]>(initial)
  const [draft, setDraft] = useState<Partial<SpaceRow> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    const res = await fetch('/api/admin/community/spaces')
    if (res.ok) setSpaces((await res.json()).spaces ?? [])
  }

  const save = async () => {
    if (!draft?.name?.trim()) return
    setBusy(true)
    setError(null)
    try {
      const isNew = !draft.id
      const res = await fetch('/api/admin/community/spaces', {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      if (res.ok) {
        setDraft(null)
        await refresh()
      } else {
        setError((await res.json().catch(() => ({}))).error ?? 'Could not save')
      }
    } finally {
      setBusy(false)
    }
  }

  const toggleArchive = async (s: SpaceRow) => {
    setSpaces((prev) => prev.map((x) => (x.id === s.id ? { ...x, is_archived: !x.is_archived } : x)))
    await fetch('/api/admin/community/spaces', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: s.id, is_archived: !s.is_archived }),
    })
  }

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button
          onClick={() => setDraft(emptyDraft())}
          className="flex items-center gap-1 rounded-md bg-brand-blue px-3 py-1.5 text-sm text-white hover:bg-brand-blue-dark"
        >
          <Plus className="h-4 w-4" /> New space
        </button>
      </div>

      <div className="space-y-2">
        {spaces.length === 0 && (
          <p className="py-8 text-center text-sm text-brand-muted-soft">No spaces yet.</p>
        )}
        {spaces.map((s) => (
          <div
            key={s.id}
            className={`flex items-center gap-3 rounded-xl border border-brand-border bg-white px-4 py-3 ${s.is_archived ? 'opacity-60' : ''}`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-brand-blue-dark">{s.name}</span>
                <span className="text-xs text-brand-muted-soft">/{s.slug}</span>
                {s.is_archived && (
                  <span className="rounded-full bg-brand-hairline px-2 py-0.5 text-[10px] uppercase text-brand-muted">archived</span>
                )}
              </div>
              {s.description && <p className="truncate text-xs text-brand-muted-soft">{s.description}</p>}
            </div>
            <span className="shrink-0 rounded-full bg-brand-blue/5 px-2 py-0.5 text-xs text-brand-blue">
              {s.min_tier_rank === 0 ? 'All members' : 'Paid tiers'}
            </span>
            <button onClick={() => setDraft(s)} title="Edit" className="text-brand-muted-soft hover:text-brand-blue-dark">
              <Pencil className="h-4 w-4" />
            </button>
            <button onClick={() => toggleArchive(s)} title={s.is_archived ? 'Restore' : 'Archive'} className="text-brand-muted-soft hover:text-brand-blue-dark">
              {s.is_archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
            </button>
            <Link
              href={`/admin/community/spaces/${s.id}`}
              title="Manage (announcements)"
              className="text-brand-muted-soft hover:text-brand-blue-dark"
            >
              <Settings2 className="h-4 w-4" />
            </Link>
          </div>
        ))}
      </div>

      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md space-y-3 rounded-xl bg-white p-5">
            <h2 className="font-semibold text-brand-blue-dark">{draft.id ? 'Edit space' : 'New space'}</h2>
            <Field label="Name">
              <input
                value={draft.name ?? ''}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="w-full rounded-md border border-brand-border px-2 py-1.5 text-sm"
              />
            </Field>
            {!draft.id && (
              <Field label="Slug (optional — derived from name)">
                <input
                  value={draft.slug ?? ''}
                  onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
                  placeholder="e.g. study-hall"
                  className="w-full rounded-md border border-brand-border px-2 py-1.5 text-sm"
                />
              </Field>
            )}
            <Field label="Description">
              <textarea
                value={draft.description ?? ''}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                rows={2}
                className="w-full rounded-md border border-brand-border px-2 py-1.5 text-sm"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Who can see it">
                <select
                  value={draft.min_tier_rank ?? 0}
                  onChange={(e) => setDraft({ ...draft, min_tier_rank: Number(e.target.value) })}
                  className="w-full rounded-md border border-brand-border px-2 py-1.5 text-sm"
                >
                  <option value={0}>All members</option>
                  <option value={1}>Paid tiers only</option>
                </select>
              </Field>
              <Field label="Display order">
                <input
                  type="number"
                  value={draft.display_order ?? 0}
                  onChange={(e) => setDraft({ ...draft, display_order: Number(e.target.value) })}
                  className="w-full rounded-md border border-brand-border px-2 py-1.5 text-sm"
                />
              </Field>
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button
                onClick={save}
                disabled={busy || !draft.name?.trim()}
                className="flex-1 rounded-md bg-brand-blue py-2 text-sm text-white hover:bg-brand-blue-dark disabled:opacity-40"
              >
                {draft.id ? 'Save changes' : 'Create space'}
              </button>
              <button
                onClick={() => setDraft(null)}
                className="flex-1 rounded-md border border-brand-border py-2 text-sm text-brand-muted hover:bg-brand-canvas"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-brand-muted-soft">{label}</label>
      {children}
    </div>
  )
}
