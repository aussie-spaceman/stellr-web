'use client'

import { useState, useEffect, useCallback } from 'react'
import { postUpload, uploadDirectToStorage } from '@/lib/upload-client'
import { Plus, Trash2, FileText, Link2, Upload, X, Search } from 'lucide-react'

// Per-lesson attached resources (files / links) shown beneath the lesson's
// primary content on the member Course detail. Admin add/remove in the builder.
//
// A lesson that has not been created yet has no id to attach to, so in that case
// the panel holds what the admin picks (`pending`), and the editor attaches it
// with attachPendingResources once the lesson exists. A file stays in the browser
// until then, so cancelling the new lesson leaves nothing behind in storage.

const RESOURCES_API = '/api/admin/community/training/resources'

interface Resource {
  id: string
  kind: 'file' | 'link'
  title: string
  external_url: string | null
}

interface CatalogueResult {
  id: string
  title: string
  fileType: string | null
  sizeBytes: number | null
}

export type PendingResource =
  | { key: string; kind: 'link'; title: string; url: string }
  | { key: string; kind: 'file'; title: string; file: File }
  | { key: string; kind: 'existing'; title: string; resourceId: string }

const postResource = (itemId: string, body: Record<string, unknown>) =>
  postUpload(RESOURCES_API, JSON.stringify({ itemId, ...body }), {
    headers: { 'Content-Type': 'application/json' },
  })

/** Attach what was picked before the lesson existed. Returns the titles that failed. */
export async function attachPendingResources(itemId: string, pending: PendingResource[]): Promise<string[]> {
  const failed: string[] = []
  for (const p of pending) {
    let body: Record<string, unknown>
    if (p.kind === 'file') {
      const stored = await uploadDirectToStorage(p.file, 'training-item-resource')
      if ('error' in stored) { failed.push(p.title); continue }
      body = { kind: 'file', title: p.title, storagePath: stored.storagePath, fileType: stored.fileType }
    } else if (p.kind === 'existing') {
      body = { kind: 'existing', resourceId: p.resourceId }
    } else {
      body = { kind: 'link', title: p.title, externalUrl: p.url }
    }
    const result = await postResource(itemId, body)
    if ('error' in result) failed.push(p.title)
  }
  return failed
}

