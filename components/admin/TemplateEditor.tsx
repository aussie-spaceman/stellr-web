'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@stellr/web-ui'
import { FIELD_SOURCES, FIELD_TYPES, ROLES, type Role, type TemplateField } from '@/lib/esign/native/template'

// Admin → Consent forms → Agreement documents → Edit fields.
//
// Places each field on the document: drag a box, or select it and use the
// arrow keys (Shift for 10 points), or type exact numbers. Positions are PDF
// points from the top-left of the page, the same as the field map. Saving
// makes a new, unapproved version; nothing reaches a family until a version
// is approved on the documents page.

type Field = TemplateField
interface RoleRow { role: Role; order: number; optional: boolean }
interface PageImage { src: string; width: number; height: number }

export interface TemplateEditorProps {
  documentKey: string
  title: string
  pdfPath: string | null
  fields: Field[]
  roles: RoleRow[]
  fromVersion: string | null
  keys: string[]
}

const DISPLAY_WIDTH = 680

const ROLE_STYLE: Record<Role, string> = {
  guardian: 'border-primary-deep bg-primary-soft/70 text-primary-deep',
  student: 'border-space-violet bg-white/80 text-space-violet',
  adult: 'border-enviro-green bg-white/80 text-ink',
  mentor: 'border-pathway-amber bg-white/80 text-ink',
  member: 'border-ink bg-white/80 text-ink',
  stellr: 'border-content-muted bg-surface/80 text-content-muted',
}

const DEFAULT_SIZE: Partial<Record<Field['type'], [number, number]>> = {
  signature: [170, 30],
  checkbox: [12, 12],
  date_signed: [90, 14],
}

const sizeOf = (f: Field): [number, number] => [f.w || DEFAULT_SIZE[f.type]?.[0] || 140, f.h || DEFAULT_SIZE[f.type]?.[1] || 14]
const round = (n: number) => Math.round(n * 2) / 2

function newField(index: number, page: number, x: number, y: number, role: Role): Field {
  return {
    name: `field_${index}`, label: 'New field', role, type: 'text', source: 'signer',
    page, x: round(x), y: round(y), w: 0, h: 0, required: false, locked: false, fontSize: 9, maxLength: 200,
  } as Field
}

