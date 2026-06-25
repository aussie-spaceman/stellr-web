'use client'

import { useState } from 'react'
import { Download, Pencil, Flag, ExternalLink, PlayCircle } from 'lucide-react'
import type { ResourceKind } from '@/lib/resources-catalogue'

interface Props {
  attachmentId: string
  initialName: string
  kind: ResourceKind
  canRename: boolean
}

// Interactive header for the resource detail page: the resolved name with an
// owner-only inline rename, the type-aware primary action (Download / Open /
// Watch) which re-checks the gate server-side, and the flag entry point.
export function ResourceDetailHeader({ attachmentId, initialName, kind, canRename }: Props) {
  const [name, setName] = useState(initialName)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(initialName)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const rename = async () => {
    const next = value.trim()
    if (!next) {
      setErr('Name cannot be empty')
      return
    }
    setSaving(true)
    setErr(null)
    const res = await fetch(`/api/community/resources/attachment/${attachmentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: next }),
    })
    setSaving(false)
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setErr(json.error ?? 'Rename failed')
      return
    }
    setName(next)
    setEditing(false)
  }

  const primary = async () => {
    setBusy(true)
    setErr(null)
    const res = await fetch(`/api/community/resources/attachment/${attachmentId}/download`)
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setErr(json.error ?? 'Could not open this resource')
      return
    }
    if (kind === 'file') {
      const a = document.createElement('a')
      a.href = json.url
      a.download = name
      a.rel = 'noopener noreferrer'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } else {
      window.open(json.url, '_blank', 'noopener,noreferrer')
    }
  }

  const actionLabel = kind === 'video' ? 'Watch' : kind === 'link' ? 'Open' : 'Download'
  const ActionIcon = kind === 'video' ? PlayCircle : kind === 'link' ? ExternalLink : Download

  return (
    <div>
      {editing ? (
        <div className="flex items-center gap-2">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={200}
            autoFocus
            className="min-w-0 flex-1 rounded border border-brand-border px-2 py-1 text-lg font-semibold focus:border-brand-blue-dark focus:outline-none"
          />
          <button
            onClick={rename}
            disabled={saving}
            className="rounded bg-brand-blue-dark px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={() => {
              setEditing(false)
              setValue(name)
              setErr(null)
            }}
            className="text-xs text-brand-muted-soft hover:text-brand-muted"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <h1 className="font-heading text-2xl text-brand-blue-dark">{name}</h1>
          {canRename && (
            <button onClick={() => setEditing(true)} title="Rename" className="text-brand-muted-soft hover:text-brand-blue-dark">
              <Pencil className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={primary}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-md bg-brand-blue-dark px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          <ActionIcon className="h-4 w-4" />
          {busy ? 'Preparing…' : actionLabel}
        </button>
        <a
          href={`#flag`}
          onClick={(e) => {
            e.preventDefault()
            document.getElementById('flag-section')?.scrollIntoView({ behavior: 'smooth' })
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-brand-border px-4 py-2 text-sm font-medium text-brand-muted hover:text-red-500"
        >
          <Flag className="h-4 w-4" />
          Report
        </a>
      </div>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
    </div>
  )
}
