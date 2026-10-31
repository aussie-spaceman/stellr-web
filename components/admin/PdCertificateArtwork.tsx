'use client'

import { useEffect, useState } from 'react'
import { DEFAULT_PD_LAYOUT, PD_FIELDS, type FieldPlacement, type PdField, type PdLayout } from '@/lib/pd-certificate-layout'
import { postUpload, uploadDirectToStorage } from '@/lib/upload-client'
import { ARTWORK_THEME_LABEL, type ArtworkTheme } from '@/lib/artwork-theme'

// The educator PD certificate's artwork: upload the front and back pages, then
// position the four fields on the front with a live preview (the same pattern
// as the award certificates' "Position the name"). Admins only.
// Two scopes (30 Oct 2026): without `eventSlug`, a theme's default — one design
// for every event of that theme (Space, Environmental), on Competitions →
// Default artwork; with it, one event's own pages, each standing in for the
// theme's. Design: docs/PLAN-educator-pd-2026-10-07.md §8.

type Pages = { front: string | null; back: string | null }

const PAGE_LABEL = { front: 'Front (the fields are drawn on this)', back: 'Back (printed as is)' } as const

const FIELD_LABEL: Record<PdField, string> = {
  name: 'Teacher name',
  location: 'Event location',
  date: 'Event date',
  hours: 'Hours of effort',
}

export default function PdCertificateArtwork({ theme, eventSlug }: { theme: ArtworkTheme; eventSlug?: string }) {
  const themeLabel = ARTWORK_THEME_LABEL[theme]
  const scope = `theme=${theme}${eventSlug ? `&event=${encodeURIComponent(eventSlug)}` : ''}`
  const [pages, setPages] = useState<Pages | null>(null)
  const [defaults, setDefaults] = useState<Pages | null>(null)
  const [layout, setLayout] = useState<PdLayout | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null)
  const [positioning, setPositioning] = useState(false)

  async function load() {
    const res = await fetch(`/api/admin/pd-certificate?${scope}`)
    if (!res.ok) { setMsg({ text: 'Could not load the certificate artwork.', error: true }); return }
    const d = (await res.json()) as { pages: Pages; layout: PdLayout; defaults: Pages | null }
    setPages(d.pages)
    setDefaults(d.defaults)
    setLayout(d.layout)
  }
  useEffect(() => { void load() }, [scope]) // eslint-disable-line react-hooks/exhaustive-deps

  async function upload(page: 'front' | 'back', file: File) {
    setBusy(page); setMsg(null)
    try {
      // Bytes go browser → storage via a signed URL; only the path is posted.
      const stored = await uploadDirectToStorage(file, 'pd-certificate-artwork')
      if ('error' in stored) { setMsg({ text: stored.error, error: true }); return }
      const result = await postUpload('/api/admin/pd-certificate', JSON.stringify({ theme, event: eventSlug, page, storagePath: stored.storagePath }), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
      })
      if ('error' in result) { setMsg({ text: result.error, error: true }); return }
      setMsg({ text: page === 'front' ? 'Front saved. Check where the fields land.' : 'Back saved.' })
      await load()
      if (page === 'front') setPositioning(true)
    } finally { setBusy(null) }
  }

  async function remove(page: 'front' | 'back') {
    setBusy(page); setMsg(null)
    try {
      const res = await fetch(`/api/admin/pd-certificate?${scope}&page=${page}`, { method: 'DELETE' })
      if (!res.ok) { setMsg({ text: 'Could not remove that page.', error: true }); return }
      setMsg({ text: defaults?.[page] ? `Back to the ${themeLabel} default ${page}.` : `This event’s ${page} removed.` })
      if (page === 'front') setPositioning(false)
      await load()
    } finally { setBusy(null) }
  }

  if (!pages || !layout) return msg ? <p className="text-xs text-red-600">{msg.text}</p> : null

  const status = (page: 'front' | 'back') =>
    pages[page]
      ? `${eventSlug ? 'this event’s own, ' : ''}uploaded ${new Date(pages[page]!).toLocaleDateString()}`
      : defaults?.[page]
        ? `uses the ${themeLabel} default`
        : 'not uploaded'

  return (
    <div className="border-t border-brand-hairline pt-4 space-y-3">
      <div>
        <h4 className="text-xs font-semibold text-brand-muted">
          {eventSlug ? 'Certificate artwork' : `Certificate artwork — ${themeLabel} events`}
        </h4>
        <p className="text-xs text-brand-muted-soft mt-1">
          {eventSlug
            ? `Each page prints the ${themeLabel} default unless you upload this event’s own. With no front at all, these certificates use the plain Stellr design.`
            : `One design for every ${themeLabel} event that does not upload its own. Until a front is uploaded, these certificates use the plain Stellr design. Replacing a page keeps events that have already issued PD certificates on the page they were issued with.`}
          {eventSlug && (
            <>
              {' '}
              <a href={`/admin/competitions/artwork?theme=${theme}`} className="underline hover:text-brand-muted">
                Change the {themeLabel} default
              </a>
            </>
          )}
        </p>
      </div>
      {msg && <p className={`text-xs ${msg.error ? 'text-red-600' : 'text-green-700'}`}>{msg.text}</p>}
      <ul className="space-y-2">
        {(['front', 'back'] as const).map((page) => (
          <li key={page} className="flex flex-wrap items-center gap-3 text-xs text-brand-muted-soft">
            <span className="text-brand-blue-dark font-medium w-64">{PAGE_LABEL[page]}</span>
            <span>{status(page)}</span>
            <label className="font-medium text-brand-blue hover:underline cursor-pointer">
              {busy === page ? 'Uploading…' : pages[page] ? 'Replace' : eventSlug && defaults?.[page] ? 'Upload this event’s own' : 'Upload'}
              <input type="file" accept="image/png,image/jpeg" className="hidden" disabled={busy !== null}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(page, f); e.target.value = '' }} />
            </label>
            {page === 'front' && pages.front && (
              <button type="button" onClick={() => setPositioning((v) => !v)} className="font-medium text-brand-blue hover:underline">
                {positioning ? 'Close' : 'Position the fields'}
              </button>
            )}
            {eventSlug && pages[page] && (
              <button type="button" onClick={() => void remove(page)} disabled={busy !== null} className="underline">
                {defaults?.[page] ? 'Use the default' : 'Remove'}
              </button>
            )}
          </li>
        ))}
      </ul>
      {positioning && pages.front && (
        <FieldPositioner
          theme={theme}
          eventSlug={eventSlug}
          initial={layout}
          onSaved={async () => { setMsg({ text: 'Field positions saved.' }); await load(); setPositioning(false) }}
          onError={(text) => setMsg({ text, error: true })}
        />
      )}
      <p className="text-xs text-brand-muted-soft">
        Upload each page as a landscape PNG, 4:3 or wider (the Canva export, 2000×1500). It is scaled to fill US
        Letter without stretching, so the outer edges may be trimmed slightly.
      </p>
    </div>
  )
}

