'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Link2, Upload, Search, Users, AlertTriangle } from 'lucide-react'

// Manager "Add a resource" form (handover §4.5). Lives in the manager workspace,
// scoped to one object the user manages. Uploads target the OBJECT — a new
// container_contents row — and dedup runs on submit: a match the member can reach
// soft-warns and offers attach-by-reference (never a hard block). Visibility is
// inherited from the container and shown read-only — the uploader doesn't choose it.

type Tab = 'file' | 'link'

interface DuplicateMatch {
  binaryId: string
  title: string
  fileType: string | null
}

export function AddResourceForm({
  containerId,
  objectName,
  visibility,
}: {
  containerId: string
  objectName: string
  visibility?: 'open' | 'private' | 'secret'
}) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('file')
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dup, setDup] = useState<DuplicateMatch | null>(null)

  // Attach-from-library search.
  const [searchOpen, setSearchOpen] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<{ id: string; title: string; fileType: string | null }[]>([])

  const done = () => {
    setFile(null)
    setUrl('')
    setName('')
    setDup(null)
    router.refresh()
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      let res: Response
      if (tab === 'file') {
        if (!file) {
          setError('Choose a file')
          return
        }
        const form = new FormData()
        form.append('containerId', containerId)
        form.append('file', file)
        form.append('displayName', name)
        res = await fetch('/api/community/resources/contribute', { method: 'POST', body: form })
      } else {
        if (!url.trim()) {
          setError('Enter a URL')
          return
        }
        res = await fetch('/api/community/resources/contribute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ containerId, action: 'addLink', url, displayName: name }),
        })
      }
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error ?? 'Could not add resource')
        return
      }
      if (json.duplicate) {
        setDup(json.duplicate as DuplicateMatch)
        return
      }
      done()
    } finally {
      setBusy(false)
    }
  }

  const attachExisting = async (binaryId: string, displayName?: string) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/community/resources/contribute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ containerId, action: 'attachExisting', binaryId, displayName }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setError(json.error ?? 'Could not attach')
        return
      }
      setSearchOpen(false)
      done()
    } finally {
      setBusy(false)
    }
  }

  const search = async (term: string) => {
    setQ(term)
    const res = await fetch(
      `/api/community/resources/contribute?containerId=${containerId}&q=${encodeURIComponent(term)}`,
    )
    if (res.ok) setResults((await res.json()).results ?? [])
  }

  return (
    <div className="rounded-card border border-line bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-[16px] font-bold text-ink">Add a resource</h2>
        <button
          onClick={() => {
            setSearchOpen((v) => !v)
            if (!searchOpen) search('')
          }}
          className="rounded-[9px] bg-primary-soft px-3.5 py-2 text-[13px] font-semibold text-primary hover:bg-primary/15"
        >
          Attach from library
        </button>
      </div>

      {/* Inherited-visibility banner (read-only) */}
      <div className="mb-4 flex items-center gap-2 rounded-[10px] bg-space-violet/8 px-3 py-2 text-[13px] text-space-violet">
        <Users className="h-4 w-4 shrink-0" />
        <span>
          Visibility is inherited from <strong>{objectName}</strong>
          {visibility ? ` (${visibility})` : ''} — everyone on its roster can open what you add here.
        </span>
      </div>

      {/* File / Link tabs */}
      <div className="mb-3 inline-flex rounded-[9px] border border-line p-0.5">
        {(['file', 'link'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-[13px] font-medium ${
              tab === t ? 'bg-primary text-white' : 'text-content-secondary hover:text-ink'
            }`}
          >
            {t === 'file' ? <FileText className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
            {t === 'file' ? 'File' : 'Link'}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {tab === 'file' ? (
          <label className="flex cursor-pointer items-center gap-3 rounded-[10px] border border-dashed border-line bg-surface px-4 py-5 text-sm text-content-muted hover:border-primary">
            <Upload className="h-5 w-5 text-content-faint" />
            {file ? <span className="font-medium text-ink">{file.name}</span> : <span>Choose a file to upload…</span>}
            <input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
        ) : (
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            className="w-full rounded-[9px] border border-line px-3 py-2 text-sm outline-none focus:border-primary"
          />
        )}

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Display name (optional)"
          maxLength={200}
          className="w-full rounded-[9px] border border-line px-3 py-2 text-sm outline-none focus:border-primary"
        />

        {error && <p className="text-[13px] text-danger">{error}</p>}

        <button
          onClick={submit}
          disabled={busy}
          className="rounded-[9px] bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-deep disabled:opacity-50"
        >
          {busy ? 'Adding…' : `Add to ${objectName}`}
        </button>
      </div>

      {/* Attach-from-library search */}
      {searchOpen && (
        <div className="mt-4 rounded-[12px] bg-surface p-3">
          <div className="flex items-center gap-2 rounded-[9px] border border-line bg-white px-3 py-2">
            <Search className="h-4 w-4 text-content-faint" />
            <input
              value={q}
              onChange={(e) => search(e.target.value)}
              placeholder="Search the resource library…"
              className="flex-1 text-sm outline-none"
            />
          </div>
          <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
            {results.length === 0 && <li className="px-2 py-2 text-[13px] text-content-muted">No resources found.</li>}
            {results.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 rounded-[8px] px-2 py-1.5 hover:bg-white">
                <span className="flex items-center gap-2 text-sm text-content-body">
                  <FileText className="h-4 w-4 text-content-faint" /> {r.title}
                </span>
                <button
                  onClick={() => attachExisting(r.id)}
                  disabled={busy}
                  className="rounded-[8px] bg-space-violet px-3 py-1 text-[12.5px] font-semibold text-white disabled:opacity-50"
                >
                  Attach
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Dedup soft-warn modal */}
      {dup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-card bg-white p-6">
            <div className="mb-3 flex items-center gap-2 text-pathway-amber">
              <AlertTriangle className="h-5 w-5" />
              <h3 className="font-display text-[17px] font-bold text-ink">This already exists</h3>
            </div>
            <p className="text-sm text-content-secondary">
              “{dup.title}” is already in the library. Attach the existing file instead of storing another copy —
              updates and removals stay in sync, and you don’t grow storage.
            </p>
            <div className="mt-5 flex items-center justify-end gap-3">
              <button onClick={() => setDup(null)} className="text-sm font-medium text-content-muted hover:text-ink">
                Cancel
              </button>
              <button
                onClick={() => attachExisting(dup.binaryId, name)}
                disabled={busy}
                className="rounded-[9px] bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-deep disabled:opacity-50"
              >
                Attach the existing file
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
