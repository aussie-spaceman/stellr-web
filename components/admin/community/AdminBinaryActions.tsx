'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Trash2 } from 'lucide-react'
import { Dialog } from '@stellr/web-ui'

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
          className="w-44 rounded border border-line-strong px-2 py-1 text-input mouse:text-xs focus:border-brand-blue-dark focus:outline-none"
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

  const iconButton =
    'inline-flex min-h-11 min-w-11 items-center justify-center rounded-control text-brand-muted-soft hover:bg-surface'

  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Rename"
        aria-label={`Rename ${title}`}
        className={`${iconButton} hover:text-brand-blue-dark`}
      >
        <Pencil className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        title="Delete"
        aria-label={`Delete ${title}`}
        className={`${iconButton} hover:text-danger`}
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </button>

      {/* Not ConfirmDialog: its description is a single paragraph, and this one
          lists every object the file disappears from. */}
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Delete this resource?"
        description={
          <>
            “{title}” will be permanently deleted, including its stored file. It will disappear from
            {attachedObjects.length === 0 ? ' (no objects — not attached anywhere)' : ':'}
          </>
        }
        role="alertdialog"
        size="md"
        dismissible={!busy}
        footer={
          <>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="min-h-11 rounded-control px-4 text-sm font-semibold text-content-secondary hover:bg-surface disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={del}
              disabled={busy}
              className="min-h-11 rounded-control bg-danger px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Deleting…' : 'Delete everywhere'}
            </button>
          </>
        }
      >
        {attachedObjects.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-brand-muted">
            {attachedObjects.map((o, i) => (
              <li key={i}>{o}</li>
            ))}
          </ul>
        )}
      </Dialog>
    </div>
  )
}
