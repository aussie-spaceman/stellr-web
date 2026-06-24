'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  FileText,
  Link as LinkIcon,
  PlayCircle,
  LayoutGrid,
  List as ListIcon,
  Download,
  Pencil,
  Flag,
  Search,
} from 'lucide-react'
import type { CatalogueRow, ResourceKind, CatalogueSort } from '@/lib/resources-catalogue'

// Source object colour-code (handover §6). Not in the named token set — kept as a
// small local map so the dot/border can tint by origin object type.
const SOURCE_COLOR: Record<string, string> = {
  training: '#3C6DF6',
  mentoring: '#7C5CFC',
  coaching: '#E0A23A',
  workshop: '#E0A23A',
  event_participation: '#E0922F',
  campaign_participation: '#E0922F',
  space: '#16B6C4',
}

const KIND_FILTERS: { key: ResourceKind | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'file', label: 'Files' },
  { key: 'link', label: 'Links' },
  { key: 'video', label: 'Videos' },
]

const SORTS: { key: CatalogueSort; label: string }[] = [
  { key: 'recent', label: 'Recently added' },
  { key: 'downloads', label: 'Most downloaded' },
  { key: 'name', label: 'Name A–Z' },
  { key: 'source', label: 'By source object' },
]

function KindIcon({ kind, className }: { kind: ResourceKind; className?: string }) {
  if (kind === 'video') return <PlayCircle className={className} />
  if (kind === 'link') return <LinkIcon className={className} />
  return <FileText className={className} />
}

function VisibilityBadge({ visibility }: { visibility: CatalogueRow['provenance']['visibility'] }) {
  const label = visibility.charAt(0).toUpperCase() + visibility.slice(1)
  return (
    <span className="rounded-full bg-brand-blue/10 px-2 py-0.5 text-[11px] font-medium capitalize text-brand-blue-dark">
      {label}
    </span>
  )
}

function actionLabel(kind: ResourceKind): string {
  if (kind === 'video') return 'Watch'
  if (kind === 'link') return 'Open'
  return 'Download'
}

/** Triggers a catalogue download via the container-gated attachment route. */
async function downloadAttachment(attachmentId: string, name: string): Promise<string | null> {
  const res = await fetch(`/api/community/resources/attachment/${attachmentId}/download`)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) return json.error ?? 'Download failed'
  const a = document.createElement('a')
  a.href = json.url
  a.download = name
  a.rel = 'noopener noreferrer'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  return null
}

function RowActions({ row, name }: { row: CatalogueRow; name: string }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  if (row.kind !== 'file') {
    // Links / recordings open in a new tab (PR2 supplies the href; detail page
    // re-checks the gate). For now route through the detail page.
    return (
      <Link
        href={`/community/resources/${row.attachmentId}`}
        className="inline-flex items-center gap-1.5 rounded-md bg-brand-blue/10 px-3 py-1.5 text-xs font-medium text-brand-blue-dark hover:bg-brand-blue/20"
      >
        <KindIcon kind={row.kind} className="h-3.5 w-3.5" />
        {actionLabel(row.kind)}
      </Link>
    )
  }

  return (
    <div className="text-right">
      <button
        onClick={async () => {
          setBusy(true)
          setErr(null)
          setErr(await downloadAttachment(row.attachmentId, name))
          setBusy(false)
        }}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md bg-brand-blue/10 px-3 py-1.5 text-xs font-medium text-brand-blue-dark hover:bg-brand-blue/20 disabled:opacity-50"
      >
        <Download className="h-3.5 w-3.5" />
        {busy ? 'Preparing…' : 'Download'}
      </button>
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
    </div>
  )
}