function FieldPositioner({ theme, eventSlug, initial, onSaved, onError }: {
  theme: ArtworkTheme
  eventSlug?: string
  initial: PdLayout
  onSaved: () => void | Promise<void>
  onError: (text: string) => void
}) {
  const [layout, setLayout] = useState<PdLayout>(initial)
  const [field, setField] = useState<PdField>('name')
  const [sample, setSample] = useState('Alexandra Montgomery-Whitfield')
  const [src, setSrc] = useState('')
  const [saving, setSaving] = useState(false)

  // Re-render the preview once the sliders settle, not on every tick.
  useEffect(() => {
    const qs = new URLSearchParams({ theme, ...(eventSlug ? { event: eventSlug } : {}), name: sample, layout: JSON.stringify(layout) })
    const t = setTimeout(() => setSrc(`/api/admin/pd-certificate/preview?${qs}#toolbar=0&navpanes=0&view=Fit`), 400)
    return () => clearTimeout(t)
  }, [theme, eventSlug, sample, layout])

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/pd-certificate', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ theme, event: eventSlug, layout }),
      })
      const d = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(d.error ?? 'Save failed')
      await onSaved()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const p = layout[field]
  const set = (key: keyof FieldPlacement, v: number) => setLayout({ ...layout, [field]: { ...p, [key]: v } })
  const slider = (key: keyof FieldPlacement, label: string, min: number, max: number, step: number, show: (v: number) => string) => (
    <label className="block text-xs text-brand-muted-soft space-y-1">
      <span className="flex justify-between"><span>{label}</span><span className="text-brand-muted">{show(p[key])}</span></span>
      <input
        type="range" min={min} max={max} step={step} value={p[key]}
        onChange={(e) => set(key, Number(e.target.value))}
        className="w-full accent-brand-blue"
      />
    </label>
  )
  const pct = (v: number) => `${Math.round(v * 1000) / 10}%`

  return (
    <div className="grid md:grid-cols-[minmax(0,1fr)_16rem] gap-4 rounded-lg bg-brand-canvas p-3">
      <div className="aspect-[11/8.5] w-full overflow-hidden rounded-md border border-brand-border bg-white">
        {src && <iframe key={src} src={src} title="PD certificate preview" className="h-full w-full" />}
      </div>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Field to position">
          {PD_FIELDS.map((f) => (
            <button key={f} type="button" role="tab" aria-selected={field === f} onClick={() => setField(f)}
              className={`text-xs px-2 py-1 rounded-md border ${field === f ? 'bg-brand-blue text-white border-brand-blue' : 'border-brand-border text-brand-blue-dark hover:bg-white'}`}>
              {FIELD_LABEL[f]}
            </button>
          ))}
        </div>
        {field === 'name' && (
          <label className="block text-xs text-brand-muted-soft space-y-1">
            <span>Sample name</span>
            <input
              className="w-full rounded-md border border-line-strong px-2 py-1.5 text-input mouse:text-sm text-brand-blue-dark"
              value={sample}
              onChange={(e) => setSample(e.target.value)}
            />
          </label>
        )}
        {slider('x', 'Across the page (centre)', 0.05, 0.95, 0.002, (v) => `${pct(v)} from left`)}
        {slider('y', 'Height on the page', 0.05, 0.95, 0.002, (v) => `${pct(v)} down`)}
        {slider('maxWidth', 'Widest it may run', 0.02, 0.9, 0.005, (v) => `${pct(v)} of width`)}
        {slider('size', 'Size (as in Canva)', 12, 120, 1, (v) => `${v}`)}
        <p className="text-xs text-brand-muted-soft">
          {field === 'name' ? 'Long names shrink to fit the width.' : 'Shrinks only if it would run past the width.'}{' '}
          The preview uses a 7.5-hour sample at STEM School.
        </p>
        <div className="flex gap-3">
          <button
            type="button" onClick={save} disabled={saving}
            className="text-xs font-medium px-3 py-2 rounded-md bg-brand-blue text-white hover:bg-brand-blue-bright disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save positions'}
          </button>
          <button type="button" onClick={() => setLayout(DEFAULT_PD_LAYOUT)} className="text-xs text-brand-muted-soft underline">
            Reset to default
          </button>
        </div>
      </div>
    </div>
  )
}
