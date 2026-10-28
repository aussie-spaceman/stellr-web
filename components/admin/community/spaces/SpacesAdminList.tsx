'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, Pencil } from 'lucide-react'
import { Field, Fieldset, Input, Textarea } from '@stellr/web-ui'
import { Modal } from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'
import { AccessBadge, ThemeDot, TierPill, ACCESS_META } from '@/components/community/spaces/badges'
import type { SpaceAccessType, SpaceTheme } from '@/lib/spaces'

export interface AdminSpaceRow {
  id: string
  slug: string
  name: string
  access_type: SpaceAccessType
  theme: SpaceTheme
  postingPolicy: 'all' | 'moderators'
  memberCount: number
  tierNames: string[]
}

const TH = 'whitespace-nowrap border-b border-line-light px-4 py-3 font-subheading font-semibold'
const TD = 'border-b border-line-light px-4 py-3 group-last:border-b-0'
const STICKY = 'sticky left-0 z-10 border-r border-line-light'

export function SpacesAdminList({ initial }: { initial: AdminSpaceRow[] }) {
  const router = useRouter()
  const [creating, setCreating] = useState(false)

  const stats = useMemo(() => {
    const by = (t: SpaceAccessType) => initial.filter((s) => s.access_type === t).length
    return { total: initial.length, open: by('open'), private: by('private'), secret: by('secret') }
  }, [initial])

  return (
    <div>
      <div className="mb-5 flex items-center justify-end">
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-blue px-3.5 py-2 text-sm font-subheading font-semibold text-white hover:bg-brand-blue-dark"
        >
          <Plus className="h-4 w-4" /> New Space
        </button>
      </div>

      {/* Stat cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total spaces" value={stats.total} />
        <Stat label="Open" value={stats.open} color={ACCESS_META.open.color} />
        <Stat label="Private" value={stats.private} color={ACCESS_META.private.color} />
        <Stat label="Secret" value={stats.secret} color={ACCESS_META.secret.color} />
      </div>

      {/* Table */}
      {/* Scrolls sideways on a phone instead of clipping; the space name is
          the link into it and stays at the left edge, so Edit is never the
          only way in. border-separate: a sticky cell in a collapsed table
          leaves its borders behind when it moves, so row lines live on cells. */}
      <div
        role="region"
        aria-label="Spaces"
        tabIndex={0}
        className="relative overflow-x-auto rounded-ds-card border border-line bg-white focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      >
        <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-[0.05em] text-content-muted">
              <th scope="col" className={`${TH} ${STICKY} bg-white`}>Space</th>
              <th scope="col" className={TH}>Access</th>
              <th scope="col" className={TH}>Assigned tiers</th>
              <th scope="col" className={TH}>Members</th>
              <th scope="col" className={TH}>Posting</th>
              <th scope="col" className={TH}>
                <span className="sr-only">Edit</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {initial.map((s) => (
              <tr key={s.id} className="group">
                <td className={`${TD} ${STICKY} bg-white`}>
                  <Link
                    href={`/admin/community/spaces/${s.id}`}
                    className="flex items-center gap-2 font-subheading font-semibold text-ink hover:text-primary hover:underline"
                  >
                    <ThemeDot theme={s.theme} size={14} />
                    <span>{s.name}</span>
                  </Link>
                </td>
                <td className={`${TD} whitespace-nowrap`}><AccessBadge type={s.access_type} size="sm" /></td>
                <td className={`${TD} min-w-40`}>
                  {s.access_type === 'open' ? (
                    <span className="whitespace-nowrap text-content-muted">All members</span>
                  ) : s.tierNames.length ? (
                    <span className="flex flex-wrap gap-1">
                      {s.tierNames.map((n) => <TierPill key={n} name={n} />)}
                    </span>
                  ) : (
                    <span className="text-content-muted">—</span>
                  )}
                </td>
                <td className={`${TD} whitespace-nowrap text-content-body`}>{s.memberCount}</td>
                <td className={`${TD} whitespace-nowrap text-content-body`}>
                  {s.postingPolicy === 'all' ? 'All members' : 'Moderators only'}
                </td>
                <td className={`${TD} text-right`}>
                  <Link
                    href={`/admin/community/spaces/${s.id}`}
                    className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs font-subheading font-semibold text-content-body hover:bg-surface"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Link>
                </td>
              </tr>
            ))}
            {initial.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-content-muted">
                  No spaces yet. Create your first one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <NewSpaceModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          toast('Space created')
          router.push(`/admin/community/spaces/${id}`)
        }}
      />
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-[14px] border border-brand-border bg-white p-4">
      <p className="text-xs font-subheading font-semibold uppercase tracking-[0.05em] text-brand-muted-soft">{label}</p>
      <p className="mt-1 font-heading text-[26px]" style={{ color: color ?? '#13183A' }}>{value}</p>
    </div>
  )
}

const CHECKLIST = [
  'Name & description',
  'Access & tiers',
  'Invite members',
  'Assign resources & training',
]

function NewSpaceModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [access, setAccess] = useState<SpaceAccessType>('open')
  const [busy, setBusy] = useState(false)

  const create = async () => {
    if (!name.trim()) return
    setBusy(true)
    const res = await fetch('/api/admin/community/spaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), description: description.trim(), access_type: access }),
    })
    setBusy(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      toast(j.error ?? 'Could not create space')
      return
    }
    const { id } = await res.json()
    onCreated(id)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Space"
      subtitle="Create a space, then finish setup in its config tabs."
      footer={
        <>
          <button onClick={onClose} className="rounded-lg border border-brand-border px-4 py-2 text-sm font-subheading font-semibold text-brand-muted hover:bg-brand-canvas">
            Cancel
          </button>
          <button
            onClick={create}
            disabled={!name.trim() || busy}
            className="rounded-lg bg-brand-blue px-4 py-2 text-sm font-subheading font-semibold text-white hover:bg-brand-blue-dark disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create space'}
          </button>
        </>
      }
    >
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Robotics Crew" />
      </Field>
      <Field label="Description" className="mt-3">
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="What is this space for?"
        />
      </Field>
      <Fieldset legend="Access" className="mt-3">
        <div className="space-y-2">
          {(Object.keys(ACCESS_META) as SpaceAccessType[]).map((t) => {
            const m = ACCESS_META[t]
            const selected = access === t
            return (
              <label
                key={t}
                className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors"
                style={selected ? { borderColor: m.color, background: m.tint } : { borderColor: '#E4E7F2' }}
              >
                <input type="radio" name="new-access" checked={selected} onChange={() => setAccess(t)} className="mt-0.5" />
                <span>
                  <span className="font-subheading font-semibold text-brand-blue-dark">{m.label}</span>
                  <span className="block text-xs text-brand-muted-soft">{m.blurb}</span>
                </span>
              </label>
            )
          })}
        </div>
      </Fieldset>
      <div className="mt-4 rounded-lg bg-brand-canvas p-3">
        <p className="text-xs font-subheading font-semibold uppercase tracking-[0.05em] text-brand-muted-soft">After you create</p>
        <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-xs text-brand-muted">
          {CHECKLIST.map((c) => <li key={c}>{c}</li>)}
        </ol>
      </div>
    </Modal>
  )
}
