'use client'

import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, Plus, Trash2 } from 'lucide-react'
import MemberPicker, { type PickedMember } from '@/components/admin/MemberPicker'
import { toast } from '@/components/ui/Toast'
import { NewObjectWizard } from './NewObjectWizard'

// Objects tab — ONE container detail for every object type (design/admin-
// access), replacing the five per-type detail pages. List on the left, detail
// with Roster · Managers · Contents on the right, all reading/writing the
// unified /api/admin/access/objects/[id]/* namespace. Type-specific depth
// (course builder, event ops widgets) stays on the legacy detail pages, linked
// from the header, until their RETIREMENT-DIFF phase completes.

interface ObjectListItem {
  objectType: string
  ref: string
  label: string
  archived: boolean
}

const TYPE_BADGE: Record<string, string> = {
  space: 'bg-purple-100 text-purple-800',
  course: 'bg-brand-blue/10 text-brand-blue',
  workshop: 'bg-teal-100 text-teal-800',
  cohort: 'bg-green-100 text-green-800',
  event: 'bg-amber-100 text-amber-800',
  campaign: 'bg-amber-100 text-amber-800',
  resource: 'bg-brand-hairline text-brand-muted',
}

const LEGACY_DETAIL: Record<string, (ref: string) => string> = {
  space: (r) => `/admin/community/spaces/${r}`,
  workshop: (r) => `/admin/academy/coaching/${r}`,
  cohort: (r) => `/admin/academy/mentoring/${r}`,
  course: () => `/admin/academy/training`,
  event: (r) => `/admin/competitions/${r}`,
  campaign: (r) => `/admin/competitions/${r}`,
}

export function ObjectsTab({ initialRef }: { initialRef?: string | null }) {
  const [objects, setObjects] = useState<ObjectListItem[]>([])
  const [filter, setFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [selected, setSelected] = useState<ObjectListItem | null>(null)
  const [wizard, setWizard] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let active = true
    fetch('/api/admin/access/objects')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => active && j?.objects && setObjects(j.objects))
    return () => { active = false }
  }, [reloadKey])

  useEffect(() => {
    if (!initialRef || objects.length === 0) return
    const match = objects.find((o) => o.ref === initialRef)
    if (match) setSelected(match)
  }, [initialRef, objects])

  const visible = objects.filter(
    (o) =>
      (!typeFilter || o.objectType === typeFilter) &&
      (!filter || o.label.toLowerCase().includes(filter.toLowerCase())),
  )

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <div>
        <button
          onClick={() => setWizard(true)}
          className="mb-2 flex w-full items-center justify-center gap-1 rounded-md bg-brand-blue px-3 py-1.5 text-sm text-white hover:bg-brand-blue-dark"
        >
          <Plus className="h-4 w-4" /> New object
        </button>
        {wizard && <NewObjectWizard onCreated={() => setReloadKey((k) => k + 1)} onClose={() => setWizard(false)} />}
        <div className="mb-2 flex gap-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter objects…"
            className="w-full rounded-md border border-brand-border px-2 py-1.5 text-sm"
          />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-md border border-brand-border px-2 py-1.5 text-sm"
          >
            <option value="">all</option>
            {Object.keys(TYPE_BADGE).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <ul className="max-h-[70vh] space-y-1 overflow-y-auto pr-1">
          {visible.map((o) => (
            <li key={`${o.objectType}:${o.ref}`}>
              <button
                onClick={() => setSelected(o)}
                className={
                  'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm ' +
                  (selected?.ref === o.ref
                    ? 'border-brand-blue bg-brand-blue/5'
                    : 'border-brand-hairline bg-white hover:bg-brand-canvas')
                }
              >
                <span className={'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ' + (TYPE_BADGE[o.objectType] ?? TYPE_BADGE.resource)}>
                  {o.objectType}
                </span>
                <span className="truncate text-brand-blue-dark">{o.label}</span>
                {o.archived && <span className="ml-auto text-[10px] uppercase text-brand-muted-soft">archived</span>}
              </button>
            </li>
          ))}
          {visible.length === 0 && <p className="py-8 text-center text-xs text-brand-muted-soft">No objects match.</p>}
        </ul>
      </div>

      {selected ? (
        <ObjectDetail key={`${selected.objectType}:${selected.ref}`} object={selected} />
      ) : (
        <p className="py-16 text-center text-sm text-brand-muted-soft">Select an object to manage its roster, managers and contents.</p>
      )}
    </div>
  )
}

