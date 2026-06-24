'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Trash2 } from 'lucide-react'

// Binary-level edit + delete for the central resource index (handover §4.6).
// Delete cascades to every attachment behind a confirm that names each object the
// binary disappears from.
export function AdminBinaryActions({
  binaryId,
  title,
  attachedObjects,
}: {
  binaryId: string
  title: string
  attachedObjects: string[]
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(title)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const rename = async () => {
    const next = value.trim()
    if (!next || next === title) {
      setEditing(false)
      return
    }
    setBusy(true)
    const res = await fetch('/api/admin/community/resources', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: binaryId, title: next }),
    })
    setBusy(false)
    if (res.ok) {
      setEditing(false)
      router.refresh()
    }
  }

  const del = async () => {
    setBusy(true)
    const res = await fetch(`/api/admin/community/resources?id=${binaryId}`, { method: 'DELETE' })
    setBusy(false)
    if (res.ok) {
      setConfirming(false)
      router.refresh()
    }
  }

  if (editing) {
    return (
      <div className="flex items-center justify-end gap-1.5">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={200}
          autoFocus
          className="w-44 rounded border border-brand-border px-2 py-1 text-xs focus:border-brand-blue-dark focus:outline-none"
        />
        <button onClick={rename} disabled={busy} className="rounded bg-brand-blue-dark px-2 py-1 text-xs font-medium text-white disabled:opacity-50">
          Save
        </button>
        <button onClick={() => { setEditing(false); setValue(title) }} className="text-xs text-brand-muted-soft hover:text-brand-muted">
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <button onClick={() => setEditing(true)} title="Rename" className="text-brand-muted-soft hover:text-brand-blue-dark">
        <Pencil className="h-4 w-4" />
      </button>
      <button onClick={() => setConfirming(true)} title="Delete" className="text-brand-muted-soft hover:text-red-600">
        <Trash2 className="h-4 w-4" />
      </button>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6">
            <h3 className="font-heading text-lg text-brand-blue-dark">Delete this resource?</h3>
            <p className="mt-2 text-sm text-brand-muted">
              “{title}” will be permanently deleted, including its stored file. It will disappear from
              {attachedObjects.length === 0 ? ' (no objects — not attached anywhere)' : ':'}
            </p>
            {attachedObjects.length > 0 && (
              <ul className="mt-2 max-h-40 list-disc space-y-0.5 overflow-y-auto pl-5 text-sm text-brand-muted">
                {attachedObjects.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            )}
            <div className="mt-5 flex items-center justify-end gap-3">
              <button onClick={() => setConfirming(false)} className="text-sm font-medium text-brand-muted-soft hover:text-brand-muted">
                Cancel
              </button>
              <button onClick={del} disabled={busy} className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
                {busy ? 'Deleting…' : 'Delete everywhere'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