/** Inline rename (pencil → input → Save/Cancel), shown only for own uploads. */
function NameWithRename({
  row,
  name,
  onRenamed,
}: {
  row: CatalogueRow
  name: string
  onRenamed: (next: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(name)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const save = async () => {
    const next = value.trim()
    if (!next) {
      setErr('Name cannot be empty')
      return
    }
    setSaving(true)
    setErr(null)
    const prev = name
    onRenamed(next) // optimistic
    const res = await fetch(`/api/community/resources/attachment/${row.attachmentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: next }),
    })
    setSaving(false)
    if (!res.ok) {
      onRenamed(prev) // revert
      const json = await res.json().catch(() => ({}))
      setErr(json.error ?? 'Rename failed')
      return
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={200}
          autoFocus
          className="min-w-0 flex-1 rounded border border-brand-border px-2 py-1 text-sm focus:border-brand-blue-dark focus:outline-none"
        />
        <button
          onClick={save}
          disabled={saving}
          className="rounded bg-brand-blue-dark px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          {saving ? '…' : 'Save'}
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
        {err && <span className="text-xs text-red-600">{err}</span>}
      </div>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <Link href={`/community/resources/${row.attachmentId}`} className="font-semibold text-brand-blue-dark hover:underline">
        {name}
      </Link>
      {row.ownedByMe && (
        <button
          onClick={() => {
            setValue(name)
            setEditing(true)
          }}
          title="Rename"
          className="text-brand-muted-soft hover:text-brand-blue-dark"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
    </span>
  )
}

function ProvenanceLine({ row }: { row: CatalogueRow }) {
  const color = SOURCE_COLOR[row.provenance.containerType] ?? '#94A3B8'
  const inner = (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      Inherited from {row.provenance.label}
    </span>
  )
  return (
    <span className="text-xs text-brand-muted-soft">
      {row.provenance.href ? (
        <Link href={row.provenance.href} className="hover:underline">
          {inner}
        </Link>
      ) : (
        inner
      )}
    </span>
  )
}

function metaLine(row: CatalogueRow): string {
  const date = new Date(row.addedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  const who = row.uploadedByName ? `${row.uploadedByName} · ` : ''
  return `${who}${date}`
}

export function ResourcesCatalogue({ rows: initialRows }: { rows: CatalogueRow[] }) {
  const [rows, setRows] = useState(initialRows)
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<ResourceKind | 'all'>('all')
  const [sort, setSort] = useState<CatalogueSort>('recent')

  const renameRow = (attachmentId: string, next: string) =>
    setRows((rs) => rs.map((r) => (r.attachmentId === attachmentId ? { ...r, name: next } : r)))

  // Search / type / sort are presentational over the already access-filtered set
  // (the server only ever returns openable rows).
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    let out = rows.filter((r) => {
      if (kind !== 'all' && r.kind !== kind) return false
      if (q && !r.name.toLowerCase().includes(q) && !r.provenance.label.toLowerCase().includes(q)) return false
      return true
    })
    out = [...out]
    if (sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name))
    else if (sort === 'source')
      out.sort((a, b) => a.provenance.label.localeCompare(b.provenance.label) || a.name.localeCompare(b.name))
    else out.sort((a, b) => +new Date(b.addedAt) - +new Date(a.addedAt))
    return out
  }, [rows, search, kind, sort])

  return (
    <div>
      {/* Filter bar */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-muted-soft" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search resources…"
            className="w-full rounded-md border border-brand-border py-2 pl-9 pr-3 text-sm focus:border-brand-blue-dark focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1 rounded-md border border-brand-border p-0.5">
          {KIND_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setKind(f.key)}
              className={`rounded px-2.5 py-1 text-xs font-medium ${
                kind === f.key ? 'bg-brand-blue-dark text-white' : 'text-brand-muted hover:text-brand-blue-dark'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as CatalogueSort)}
          className="rounded-md border border-brand-border px-2.5 py-1.5 text-xs text-brand-muted focus:border-brand-blue-dark focus:outline-none"
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1 rounded-md border border-brand-border p-0.5">
          <button
            onClick={() => setView('grid')}
            title="Grid view"
            className={`rounded p-1.5 ${view === 'grid' ? 'bg-brand-blue-dark text-white' : 'text-brand-muted hover:text-brand-blue-dark'}`}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            onClick={() => setView('list')}
            title="List view"
            className={`rounded p-1.5 ${view === 'list' ? 'bg-brand-blue-dark text-white' : 'text-brand-muted hover:text-brand-blue-dark'}`}
          >
            <ListIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {visible.length === 0 && (
        <p className="text-sm text-brand-muted-soft">
          {rows.length === 0
            ? 'No resources yet. Resources shared in your cohorts, courses, spaces and competitions appear here.'
            : 'No resources match your filters.'}
        </p>
      )}

      {/* Grid */}
      {view === 'grid' && visible.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((row) => (
            <div
              key={row.attachmentId}
              className="flex flex-col rounded-2xl border border-brand-border bg-white p-4 transition-shadow hover:shadow-[0_18px_40px_-30px_rgba(20,26,61,.4)]"
            >
              <div className="mb-2 flex items-center justify-between">
                <KindIcon kind={row.kind} className="h-5 w-5 text-brand-muted-soft" />
                <VisibilityBadge visibility={row.provenance.visibility} />
              </div>
              <NameWithRename row={row} name={row.name} onRenamed={(n) => renameRow(row.attachmentId, n)} />
              <div className="mt-1">
                <ProvenanceLine row={row} />
              </div>
              <p className="mt-1 text-xs text-brand-muted-soft">{metaLine(row)}</p>
              <div className="mt-4 flex items-center justify-between">
                <Link
                  href={`/community/resources/${row.attachmentId}`}
                  className="text-brand-muted-soft hover:text-red-500"
                  title="Report this resource"
                >
                  <Flag className="h-3.5 w-3.5" />
                </Link>
                <RowActions row={row} name={row.name} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* List */}
      {view === 'list' && visible.length > 0 && (
        <ul className="space-y-2">
          {visible.map((row) => (
            <li
              key={row.attachmentId}
              className="flex items-center justify-between gap-4 rounded-xl border border-brand-border bg-white p-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <KindIcon kind={row.kind} className="h-5 w-5 shrink-0 text-brand-muted-soft" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <NameWithRename row={row} name={row.name} onRenamed={(n) => renameRow(row.attachmentId, n)} />
                    <VisibilityBadge visibility={row.provenance.visibility} />
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    <ProvenanceLine row={row} />
                    <span className="text-xs text-brand-muted-soft">{metaLine(row)}</span>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Link
                  href={`/community/resources/${row.attachmentId}`}
                  className="text-brand-muted-soft hover:text-red-500"
                  title="Report this resource"
                >
                  <Flag className="h-3.5 w-3.5" />
                </Link>
                <RowActions row={row} name={row.name} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
