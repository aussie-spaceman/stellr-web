'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, FileText, Link2, Upload, X, Search } from 'lucide-react'

// Per-lesson attached resources (files / links) shown beneath the lesson's
// primary content on the member Course detail. Admin add/remove in the builder.

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

export function LessonResources({ itemId }: { itemId: string }) {
  const [resources, setResources] = useState<Resource[]>([])
  const [adding, setAdding] = useState(false)
  const [mode, setMode] = useState<'link' | 'file' | 'existing'>('link')
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [catalogue, setCatalogue] = useState<CatalogueResult[]>([])
  const [searching, setSearching] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/community/training/resources?itemId=${itemId}`)
    if (res.ok) setResources((await res.json()).resources)
  }, [itemId])
  useEffect(() => { load() }, [load])

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

  const attachExisting = async (resourceId: string) => {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/community/training/resources', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, kind: 'existing', resourceId }),
      })
      if (res.ok) { setAdding(false); setQuery(''); setCatalogue([]); load() }
    } finally {
      setBusy(false)
    }
  }

  const add = async () => {
    if (!title.trim()) return
    setBusy(true)
    try {
      let res: Response
      if (mode === 'file') {
        if (!file) { setBusy(false); return }
        const fd = new FormData()
        fd.set('itemId', itemId)
        fd.set('kind', 'file')
        fd.set('title', title.trim())
        fd.set('file', file)
        res = await fetch('/api/admin/community/training/resources', { method: 'POST', body: fd })
      } else {
        if (!url.trim()) { setBusy(false); return }
        res = await fetch('/api/admin/community/training/resources', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemId, kind: 'link', title: title.trim(), externalUrl: url.trim() }),
        })
      }
      if (res.ok) { setTitle(''); setUrl(''); setFile(null); setAdding(false); load() }
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setResources((prev) => prev.filter((r) => r.id !== id))
    await fetch(`/api/admin/community/training/resources?id=${id}`, { method: 'DELETE' })
  }

  return (
    <div className="rounded-xl border border-brand-border p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-brand-muted-soft">Attached resources</p>
      <div className="space-y-1.5">
        {resources.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-2 rounded-md border border-brand-hairline px-3 py-2 text-sm">
            <span className="flex min-w-0 items-center gap-2 text-brand-muted">
              {r.kind === 'file' ? <FileText className="h-4 w-4 shrink-0 text-brand-muted-soft" /> : <Link2 className="h-4 w-4 shrink-0 text-brand-muted-soft" />}
              <span className="truncate">{r.title}</span>
            </span>
            <button onClick={() => remove(r.id)} className="shrink-0 text-brand-muted-soft hover:text-red-500" aria-label="Remove resource"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        ))}
        {resources.length === 0 && !adding && <p className="text-xs text-brand-muted-soft">No resources attached.</p>}
      </div>

      {adding ? (
        <div className="mt-2 space-y-2 rounded-md border border-brand-border p-2">
          <div className="flex items-center gap-1">
            {(['link', 'file', 'existing'] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} className={`rounded-md px-2.5 py-1 text-xs font-semibold ${mode === m ? 'bg-brand-soft text-brand-blue-dark' : 'text-brand-muted-soft'}`} style={mode === m ? { background: '#EAF0FE' } : undefined}>
                {m === 'link' ? 'Link' : m === 'file' ? 'File' : 'Existing'}
              </button>
            ))}
            <button onClick={() => setAdding(false)} className="ml-auto text-brand-muted-soft hover:text-brand-muted"><X className="h-3.5 w-3.5" /></button>
          </div>
          {mode === 'existing' ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 rounded-md border border-brand-border px-2.5 py-1.5">
                <Search className="h-3.5 w-3.5 text-brand-muted-soft" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search existing resources…" autoFocus className="w-full text-sm focus:outline-none" />
              </div>
              <div className="max-h-44 overflow-y-auto rounded-md border border-brand-hairline">
                {searching && <p className="px-2.5 py-2 text-xs text-brand-muted-soft">Searching…</p>}
                {!searching && catalogue.length === 0 && <p className="px-2.5 py-2 text-xs text-brand-muted-soft">No matching resources.</p>}
                {catalogue.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => attachExisting(r.id)}
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
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="w-full rounded-md border border-brand-border px-2.5 py-1.5 text-sm" />
              {mode === 'link' ? (
                <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="w-full rounded-md border border-brand-border px-2.5 py-1.5 text-sm" />
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
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="mt-2 inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold text-brand-muted-soft hover:bg-brand-hairline hover:text-brand-blue-dark">
          <Plus className="h-3.5 w-3.5" /> Add resource
        </button>
      )}
    </div>
  )
}