type DetailTab = 'roster' | 'managers' | 'contents'

function ObjectDetail({ object }: { object: ObjectListItem }) {
  const [tab, setTab] = useState<DetailTab>('roster')
  const [gates, setGates] = useState<{ payment: boolean; docusign: boolean } | null>(null)

  useEffect(() => {
    let active = true
    fetch(`/api/admin/access/objects/${encodeURIComponent(object.ref)}/gates`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => active && j?.gates && setGates(j.gates))
    return () => { active = false }
  }, [object.ref])

  const legacyHref = LEGACY_DETAIL[object.objectType]?.(object.ref)

  return (
    <div className="rounded-xl border border-brand-border bg-white p-4">
      <div className="mb-4 flex items-center gap-2">
        <span className={'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ' + (TYPE_BADGE[object.objectType] ?? TYPE_BADGE.resource)}>
          {object.objectType}
        </span>
        <h2 className="truncate font-semibold text-brand-blue-dark">{object.label}</h2>
        {gates && (
          <span className="ml-2 flex gap-1">
            {gates.payment && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">payment gate</span>}
            {gates.docusign && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">DocuSign gate</span>}
          </span>
        )}
        {legacyHref && (
          <a href={legacyHref} className="ml-auto inline-flex items-center gap-1 text-xs text-brand-blue hover:underline">
            Type-specific tools <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      <div className="mb-4 flex gap-1 border-b border-brand-hairline">
        {(['roster', 'managers', 'contents'] as DetailTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              'px-3 py-1.5 text-sm capitalize ' +
              (tab === t
                ? 'border-b-2 border-brand-blue font-medium text-brand-blue'
                : 'text-brand-muted hover:text-brand-blue-dark')
            }
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'roster' && <RosterPane object={object} />}
      {tab === 'managers' && <ManagersPane object={object} />}
      {tab === 'contents' && <ContentsPane object={object} />}
    </div>
  )
}

interface RosterEntry {
  member_id: string
  relationship?: string
  role?: string
  status?: string
  members?: { first_name: string | null; last_name: string | null; email: string | null } | { first_name: string | null; last_name: string | null; email: string | null }[]
}

function memberName(m: RosterEntry['members']): string {
  const one = Array.isArray(m) ? m[0] : m
  return one ? `${one.first_name ?? ''} ${one.last_name ?? ''}`.trim() || (one.email ?? '—') : '—'
}

function RosterPane({ object }: { object: ObjectListItem }) {
  const [kind, setKind] = useState<string>('container')
  const [rows, setRows] = useState<RosterEntry[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [role, setRole] = useState('member')

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/access/objects/${encodeURIComponent(object.ref)}/roster`)
    if (!res.ok) return setRows([])
    const j = await res.json()
    setKind(j.kind)
    // Event rosters come back in the rich getEventRoster shape; flatten to entries.
    if (j.kind === 'event') {
      const flat: RosterEntry[] = []
      for (const g of j.roster?.groups ?? []) {
        for (const p of g.participants ?? []) {
          flat.push({ member_id: p.id, relationship: p.event_role, members: { first_name: p.first_name, last_name: p.last_name, email: p.email } })
        }
      }
      setRows(flat)
    } else {
      setRows(j.roster ?? [])
    }
  }, [object.ref])

  useEffect(() => { void load() }, [load])

  const add = async (m: PickedMember) => {
    const res = await fetch(`/api/admin/access/objects/${encodeURIComponent(object.ref)}/roster`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: m.id, role }),
    })
    if (!res.ok) toast((await res.json()).error ?? 'Could not add member', { tone: 'error' })
    setAdding(false)
    await load()
  }

  const remove = async (memberId: string) => {
    const res = await fetch(`/api/admin/access/objects/${encodeURIComponent(object.ref)}/roster`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId }),
    })
    if (!res.ok) toast((await res.json()).error ?? 'Could not remove member', { tone: 'error' })
    await load()
  }

  const isEvent = kind === 'event'

  return (
    <div>
      {!isEvent && (
        <div className="mb-3">
          {adding ? (
            <div className="flex items-start gap-2">
              <div className="flex-1"><MemberPicker onPick={add} /></div>
              <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded-md border border-brand-border px-2 py-1.5 text-sm">
                {['member', 'participant', 'mentor', 'coach', 'moderator', 'volunteer'].map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <button onClick={() => setAdding(false)} className="text-xs text-brand-muted hover:underline mt-2">cancel</button>
            </div>
          ) : (
            <button onClick={() => setAdding(true)} className="flex items-center gap-1 rounded-md bg-brand-blue px-3 py-1.5 text-sm text-white hover:bg-brand-blue-dark">
              <Plus className="h-4 w-4" /> Add member
            </button>
          )}
        </div>
      )}
      {isEvent && (
        <p className="mb-3 text-xs text-brand-muted-soft">
          Event rosters are built by the registration flow — this view is read-only.
        </p>
      )}
      {!rows ? (
        <p className="text-xs text-brand-muted-soft">Loading roster…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-brand-muted-soft">Nobody on this roster yet.</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((r, i) => (
            <li key={r.member_id + i} className="flex items-center gap-2 rounded-lg border border-brand-hairline px-3 py-1.5 text-sm">
              <span className="text-brand-blue-dark">{memberName(r.members)}</span>
              <span className="rounded-full bg-brand-hairline px-2 py-0.5 text-[10px] text-brand-muted capitalize">
                {r.relationship ?? r.role ?? 'member'}
              </span>
              {r.status && r.status !== 'active' && (
                <span className="text-[10px] uppercase text-brand-muted-soft">{r.status}</span>
              )}
              {!isEvent && (
                <button onClick={() => remove(r.member_id)} className="ml-auto" title="Remove from roster">
                  <Trash2 className="h-4 w-4 text-brand-muted-soft hover:text-red-600" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface ManagerEntry {
  member_id: string
  role: string
  source: 'grant' | 'role' | 'structural'
  members?: RosterEntry['members']
}

function ManagersPane({ object }: { object: ObjectListItem }) {
  const [rows, setRows] = useState<ManagerEntry[] | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/access/objects/${encodeURIComponent(object.ref)}/managers`)
    if (!res.ok) return setRows([])
    setRows((await res.json()).managers ?? [])
  }, [object.ref])

  useEffect(() => { void load() }, [load])

  const add = async (m: PickedMember) => {
    const res = await fetch(`/api/admin/access/objects/${encodeURIComponent(object.ref)}/managers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId: m.id }),
    })
    if (!res.ok) toast((await res.json()).error ?? 'Could not add manager', { tone: 'error' })
    setAdding(false)
    await load()
  }

  const remove = async (memberId: string) => {
    const res = await fetch(`/api/admin/access/objects/${encodeURIComponent(object.ref)}/managers`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memberId }),
    })
    if (!res.ok) toast((await res.json()).error ?? 'Could not remove manager', { tone: 'error' })
    await load()
  }

  return (
    <div>
      <div className="mb-3">
        {adding ? (
          <div className="flex items-start gap-2">
            <div className="flex-1"><MemberPicker onPick={add} /></div>
            <button onClick={() => setAdding(false)} className="mt-2 text-xs text-brand-muted hover:underline">cancel</button>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className="flex items-center gap-1 rounded-md bg-brand-blue px-3 py-1.5 text-sm text-white hover:bg-brand-blue-dark">
            <Plus className="h-4 w-4" /> Add manager
          </button>
        )}
      </div>
      {!rows ? (
        <p className="text-xs text-brand-muted-soft">Loading managers…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-brand-muted-soft">No managers assigned.</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((r, i) => (
            <li key={r.member_id + i} className="flex items-center gap-2 rounded-lg border border-brand-hairline px-3 py-1.5 text-sm">
              <span className="text-brand-blue-dark">{memberName(r.members)}</span>
              <span className="rounded-full bg-brand-hairline px-2 py-0.5 text-[10px] text-brand-muted capitalize">{r.role}</span>
              {r.source === 'structural' && (
                <span className="text-[10px] text-brand-muted-soft" title="Set on the container itself (coach/mentor)">structural</span>
              )}
              {r.source === 'grant' && (
                <button onClick={() => remove(r.member_id)} className="ml-auto" title="Revoke manager grant">
                  <Trash2 className="h-4 w-4 text-brand-muted-soft hover:text-red-600" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface ContentEntry {
  id: string
  objectType: string
  contentType: string
  ref: string
  label: string
  mandatory: boolean
  dueAt: string | null
}

interface SourceEntry {
  id: string
  objectType: string
  ref: string
  label: string
}

function ContentsPane({ object }: { object: ObjectListItem }) {
  const [rows, setRows] = useState<ContentEntry[] | null>(null)
  const [sources, setSources] = useState<SourceEntry[]>([])
  const [all, setAll] = useState<ObjectListItem[]>([])
  const [pickRef, setPickRef] = useState('')

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/access/objects/${encodeURIComponent(object.ref)}/contents`)
    if (!res.ok) { setRows([]); setSources([]); return }
    const j = await res.json()
    setRows(j.contents ?? [])
    setSources(j.sources ?? [])
  }, [object.ref])

  useEffect(() => {
    void load()
    fetch('/api/admin/access/objects')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.objects && setAll(j.objects))
  }, [load])

  const attachable = all.filter((o) => ['space', 'course', 'resource'].includes(o.objectType) && o.ref !== object.ref)

  const add = async () => {
    const target = all.find((o) => o.ref === pickRef)
    if (!target) return
    const contentType = target.objectType === 'space' ? 'space' : target.objectType === 'course' ? 'training_module' : 'resource'
    const res = await fetch(`/api/admin/access/objects/${encodeURIComponent(object.ref)}/contents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: target.ref, contentType }),
    })
    if (!res.ok) toast((await res.json()).error ?? 'Attach blocked', { tone: 'error' })
    setPickRef('')
    await load()
  }

  const remove = async (row: ContentEntry) => {
    const res = await fetch(`/api/admin/access/objects/${encodeURIComponent(object.ref)}/contents`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: row.ref, contentType: row.contentType }),
    })
    if (!res.ok) toast((await res.json()).error ?? 'Could not detach', { tone: 'error' })
    await load()
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <select value={pickRef} onChange={(e) => setPickRef(e.target.value)} className="min-w-0 flex-1 rounded-md border border-brand-border px-2 py-1.5 text-sm">
          <option value="">Attach an object…</option>
          {attachable.map((o) => (
            <option key={`${o.objectType}:${o.ref}`} value={o.ref}>[{o.objectType}] {o.label}</option>
          ))}
        </select>
        <button onClick={add} disabled={!pickRef} className="rounded-md bg-brand-blue px-3 py-1.5 text-sm text-white hover:bg-brand-blue-dark disabled:opacity-40">
          Attach
        </button>
      </div>

      {sources.length > 0 && (
        <div className="mb-3 rounded-lg border border-brand-hairline bg-brand-canvas px-3 py-2">
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-brand-muted-soft">Attached to</p>
          <ul className="space-y-1">
            {sources.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-sm">
                <span className={'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ' + (TYPE_BADGE[s.objectType] ?? TYPE_BADGE.resource)}>
                  {s.objectType}
                </span>
                <span className="truncate text-brand-blue-dark">{s.label}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-brand-muted-soft">Managed from each object&apos;s Contents.</p>
        </div>
      )}
      {!rows ? (
        <p className="text-xs text-brand-muted-soft">Loading contents…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-brand-muted-soft">Nothing attached yet.</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-2 rounded-lg border border-brand-hairline px-3 py-1.5 text-sm">
              <span className={'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ' + (TYPE_BADGE[r.objectType] ?? TYPE_BADGE.resource)}>
                {r.objectType}
              </span>
              <span className="truncate text-brand-blue-dark">{r.label}</span>
              {r.mandatory && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">mandatory</span>}
              {r.dueAt && <span className="text-[10px] text-brand-muted-soft">due {r.dueAt.slice(0, 10)}</span>}
              <button onClick={() => remove(r)} className="ml-auto" title="Detach">
                <Trash2 className="h-4 w-4 text-brand-muted-soft hover:text-red-600" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
