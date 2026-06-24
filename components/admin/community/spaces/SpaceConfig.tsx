'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ChevronLeft, Plus, Pencil, Trash2, Check, X, Upload, Flag,
} from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'
import { AccessBadge, ACCESS_META, TierPill, RolePill } from '@/components/community/spaces/badges'
import { TIER_GROUPS } from '@/lib/tiers'
import type { AdminSpaceConfig } from '@/lib/space-admin'
import type { SpaceAccessType, SpaceRole, SpaceTheme } from '@/lib/spaces'

const TABS = [
  ['general', 'General'],
  ['access', 'Access & tiers'],
  ['resources', 'Resources'],
  ['training', 'Training'],
  ['members', 'Members & permissions'],
  ['announcements', 'Announcements'],
  ['moderation', 'Moderation'],
] as const
type TabKey = (typeof TABS)[number][0]

const THEMES: SpaceTheme[] = ['space', 'enviro', 'campaign', 'college']

export function SpaceConfig({
  config,
  tierIdByName,
}: {
  config: AdminSpaceConfig
  tierIdByName: Record<string, string>
}) {
  const router = useRouter()
  const { space } = config
  const [tab, setTab] = useState<TabKey>('general')

  // POST an action to the per-space router, then refresh server data.
  const act = async (body: Record<string, unknown>, okMsg?: string): Promise<boolean> => {
    const res = await fetch(`/api/admin/community/spaces/${space.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      toast(j.error ?? 'Action failed')
      return false
    }
    if (okMsg) toast(okMsg)
    router.refresh()
    return true
  }

  const patchSpace = async (body: Record<string, unknown>, okMsg = 'Saved') => {
    const res = await fetch('/api/admin/community/spaces', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: space.id, ...body }),
    })
    if (!res.ok) return toast('Could not save')
    toast(okMsg)
    router.refresh()
  }

  return (
    <div>
      <Link href="/admin/community/spaces" className="mb-3 inline-flex items-center gap-1 text-sm text-brand-muted-soft hover:text-brand-muted">
        <ChevronLeft className="h-4 w-4" /> All spaces
      </Link>

      <div className="lg:flex lg:gap-6">
        {/* Sub-tab rail */}
        <aside className="mb-4 w-full shrink-0 lg:mb-0 lg:w-[240px]">
          <div className="rounded-[14px] border border-brand-border bg-white p-3">
            <h2 className="px-1 font-heading text-[16px] text-brand-blue-dark">{space.name}</h2>
            <div className="mt-1 px-1"><AccessBadge type={space.access_type} size="sm" /></div>
            <nav className="mt-3 flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
              {TABS.map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`whitespace-nowrap rounded-[8px] px-2.5 py-1.5 text-left text-sm transition-colors ${
                    tab === key ? 'bg-[#EAF0FE] font-semibold text-[#2C53C6]' : 'text-brand-muted hover:bg-brand-canvas'
                  }`}
                >
                  {label}
                </button>
              ))}
            </nav>
          </div>
        </aside>

        {/* Panel */}
        <section className="min-w-0 flex-1">
          <div className="max-w-[680px] rounded-[14px] border border-brand-border bg-white p-5">
            {tab === 'general' && <GeneralTab space={space} channels={config.channels} act={act} patchSpace={patchSpace} onDelete={() => router.push('/admin/community/spaces')} />}
            {tab === 'access' && <AccessTab space={space} assignedTierIds={config.assignedTierIds} tierIdByName={tierIdByName} act={act} patchSpace={patchSpace} />}
            {tab === 'resources' && <ResourcesTab spaceId={space.id} resources={config.resources} act={act} onUploaded={() => router.refresh()} />}
            {tab === 'training' && <TrainingTab assigned={config.assignedTraining} catalogue={config.trainingCatalogue} act={act} />}
            {tab === 'members' && <MembersTab space={space} members={config.members} act={act} patchSpace={patchSpace} />}
            {tab === 'announcements' && <AnnouncementsTab announcements={config.announcements} act={act} />}
            {tab === 'moderation' && <ModerationTab moderation={config.moderation} act={act} />}
          </div>
        </section>
      </div>
    </div>
  )
}

type Act = (body: Record<string, unknown>, okMsg?: string) => Promise<boolean>
type Patch = (body: Record<string, unknown>, okMsg?: string) => Promise<void>

// ─── General ──────────────────────────────────────────────────────────────────
function GeneralTab({
  space, channels, act, patchSpace, onDelete,
}: {
  space: AdminSpaceConfig['space']
  channels: AdminSpaceConfig['channels']
  act: Act
  patchSpace: Patch
  onDelete: () => void
}) {
  const [name, setName] = useState(space.name)
  const [description, setDescription] = useState(space.description ?? '')
  const [theme, setTheme] = useState<SpaceTheme>(space.theme)
  const [newChannel, setNewChannel] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)

  return (
    <div>
      <PanelTitle>General</PanelTitle>
      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
      </Field>
      <Field label="Description">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputCls} />
      </Field>
      <Field label="Theme accent">
        <div className="flex gap-2">
          {THEMES.map((t) => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              className={`h-7 w-7 rounded-[7px] ${theme === t ? 'ring-2 ring-offset-2 ring-brand-blue' : ''}`}
              style={{ background: THEME_HEX[t] }}
              aria-label={t}
            />
          ))}
        </div>
      </Field>

      <div className="mt-5">
        <p className="mb-2 text-sm font-subheading font-semibold text-brand-blue-dark">Channels</p>
        <div className="divide-y divide-brand-hairline rounded-lg border border-brand-border">
          {channels.map((c) => (
            <div key={c.id} className="flex items-center gap-2 px-3 py-2">
              {editing?.id === c.id ? (
                <>
                  <input value={editing.name} onChange={(e) => setEditing({ id: c.id, name: e.target.value })} className="flex-1 rounded border border-brand-border px-2 py-1 text-sm" />
                  <button onClick={async () => { if (await act({ action: 'rename-channel', channelId: c.id, name: editing.name }, 'Channel renamed')) setEditing(null) }} className="text-brand-blue"><Check className="h-4 w-4" /></button>
                  <button onClick={() => setEditing(null)} className="text-brand-muted-soft"><X className="h-4 w-4" /></button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm text-brand-blue-dark"># {c.name}</span>
                  <button onClick={() => setEditing({ id: c.id, name: c.name })} className="text-brand-muted-soft hover:text-brand-muted"><Pencil className="h-3.5 w-3.5" /></button>
                  <button onClick={() => act({ action: 'delete-channel', channelId: c.id }, 'Channel deleted')} className="text-brand-muted-soft hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                </>
              )}
            </div>
          ))}
          <div className="flex items-center gap-2 px-3 py-2">
            <input value={newChannel} onChange={(e) => setNewChannel(e.target.value)} placeholder="New channel name" className="flex-1 rounded border border-brand-border px-2 py-1 text-sm" />
            <button
              onClick={async () => { if (newChannel.trim() && await act({ action: 'add-channel', name: newChannel.trim() }, 'Channel added')) setNewChannel('') }}
              className="inline-flex items-center gap-1 rounded-lg bg-brand-blue px-2.5 py-1 text-xs font-subheading font-semibold text-white hover:bg-brand-blue-dark"
            >
              <Plus className="h-3.5 w-3.5" /> Add channel
            </button>
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between border-t border-brand-hairline pt-4">
        <button
          onClick={async () => {
            if (!confirm(`Delete “${space.name}”? This removes all its channels, posts and members.`)) return
            const res = await fetch('/api/admin/community/spaces', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: space.id }) })
            if (res.ok) { toast('Space deleted'); onDelete() } else toast('Could not delete')
          }}
          className="rounded-lg border border-red-200 px-3 py-2 text-sm font-subheading font-semibold text-red-600 hover:bg-red-50"
        >
          Delete space
        </button>
        <button
          onClick={() => patchSpace({ name, description, theme }, 'Changes saved')}
          className="rounded-lg bg-brand-blue px-4 py-2 text-sm font-subheading font-semibold text-white hover:bg-brand-blue-dark"
        >
          Save changes
        </button>
      </div>
    </div>
  )
}

// ─── Access & tiers ───────────────────────────────────────────────────────────
function AccessTab({
  space, assignedTierIds, tierIdByName, act, patchSpace,
}: {
  space: AdminSpaceConfig['space']
  assignedTierIds: string[]
  tierIdByName: Record<string, string>
  act: Act
  patchSpace: Patch
}) {
  const [access, setAccess] = useState<SpaceAccessType>(space.access_type)
  const [selected, setSelected] = useState<Set<string>>(new Set(assignedTierIds))
  const isOpen = access === 'open'

  const toggle = (id: string) => {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  return (
    <div>
      <PanelTitle>Access &amp; tiers</PanelTitle>
      <div className="space-y-2">
        {(Object.keys(ACCESS_META) as SpaceAccessType[]).map((t) => {
          const m = ACCESS_META[t]
          const sel = access === t
          return (
            <label key={t} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm" style={sel ? { borderColor: m.color, background: m.tint } : { borderColor: '#E4E7F2' }}>
              <input type="radio" name="access" checked={sel} onChange={() => setAccess(t)} className="mt-0.5" />
              <span>
                <span className="font-subheading font-semibold text-brand-blue-dark">{m.label}</span>
                <span className="block text-xs text-brand-muted-soft">{m.blurb}</span>
              </span>
            </label>
          )
        })}
      </div>

      <p className="mt-5 mb-1 text-sm font-subheading font-semibold text-brand-blue-dark">Assigned membership tiers</p>
      <p className="mb-2 text-xs text-brand-muted-soft">{isOpen ? 'Open spaces include every tier — assignment is disabled.' : 'Holders of the checked tiers gain access automatically.'}</p>
      <div className={`grid grid-cols-1 gap-4 sm:grid-cols-3 ${isOpen ? 'opacity-50' : ''}`}>
        {TIER_GROUPS.map((g) => (
          <div key={g.key}>
            <p className="mb-1 text-xs font-subheading font-semibold uppercase tracking-[0.05em] text-brand-muted-soft">{g.label}</p>
            <div className="space-y-1">
              {g.tierNames.map((n) => {
                const id = tierIdByName[n]
                return (
                  <label key={n} className="flex items-center gap-2 text-sm text-brand-muted">
                    <input type="checkbox" disabled={isOpen || !id} checked={!!id && selected.has(id)} onChange={() => id && toggle(id)} />
                    {n}
                  </label>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-4 rounded-lg bg-brand-canvas p-2.5 text-xs text-brand-muted-soft">
        Files uploaded to this space inherit its access — they’re visible to whoever can enter the space.
      </p>

      <div className="mt-5 flex justify-end">
        <button
          onClick={async () => {
            await patchSpace({ access_type: access })
            if (!isOpen) await act({ action: 'set-tiers', tierIds: [...selected] }, 'Access updated')
            else toast('Access updated')
          }}
          className="rounded-lg bg-brand-blue px-4 py-2 text-sm font-subheading font-semibold text-white hover:bg-brand-blue-dark"
        >
          Save access
        </button>
      </div>
    </div>
  )
}

// ─── Resources ────────────────────────────────────────────────────────────────
function ResourcesTab({
  spaceId, resources, act, onUploaded,
}: {
  spaceId: string
  resources: AdminSpaceConfig['resources']
  act: Act
  onUploaded: () => void
}) {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)

  const upload = async () => {
    if (!file) return
    setBusy(true)
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`/api/admin/community/spaces/${spaceId}/resources`, { method: 'POST', body: form })
    setBusy(false)
    if (!res.ok) return toast('Upload failed')
    toast('Resource added')
    setFile(null)
    setOpen(false)
    onUploaded()
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <PanelTitle>Resources</PanelTitle>
        <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-lg bg-brand-blue px-3 py-1.5 text-xs font-subheading font-semibold text-white hover:bg-brand-blue-dark">
          <Plus className="h-3.5 w-3.5" /> Assign resource
        </button>
      </div>
      <div className="divide-y divide-brand-hairline rounded-lg border border-brand-border">
        {resources.map((r) => (
          <div key={r.id} className="flex items-center gap-3 px-3 py-2.5">
            <span className="rounded bg-brand-canvas px-1.5 py-0.5 text-[10px] font-bold text-brand-muted-soft">{r.fileType ?? 'FILE'}</span>
            <span className="flex-1 truncate text-sm text-brand-blue-dark">{r.title}</span>
            {r.fromChat && <span className="rounded-full bg-brand-canvas px-1.5 py-0.5 text-[10px] uppercase text-brand-muted-soft">from chat</span>}
            <button onClick={() => act({ action: 'remove-resource', resourceId: r.id }, 'Removed')} className="text-xs text-red-500 hover:underline">Remove</button>
          </div>
        ))}
        {resources.length === 0 && <p className="px-3 py-4 text-center text-sm text-brand-muted-soft">No resources yet.</p>}
      </div>

      {/* FUTURE (global reference-content catalogue): the handoff (screen 20) also
          wants a "pick from existing reference content" multi-select here, in
          addition to upload. Deferred until the global resource catalogue ships
          (separate build). To wire it up then: add a tab/section to this modal that
          lists catalogue items and POSTs the chosen ids to a new
          `assign-resource` action on /api/admin/community/spaces/[id] (mirroring
          assign-training in TrainingTab). Upload-only for now. */}
      <Modal open={open} onClose={() => setOpen(false)} title="Assign resource" subtitle="Upload a file to this space’s Resources."
        footer={<>
          <button onClick={() => setOpen(false)} className={btnGhost}>Cancel</button>
          <button onClick={upload} disabled={!file || busy} className={btnPrimary}>{busy ? 'Uploading…' : 'Upload'}</button>
        </>}
      >
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-brand-border p-6 text-center text-sm text-brand-muted-soft hover:bg-brand-canvas">
          <Upload className="h-6 w-6" />
          {file ? file.name : 'Click to choose a file'}
          <input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
      </Modal>
    </div>
  )
}

// ─── Training ─────────────────────────────────────────────────────────────────
function TrainingTab({
  assigned, catalogue, act,
}: {
  assigned: AdminSpaceConfig['assignedTraining']
  catalogue: AdminSpaceConfig['trainingCatalogue']
  act: Act
}) {
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [mandatory, setMandatory] = useState(false)
  const assignedIds = new Set(assigned.map((a) => a.moduleId))
  const available = catalogue.filter((c) => !assignedIds.has(c.id))

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <PanelTitle>Training</PanelTitle>
        <button onClick={() => { setPicked(new Set()); setMandatory(false); setOpen(true) }} className="inline-flex items-center gap-1 rounded-lg bg-brand-blue px-3 py-1.5 text-xs font-subheading font-semibold text-white hover:bg-brand-blue-dark">
          <Plus className="h-3.5 w-3.5" /> Assign training
        </button>
      </div>
      <div className="divide-y divide-brand-hairline rounded-lg border border-brand-border">
        {assigned.map((a) => (
          <div key={a.moduleId} className="flex items-center gap-3 px-3 py-2.5">
            <span className="flex-1 truncate text-sm text-brand-blue-dark">{a.title}</span>
            <label className="flex items-center gap-1.5 text-xs text-brand-muted">
              <input type="checkbox" checked={a.mandatory} onChange={(e) => act({ action: 'set-training-mandatory', moduleId: a.moduleId, mandatory: e.target.checked })} />
              Mandatory
            </label>
            <button onClick={() => act({ action: 'remove-training', moduleId: a.moduleId }, 'Removed')} className="text-xs text-red-500 hover:underline">Remove</button>
          </div>
        ))}
        {assigned.length === 0 && <p className="px-3 py-4 text-center text-sm text-brand-muted-soft">No training assigned.</p>}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Assign training" subtitle="Pick courses to surface in this space."
        footer={<>
          <button onClick={() => setOpen(false)} className={btnGhost}>Cancel</button>
          <button
            disabled={picked.size === 0}
            onClick={async () => {
              for (const id of picked) await act({ action: 'assign-training', moduleId: id, mandatory })
              toast('Training assigned')
              setOpen(false)
            }}
            className={btnPrimary}
          >Assign</button>
        </>}
      >
        {available.length === 0 ? (
          <p className="text-sm text-brand-muted-soft">All published courses are already assigned.</p>
        ) : (
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {available.map((c) => (
              <label key={c.id} className="flex items-center gap-2 rounded-lg border border-brand-border px-3 py-2 text-sm text-brand-muted">
                <input type="checkbox" checked={picked.has(c.id)} onChange={() => setPicked((s) => { const n = new Set(s); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n })} />
                {c.title}
              </label>
            ))}
          </div>
        )}
        <label className="mt-3 flex items-center gap-2 text-sm text-brand-muted">
          <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} /> Make mandatory
        </label>
      </Modal>
    </div>
  )
}

// ─── Members & permissions ────────────────────────────────────────────────────
function MembersTab({
  space, members, act, patchSpace,
}: {
  space: AdminSpaceConfig['space']
  members: AdminSpaceConfig['members']
  act: Act
  patchSpace: Patch
}) {
  const [inviteOpen, setInviteOpen] = useState(false)
  const [managing, setManaging] = useState<AdminSpaceConfig['members'][number] | null>(null)

  return (
    <div>
      <PanelTitle>Members &amp; permissions</PanelTitle>

      <Field label="Who can post">
        <div className="flex gap-4 text-sm text-brand-muted">
          {(['all', 'moderators'] as const).map((p) => (
            <label key={p} className="flex items-center gap-1.5">
              <input type="radio" name="posting" defaultChecked={space.posting_policy === p} onChange={() => patchSpace({ posting_policy: p })} />
              {p === 'all' ? 'All members' : 'Moderators & staff only'}
            </label>
          ))}
        </div>
      </Field>
      <Field label="Members can upload files">
        <label className="flex items-center gap-2 text-sm text-brand-muted">
          <input type="checkbox" defaultChecked={space.allow_member_uploads} onChange={(e) => patchSpace({ allow_member_uploads: e.target.checked })} />
          Allow file uploads in chat
        </label>
      </Field>

      <div className="mt-5 mb-2 flex items-center justify-between">
        <p className="text-sm font-subheading font-semibold text-brand-blue-dark">Members &amp; roles</p>
        <button onClick={() => setInviteOpen(true)} className="inline-flex items-center gap-1 rounded-lg bg-brand-blue px-3 py-1.5 text-xs font-subheading font-semibold text-white hover:bg-brand-blue-dark">
          <Plus className="h-3.5 w-3.5" /> Invite member
        </button>
      </div>
      <div className="divide-y divide-brand-hairline rounded-lg border border-brand-border">
        {members.map((m) => (
          <div key={m.memberId} className="flex items-center gap-2 px-3 py-2.5">
            <span className="flex-1 truncate text-sm text-brand-blue-dark">{m.name}</span>
            {m.tierName && <TierPill name={m.tierName} />}
            {m.role !== 'member' && <RolePill role={m.role} />}
            {m.status === 'invited' && <span className="rounded-full bg-brand-canvas px-1.5 py-0.5 text-[10px] uppercase text-brand-muted-soft">invited</span>}
            {m.muted && <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] uppercase text-red-600">muted</span>}
            <button onClick={() => setManaging(m)} className="text-xs text-brand-blue hover:underline">Manage</button>
          </div>
        ))}
        {members.length === 0 && <p className="px-3 py-4 text-center text-sm text-brand-muted-soft">No members yet.</p>}
      </div>

      <InviteMemberModal open={inviteOpen} onClose={() => setInviteOpen(false)} act={act} />
      {managing && <ManageMemberModal member={managing} onClose={() => setManaging(null)} act={act} />}
    </div>
  )
}

type MemberHit = { id: string; first_name: string | null; last_name: string | null; email: string | null; membership_id: string | null }

function InviteMemberModal({ open, onClose, act }: { open: boolean; onClose: () => void; act: Act }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MemberHit[]>([])
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState<MemberHit | null>(null)
  const [role, setRole] = useState<SpaceRole>('member')

  const reset = () => { setQuery(''); setResults([]); setPicked(null); setRole('member') }

  // Search the real member database — admins can only invite existing members.
  const search = async (q: string) => {
    setQuery(q)
    setPicked(null)
    if (q.trim().length < 2) { setResults([]); return }
    setSearching(true)
    try {
      const res = await fetch(`/api/admin/members/search?q=${encodeURIComponent(q.trim())}`)
      const j = await res.json().catch(() => ({}))
      setResults(res.ok ? (j.members ?? []) : [])
    } finally {
      setSearching(false)
    }
  }

  const labelFor = (m: MemberHit) =>
    [m.first_name, m.last_name].filter(Boolean).join(' ') || m.email || 'Member'

  return (
    <Modal open={open} onClose={() => { reset(); onClose() }} title="Invite member" subtitle="They’ll see an invite on their Spaces directory."
      footer={<>
        <button onClick={() => { reset(); onClose() }} className={btnGhost}>Cancel</button>
        <button
          disabled={!picked}
          onClick={async () => { if (picked && await act({ action: 'invite-member', memberId: picked.id, role }, 'Invitation sent')) { reset(); onClose() } }}
          className={btnPrimary}
        >Send invitation</button>
      </>}
    >
      <Field label="Member">
        {picked ? (
          <div className="flex items-center justify-between rounded-lg border border-brand-border px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-subheading font-semibold text-brand-blue-dark">{labelFor(picked)}</p>
              {picked.email && <p className="truncate text-xs text-brand-muted-soft">{picked.email}</p>}
            </div>
            <button onClick={() => { setPicked(null); setQuery('') }} className="text-xs text-brand-blue hover:underline">Change</button>
          </div>
        ) : (
          <>
            <input
              value={query}
              onChange={(e) => search(e.target.value)}
              placeholder="Search members by name or email…"
              className={inputCls}
            />
            {query.trim().length >= 2 && (
              <div className="mt-1 max-h-44 divide-y divide-brand-hairline overflow-y-auto rounded-lg border border-brand-border">
                {searching && <p className="px-3 py-2 text-xs text-brand-muted-soft">Searching…</p>}
                {!searching && results.length === 0 && <p className="px-3 py-2 text-xs text-brand-muted-soft">No members found.</p>}
                {results.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => { setPicked(m); setResults([]) }}
                    className="block w-full px-3 py-2 text-left hover:bg-brand-canvas"
                  >
                    <p className="text-sm text-brand-blue-dark">{labelFor(m)}</p>
                    {m.email && <p className="text-xs text-brand-muted-soft">{m.email}</p>}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </Field>
      <RoleSegmented role={role} setRole={setRole} roles={['member', 'mentor']} />
    </Modal>
  )
}

function ManageMemberModal({ member, onClose, act }: { member: AdminSpaceConfig['members'][number]; onClose: () => void; act: Act }) {
  const [role, setRole] = useState<SpaceRole>(member.role)
  return (
    <Modal open onClose={onClose} title={`Manage ${member.name}`}
      footer={<>
        <button onClick={async () => { if (await act({ action: 'remove-member', memberId: member.memberId }, 'Removed from space')) onClose() }} className="rounded-lg border border-red-200 px-4 py-2 text-sm font-subheading font-semibold text-red-600 hover:bg-red-50">Remove from space</button>
        <button onClick={async () => { if (await act({ action: 'update-member-role', memberId: member.memberId, role }, 'Role saved')) onClose() }} className={btnPrimary}>Save role</button>
      </>}
    >
      <RoleSegmented role={role} setRole={setRole} />
      <div className="mt-4 flex items-center justify-between rounded-lg border border-brand-border px-3 py-2.5">
        <div>
          <p className="text-sm font-subheading font-semibold text-brand-blue-dark">Posting</p>
          <p className="text-xs text-brand-muted-soft">{member.muted ? 'Muted — can read but not post.' : 'Can post in this space.'}</p>
        </div>
        {member.muted ? (
          <button onClick={async () => { if (await act({ action: 'unmute-member', memberId: member.memberId }, 'Member unmuted')) onClose() }} className="rounded-lg border border-brand-border px-3 py-1.5 text-xs font-subheading font-semibold text-brand-muted hover:bg-brand-canvas">Unmute</button>
        ) : (
          <button onClick={async () => { if (await act({ action: 'mute-member', memberId: member.memberId }, 'Member muted')) onClose() }} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-subheading font-semibold text-red-600 hover:bg-red-50">Mute</button>
        )}
      </div>
    </Modal>
  )
}

function RoleSegmented({
  role,
  setRole,
  roles = ['member', 'mentor', 'admin'],
}: {
  role: SpaceRole
  setRole: (r: SpaceRole) => void
  roles?: SpaceRole[]
}) {
  return (
    <Field label="Role">
      <div className="inline-flex rounded-lg border border-brand-border p-0.5">
        {roles.map((r) => (
          <button key={r} onClick={() => setRole(r)} className={`rounded-[7px] px-3 py-1.5 text-sm capitalize ${role === r ? 'bg-brand-blue text-white' : 'text-brand-muted'}`}>{r}</button>
        ))}
      </div>
    </Field>
  )
}

// ─── Announcements ────────────────────────────────────────────────────────────
function AnnouncementsTab({ announcements, act }: { announcements: AdminSpaceConfig['announcements']; act: Act }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  return (
    <div>
      <PanelTitle>Announcements</PanelTitle>
      <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} /></Field>
      <Field label="Body"><textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} className={inputCls} /></Field>
      <button
        disabled={!title.trim()}
        onClick={async () => { if (await act({ action: 'publish-announcement', title: title.trim(), body: body.trim() }, 'Published')) { setTitle(''); setBody('') } }}
        className={`${btnPrimary} mt-1`}
      >Publish announcement</button>

      <div className="mt-5 divide-y divide-brand-hairline rounded-lg border border-brand-border">
        {announcements.map((a) => (
          <div key={a.id} className="flex items-start gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-subheading font-semibold text-brand-blue-dark">{a.title}</p>
              {a.body && <p className="truncate text-xs text-brand-muted-soft">{a.body}</p>}
            </div>
            <button onClick={() => act({ action: 'delete-announcement', announcementId: a.id }, 'Deleted')} className="text-xs text-red-500 hover:underline">Delete</button>
          </div>
        ))}
        {announcements.length === 0 && <p className="px-3 py-4 text-center text-sm text-brand-muted-soft">No announcements yet.</p>}
      </div>
    </div>
  )
}

// ─── Moderation ───────────────────────────────────────────────────────────────
function ModerationTab({ moderation, act }: { moderation: AdminSpaceConfig['moderation']; act: Act }) {
  return (
    <div>
      <PanelTitle>Moderation</PanelTitle>
      {moderation.length === 0 ? (
        <p className="py-6 text-center text-sm text-brand-muted-soft">No reports to review.</p>
      ) : (
        <div className="space-y-3">
          {moderation.map((r) => (
            <div key={r.flagId} className="rounded-lg border border-brand-border p-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600">
                  <Flag className="h-3 w-3" /> {r.reason ?? 'Reported'}
                </span>
                <span className="text-xs text-brand-muted-soft">{r.where} · {new Date(r.createdAt).toLocaleDateString()}</span>
              </div>
              <p className="mt-2 border-l-2 border-brand-hairline pl-2 text-sm text-brand-muted">{r.quoted}</p>
              <p className="mt-1 text-xs text-brand-muted-soft">Reported by {r.reporterName}</p>
              <div className="mt-2 flex gap-2">
                <button onClick={() => act({ action: 'remove-post', flagId: r.flagId }, 'Content removed')} className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700">Remove post</button>
                <button onClick={() => act({ action: 'dismiss-flag', flagId: r.flagId }, 'Dismissed')} className="rounded-lg border border-brand-border px-2.5 py-1 text-xs font-semibold text-brand-muted hover:bg-brand-canvas">Dismiss</button>
                <button onClick={() => act({ action: 'mute-member', flagId: r.flagId }, 'Member muted')} className="rounded-lg border border-brand-border px-2.5 py-1 text-xs font-semibold text-brand-muted hover:bg-brand-canvas">Mute member</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── shared bits ──────────────────────────────────────────────────────────────
const inputCls = 'w-full rounded-lg border border-brand-border px-3 py-2 text-sm focus:border-brand-blue focus:outline-none'
const btnPrimary = 'rounded-lg bg-brand-blue px-4 py-2 text-sm font-subheading font-semibold text-white hover:bg-brand-blue-dark disabled:opacity-50'
const btnGhost = 'rounded-lg border border-brand-border px-4 py-2 text-sm font-subheading font-semibold text-brand-muted hover:bg-brand-canvas'
const THEME_HEX: Record<SpaceTheme, string> = { space: '#7C5CFC', enviro: '#1FA97A', campaign: '#E0922F', college: '#16B6C4' }

function PanelTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 font-heading text-[18px] text-brand-blue-dark">{children}</h2>
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <label className="mb-1 block text-sm font-subheading font-semibold text-brand-blue-dark">{label}</label>
      {children}
    </div>
  )
}