export function TemplateEditor(props: TemplateEditorProps) {
  const [documentKey, setDocumentKey] = useState(props.documentKey)
  const [title, setTitle] = useState(props.title)
  const [pdfPath, setPdfPath] = useState(props.pdfPath)
  const [fields, setFields] = useState<Field[]>(props.fields)
  const [roleOrder, setRoleOrder] = useState<RoleRow[]>(props.roles)
  const [pages, setPages] = useState<PageImage[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [placing, setPlacing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ text: string; error?: boolean; issues?: string[]; saved?: string } | null>(null)
  const drag = useRef<{ index: number; startX: number; startY: number; fieldX: number; fieldY: number; scale: number; pageW: number; pageH: number } | null>(null)

  // Draw the document's pages with pdf.js.
  useEffect(() => {
    if (!pdfPath) return
    let cancelled = false
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
        const res = await fetch(`/api/admin/esign/templates/file?path=${encodeURIComponent(pdfPath)}`, { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()) }).promise
        const out: PageImage[] = []
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n)
          const base = page.getViewport({ scale: 1 })
          const viewport = page.getViewport({ scale: (DISPLAY_WIDTH / base.width) * 2 })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          await page.render({ canvas, canvasContext: canvas.getContext('2d') as CanvasRenderingContext2D, viewport }).promise
          out.push({ src: canvas.toDataURL('image/png'), width: base.width, height: base.height })
        }
        await doc.destroy()
        if (!cancelled) setPages(out)
      } catch (err) {
        console.error('[template-editor] could not draw the document:', err)
        if (!cancelled) setStatus({ text: 'The document could not be shown.', error: true })
      }
    })()
    return () => { cancelled = true }
  }, [pdfPath])

  // Every role used by a field has a signing order; new roles go last.
  useEffect(() => {
    const used = [...new Set(fields.map((f) => f.role))]
    setRoleOrder((rows) => {
      const kept = rows.filter((r) => used.includes(r.role))
      let next = Math.max(0, ...kept.map((r) => r.order))
      for (const role of used) if (!kept.some((r) => r.role === role)) kept.push({ role, order: ++next, optional: false })
      return kept.length === rows.length && kept.every((r, i) => r === rows[i]) ? rows : kept
    })
  }, [fields])

  const update = useCallback((index: number, patch: Partial<Field>) => {
    setFields((list) => list.map((f, i) => (i === index ? ({ ...f, ...patch } as Field) : f)))
  }, [])

  const fieldMap = useMemo(() => ({ roles: roleOrder, fields }), [roleOrder, fields])

  function onPageClick(e: React.MouseEvent<HTMLDivElement>, pageIndex: number) {
    if (!placing) return
    const rect = e.currentTarget.getBoundingClientRect()
    const scale = rect.width / pages[pageIndex].width
    const role = (fields.at(-1)?.role ?? roleOrder[0]?.role ?? 'adult') as Role
    const index = fields.length
    setFields((list) => [...list, newField(index + 1, pageIndex + 1, (e.clientX - rect.left) / scale, (e.clientY - rect.top) / scale, role)])
    setSelected(index)
    setPlacing(false)
  }

  function startDrag(e: React.PointerEvent<HTMLButtonElement>, index: number) {
    const host = e.currentTarget.parentElement as HTMLElement
    const page = pages[fields[index].page - 1]
    const scale = host.getBoundingClientRect().width / page.width
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { index, startX: e.clientX, startY: e.clientY, fieldX: fields[index].x, fieldY: fields[index].y, scale, pageW: page.width, pageH: page.height }
    setSelected(index)
  }

  function moveDrag(e: React.PointerEvent<HTMLButtonElement>) {
    const d = drag.current
    if (!d) return
    const [w, h] = sizeOf(fields[d.index])
    update(d.index, {
      x: round(Math.min(Math.max(0, d.fieldX + (e.clientX - d.startX) / d.scale), d.pageW - w)),
      y: round(Math.min(Math.max(0, d.fieldY + (e.clientY - d.startY) / d.scale), d.pageH - h)),
    })
  }

  function nudge(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = e.shiftKey ? 10 : 1
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key]
    if (!delta) return
    e.preventDefault()
    const f = fields[index]
    update(index, { x: Math.max(0, round(f.x + delta[0])), y: Math.max(0, round(f.y + delta[1])) })
  }

  async function upload(file: File) {
    setBusy(true); setStatus(null)
    const body = new FormData()
    body.set('file', file)
    const res = await fetch('/api/admin/esign/templates/upload', { method: 'POST', body })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) return setStatus({ text: data.error ?? 'Upload failed.', error: true, issues: data.issues })
    setPages([])
    setPdfPath(data.pdfPath)
    setStatus({ text: `Uploaded and cleaned: ${data.pageCount} page${data.pageCount === 1 ? '' : 's'}. Fields kept where they were; check each one.` })
  }

  async function preview() {
    if (!pdfPath) return
    setBusy(true); setStatus(null)
    const res = await fetch('/api/admin/esign/templates/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pdfPath, fieldMap }),
    })
    setBusy(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      return setStatus({ text: data.error ?? 'Preview failed.', error: true, issues: data.issues })
    }
    window.open(URL.createObjectURL(await res.blob()), '_blank', 'noopener')
  }

  async function save() {
    if (!pdfPath) return
    setBusy(true); setStatus(null)
    const res = await fetch('/api/admin/esign/templates', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: documentKey, title, pdfPath, fieldMap }),
    })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) return setStatus({ text: data.error ?? 'Saving failed.', error: true, issues: data.issues })
    setStatus({ text: `Saved as ${documentKey} v${data.version}. It is not in use until it is approved.`, saved: data.id })
  }

  const f = selected !== null ? fields[selected] : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-line bg-white p-4">
        <label className="text-sm text-ink">
          <span className="block font-semibold">Document</span>
          <select className="mt-1 rounded-control border border-line px-2 py-1.5" value={documentKey} onChange={(e) => setDocumentKey(e.target.value)} disabled={!!props.fromVersion}>
            {props.keys.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <label className="min-w-64 flex-1 text-sm text-ink">
          <span className="block font-semibold">Title signers see</span>
          <input className="mt-1 w-full rounded-control border border-line px-2 py-1.5" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="text-sm text-ink">
          <span className="block font-semibold">{pdfPath ? 'Replace the PDF' : 'Upload the PDF'}</span>
          <input type="file" accept="application/pdf,.pdf" className="mt-1 text-sm" disabled={busy}
            onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file) }} />
        </label>
      </div>

      {status && (
        <div role={status.error ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-sm ${status.error ? 'border-danger text-danger' : 'border-line text-ink'} bg-white`}>
          <p>{status.text}</p>
          {status.issues?.length ? <ul className="mt-2 list-disc pl-5">{status.issues.map((i) => <li key={i}>{i}</li>)}</ul> : null}
          {status.saved && <p className="mt-2"><Link className="text-primary-deep underline" href={`/admin/docusigns/templates?v=${status.saved}`}>Review and approve it</Link></p>}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          {!pdfPath && <p className="rounded-xl border border-line bg-white p-6 text-sm text-content-muted">Upload the agreement PDF to start.</p>}
          {pdfPath && !pages.length && <p className="text-sm text-content-muted">Drawing the document…</p>}
          {pages.map((page, pi) => (
            <div key={pi} className="relative w-full max-w-[680px] border border-line bg-white shadow-sm"
              style={{ aspectRatio: `${page.width} / ${page.height}`, cursor: placing ? 'crosshair' : 'default' }}
              onClick={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === 'IMG') onPageClick(e, pi) }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={page.src} alt={`Page ${pi + 1}`} className="block h-full w-full select-none" draggable={false} />
              {fields.map((fl, i) => {
                if (fl.page !== pi + 1) return null
                const [w, h] = sizeOf(fl)
                return (
                  <button
                    key={i}
                    type="button"
                    aria-label={`${fl.label} (${fl.role}, ${fl.type}), page ${fl.page} at ${fl.x}, ${fl.y}. Arrow keys move it.`}
                    aria-pressed={selected === i}
                    className={`absolute touch-none overflow-hidden whitespace-nowrap rounded-sm border px-0.5 text-left text-[9px] leading-tight ${ROLE_STYLE[fl.role]} ${selected === i ? 'ring-2 ring-primary-deep' : ''}`}
                    style={{ left: `${(fl.x / page.width) * 100}%`, top: `${(fl.y / page.height) * 100}%`, width: `${(w / page.width) * 100}%`, height: `${(h / page.height) * 100}%`, minHeight: 10, minWidth: 10 }}
                    onPointerDown={(e) => startDrag(e, i)}
                    onPointerMove={moveDrag}
                    onPointerUp={() => { drag.current = null }}
                    onKeyDown={(e) => nudge(e, i)}
                    onFocus={() => setSelected(i)}
                  >
                    {fl.label}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondaryStrong" disabled={!pages.length || busy} onClick={() => setPlacing(true)}>
              {placing ? 'Click the page…' : 'Add a field'}
            </Button>
            <Button variant="secondaryStrong" disabled={!pdfPath || busy} onClick={preview}>Preview with labels</Button>
            <Button variant="primaryStrong" disabled={!pdfPath || !fields.length || busy} onClick={save}>Save as new version</Button>
          </div>

          {f && selected !== null ? (
            <section className="space-y-3 rounded-xl border border-line bg-white p-4" aria-label="Selected field">
              <h2 className="font-heading text-base font-semibold text-ink">Field</h2>
              <Text label="Label signers see" value={f.label} onChange={(v) => update(selected, { label: v })} />
              <Text label="Name (read back by code)" value={f.name} onChange={(v) => update(selected, { name: v.replace(/[^A-Za-z0-9_]/g, '') })} />
              <Select label="Who" value={f.role} options={ROLES} onChange={(v) => update(selected, { role: v as Role })} />
              <Select label="Kind" value={f.type} options={FIELD_TYPES} onChange={(v) => update(selected, { type: v as Field['type'] })} />
              <Select label="Value comes from" value={f.source} options={FIELD_SOURCES} onChange={(v) => update(selected, { source: v as Field['source'] })} />
              {f.source === 'prefill' && <Text label="Prefill key" value={f.prefillKey ?? ''} onChange={(v) => update(selected, { prefillKey: v })} />}
              <div className="grid grid-cols-3 gap-2">
                <Num label="Page" value={f.page} min={1} max={Math.max(1, pages.length)} onChange={(v) => update(selected, { page: v })} />
                <Num label="X" value={f.x} onChange={(v) => update(selected, { x: v })} />
                <Num label="Y" value={f.y} onChange={(v) => update(selected, { y: v })} />
                <Num label="Width" value={f.w} onChange={(v) => update(selected, { w: v })} />
                <Num label="Height" value={f.h} onChange={(v) => update(selected, { h: v })} />
                <Num label="Font size" value={f.fontSize} min={5} max={24} onChange={(v) => update(selected, { fontSize: v })} />
              </div>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={f.required} onChange={(e) => update(selected, { required: e.target.checked })} /> Required
              </label>
              <Button variant="secondaryStrong" onClick={() => { setFields((list) => list.filter((_, i) => i !== selected)); setSelected(null) }}>
                Remove this field
              </Button>
            </section>
          ) : (
            <p className="text-sm text-content-muted">Select a field to edit it, or add one.</p>
          )}

          <section className="space-y-2 rounded-xl border border-line bg-white p-4" aria-label="Signing order">
            <h2 className="font-heading text-base font-semibold text-ink">Signing order</h2>
            {roleOrder.map((r, i) => (
              <div key={r.role} className="flex items-center justify-between gap-2 text-sm text-ink">
                <span>{r.role}</span>
                <Num label={`Order for ${r.role}`} hideLabel value={r.order} min={1} max={9}
                  onChange={(v) => setRoleOrder((rows) => rows.map((x, j) => (j === i ? { ...x, order: v } : x)))} />
              </div>
            ))}
            <p className="text-xs text-content-muted">For a minor&rsquo;s form, the guardian signs first.</p>
          </section>

          <section className="rounded-xl border border-line bg-white p-4" aria-label="All fields">
            <h2 className="font-heading text-base font-semibold text-ink">{`${fields.length} fields`}</h2>
            <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-sm">
              {fields.map((fl, i) => (
                <li key={i}>
                  <button type="button" className={`w-full text-left ${selected === i ? 'font-semibold text-primary-deep' : 'text-ink'}`} onClick={() => setSelected(i)}>
                    {`${fl.label} · ${fl.role} · p${fl.page}`}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  )
}

function Text({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-sm text-ink">
      <span className="block font-semibold">{label}</span>
      <input className="mt-1 w-full rounded-control border border-line px-2 py-1" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: readonly string[]; onChange: (v: string) => void }) {
  return (
    <label className="block text-sm text-ink">
      <span className="block font-semibold">{label}</span>
      <select className="mt-1 w-full rounded-control border border-line px-2 py-1" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o} value={o}>{o.replace('_', ' ')}</option>)}
      </select>
    </label>
  )
}

function Num({ label, value, onChange, min = 0, max, hideLabel }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; hideLabel?: boolean }) {
  return (
    <label className="block text-sm text-ink">
      <span className={hideLabel ? 'sr-only' : 'block font-semibold'}>{label}</span>
      <input type="number" step={0.5} min={min} max={max} className="mt-1 w-full rounded-control border border-line px-2 py-1"
        value={value} onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(n) }} />
    </label>
  )
}