export function LessonResources({
  itemId,
  pending = [],
  onPendingChange,
  onCountChange,
}: {
  /** Absent for a lesson not created yet: picks go to `pending` instead. */
  itemId?: string
  pending?: PendingResource[]
  onPendingChange?: (next: PendingResource[]) => void
  /** How many resources a saved lesson has attached, as they load and change. */
  onCountChange?: (count: number) => void
}) {
  const [resources, setResources] = useState<Resource[]>([])
  const [adding, setAdding] = useState(false)
  const [mode, setMode] = useState<'link' | 'file' | 'existing'>('link')
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [catalogue, setCatalogue] = useState<CatalogueResult[]>([])
  const [searching, setSearching] = useState(false)

  const load = useCallback(async () => {
    if (!itemId) return
    const res = await fetch(`${RESOURCES_API}?itemId=${itemId}`)
    if (res.ok) setResources((await res.json()).resources)
  }, [itemId])
  useEffect(() => { load() }, [load])
  useEffect(() => { if (itemId) onCountChange?.(resources.length) }, [itemId, resources.length, onCountChange])

  // Search the Global Resources Catalogue (debounced) when in "existing" mode.
  useEffect(() => {
    if (mode !== 'existing' || !adding) return
    let active = true
    setSearching(true)
    const t = setTimeout(async () => {
      const res = await fetch(`/api/admin/community/resources/search?q=${encodeURIComponent(query)}`)
      if (!active) return
      const d = res.ok ? await res.json() : { results: [] }
      if (active) { setCatalogue(d.results ?? []); setSearching(false) }
    }, 250)
    return () => { active = false; clearTimeout(t) }
  }, [query, mode, adding])

  const keep = (p: PendingResource) => onPendingChange?.([...pending, p])
  const newKey = () => `${Date.now()}-${pending.length}`

  const attachExisting = async (resourceId: string, resourceTitle: string) => {
    if (!itemId) {
      keep({ key: newKey(), kind: 'existing', title: resourceTitle, resourceId })
      setAdding(false); setQuery(''); setCatalogue([])
      return
    }
    setBusy(true)
    setError(null)
    try {
      // Every failure comes back as a message (postUpload), and is shown: a refused
      // upload must not look like nothing happened.
      const result = await postResource(itemId, { kind: 'existing', resourceId })
      if ('error' in result) return setError(result.error)
      setAdding(false); setQuery(''); setCatalogue([]); load()
    } finally {
      setBusy(false)
    }
  }

  const add = async () => {
    if (!title.trim()) return
    if (mode === 'file' && !file) return setError('Choose a file to upload.')
    if (mode === 'link' && !url.trim()) return setError('Add a URL for this resource.')
    setError(null)
    const reset = () => { setTitle(''); setUrl(''); setFile(null); setAdding(false) }
    if (!itemId) {
      keep(mode === 'file'
        ? { key: newKey(), kind: 'file', title: title.trim(), file: file as File }
        : { key: newKey(), kind: 'link', title: title.trim(), url: url.trim() })
      reset()
      return
    }
    setBusy(true)
    try {
      let result: Awaited<ReturnType<typeof postResource>>
      if (mode === 'file') {
        // Bytes go browser → storage via a signed URL; only the path is posted.
        const stored = await uploadDirectToStorage(file as File, 'training-item-resource')
        if ('error' in stored) return setError(stored.error)
        result = await postResource(itemId, { kind: 'file', title: title.trim(), storagePath: stored.storagePath, fileType: stored.fileType })
      } else {
        result = await postResource(itemId, { kind: 'link', title: title.trim(), externalUrl: url.trim() })
      }
      if ('error' in result) return setError(result.error)
      reset(); load()
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setResources((prev) => prev.filter((r) => r.id !== id))
    await fetch(`${RESOURCES_API}?id=${id}`, { method: 'DELETE' })
  }

  const rows = itemId
    ? resources.map((r) => ({ key: r.id, isLink: r.kind === 'link', title: r.title, onRemove: () => remove(r.id) }))
    : pending.map((p) => ({
        key: p.key,
        isLink: p.kind === 'link',
        title: p.title,
        onRemove: () => onPendingChange?.(pending.filter((x) => x.key !== p.key)),
      }))

  return (
    <div className="rounded-xl border border-brand-border p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-muted-soft">Attached resources</p>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center justify-between gap-2 rounded-md border border-brand-hairline px-3 py-2 text-sm">
            <span className="flex min-w-0 items-center gap-2 text-brand-muted">
              {r.isLink ? <Link2 className="h-4 w-4 shrink-0 text-brand-muted-soft" /> : <FileText className="h-4 w-4 shrink-0 text-brand-muted-soft" />}
              <span className="truncate">{r.title}</span>
            </span>
            <button onClick={r.onRemove} className="shrink-0 text-brand-muted-soft hover:text-red-500" aria-label="Remove resource"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ))}
        {rows.length === 0 && !adding && <p className="text-xs text-brand-muted-soft">No resources attached.</p>}
        {!itemId && rows.length > 0 && <p className="text-xs text-brand-muted-soft">These attach when you add the lesson.</p>}
      </div>

      {adding ? (
        <div className="mt-2 space-y-2 rounded-md border border-brand-border p-2">
          <div className="flex items-center gap-1">
            {(['link', 'file', 'existing'] as const).map((m) => (
              <button key={m} onClick={() => { setMode(m); setError(null) }} className={`rounded-md px-2.5 py-1 text-xs font-semibold ${mode === m ? 'bg-brand-soft text-brand-blue-dark' : 'text-brand-muted-soft'}`} style={mode === m ? { background: '#EAF0FE' } : undefined}>
                {m === 'link' ? 'Link' : m === 'file' ? 'File' : 'Existing'}
              </button>
            ))}
            <button onClick={() => { setAdding(false); setError(null) }} className="ml-auto text-brand-muted-soft hover:text-brand-muted"><X className="h-3.5 w-3.5" /></button>
          </div>
          {mode === 'existing' ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 rounded-md border border-brand-border px-2.5 py-1.5">
                <Search className="h-3.5 w-3.5 text-brand-muted-soft" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search existing resources…" autoFocus className="w-full text-input mouse:text-sm focus:outline-hidden" />
              </div>
              <div className="max-h-44 overflow-y-auto rounded-md border border-brand-hairline">
                {searching && <p className="px-2.5 py-2 text-xs text-brand-muted-soft">Searching…</p>}
                {!searching && catalogue.length === 0 && <p className="px-2.5 py-2 text-xs text-brand-muted-soft">No matching resources.</p>}
                {catalogue.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => attachExisting(r.id, r.title)}
                    disabled={busy}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-brand-canvas disabled:opacity-50"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-brand-muted-soft" />
                    <span className="min-w-0 flex-1 truncate text-brand-blue-dark">{r.title}</span>
                    <Plus className="h-3.5 w-3.5 shrink-0 text-brand-muted-soft" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="w-full rounded-md border border-line-strong px-2.5 py-1.5 text-input mouse:text-sm" />
              {mode === 'link' ? (
                <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="w-full rounded-md border border-line-strong px-2.5 py-1.5 text-input mouse:text-sm" />
              ) : (
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-brand-border px-2.5 py-1.5 text-sm text-brand-muted hover:bg-brand-canvas">
                  <Upload className="h-4 w-4" /> {file ? file.name : 'Choose file'}
                  <input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </label>
              )}
              <button onClick={add} disabled={busy || !title.trim()} className="rounded-md bg-brand-blue px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                {busy ? 'Adding…' : 'Add resource'}
              </button>
            </>
          )}
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="mt-2 inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold text-brand-muted-soft hover:bg-brand-hairline hover:text-brand-blue-dark">
          <Plus className="h-3.5 w-3.5" /> Add resource
        </button>
      )}
    </div>
  )
}
