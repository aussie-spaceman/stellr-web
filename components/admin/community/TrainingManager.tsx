'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, ChevronDown, ChevronRight, Eye, EyeOff } from 'lucide-react'

export interface AdminModule {
  id: string
  title: string
  description: string | null
  material_kind: 'general' | 'event' | 'campaign' | 'cte'
  event_ref: string | null
  min_tier_rank: number
  is_published: boolean
  training_items: { id: string }[]
}

const KINDS = ['general', 'event', 'campaign', 'cte'] as const
const CONTENT_KINDS = ['video', 'document', 'google_doc', 'link'] as const

export function TrainingManager({ modules }: { modules: AdminModule[] }) {
  const router = useRouter()
  const [open, setOpen] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)

  // New module form state
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [materialKind, setMaterialKind] = useState<(typeof KINDS)[number]>('general')
  const [eventRef, setEventRef] = useState('')
  const [paidOnly, setPaidOnly] = useState(false)

  const createModule = async () => {
    if (!title.trim()) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/community/training/modules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          materialKind,
          eventRef: eventRef || null,
          minTierRank: paidOnly ? 1 : 0,
        }),
      })
      if (res.ok) {
        setTitle('')
        setDescription('')
        setEventRef('')
        setPaidOnly(false)
        setCreating(false)
        router.refresh()
      }
    } finally {
      setBusy(false)
    }
  }

  const togglePublish = async (m: AdminModule) => {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/community/training/modules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: m.id, isPublished: !m.is_published }),
      })
      if (res.ok) router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Create module */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        {!creating ? (
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
          >
            <Plus className="h-4 w-4" /> New module
          </button>
        ) : (
          <div className="space-y-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Module title"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              rows={2}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={materialKind}
                onChange={(e) => setMaterialKind(e.target.value as (typeof KINDS)[number])}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k.toUpperCase()}
                  </option>
                ))}
              </select>
              <input
                value={eventRef}
                onChange={(e) => setEventRef(e.target.value)}
                placeholder="Sanity event _id (optional)"
                className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <label className="flex items-center gap-1.5 text-sm text-gray-600">
                <input type="checkbox" checked={paidOnly} onChange={(e) => setPaidOnly(e.target.checked)} />
                Paid only
              </label>
            </div>
            <div className="flex gap-2">
              <button
                onClick={createModule}
                disabled={busy}
                className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
              >
                Create
              </button>
              <button onClick={() => setCreating(false)} className="px-3 py-1.5 text-sm text-gray-500">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Module list */}
      <div className="space-y-3">
        {modules.map((m) => (
          <div key={m.id} className="rounded-xl border border-gray-200 bg-white">
            <div className="flex items-center justify-between px-4 py-3">
              <button
                onClick={() => setOpen(open === m.id ? null : m.id)}
                className="flex items-center gap-2 text-left"
              >
                {open === m.id ? (
                  <ChevronDown className="h-4 w-4 text-gray-400" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-gray-400" />
                )}
                <div>
                  <p className="font-medium text-gray-900">{m.title}</p>
                  <p className="text-xs text-gray-400">
                    {m.training_items.length} lessons · {m.material_kind.toUpperCase()}
                    {m.min_tier_rank > 0 && ' · Paid'}
                  </p>
                </div>
              </button>
              <div className="flex items-center gap-3">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    m.is_published ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {m.is_published ? 'Published' : 'Draft'}
                </span>
                <button
                  onClick={() => togglePublish(m)}
                  disabled={busy}
                  className="text-gray-400 hover:text-gray-700 disabled:opacity-50"
                  aria-label="Toggle publish"
                >
                  {m.is_published ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {open === m.id && (
              <div className="space-y-4 border-t border-gray-100 px-4 py-4">
                <AddItemForm moduleId={m.id} onDone={() => router.refresh()} />
                <AssignForm moduleId={m.id} onDone={() => router.refresh()} />
              </div>
            )}
          </div>
        ))}
        {modules.length === 0 && (
          <p className="text-sm text-gray-400">No modules yet — create one above.</p>
        )}
      </div>
    </div>
  )
}

function AddItemForm({ moduleId, onDone }: { moduleId: string; onDone: () => void }) {
  const [contentKind, setContentKind] = useState<(typeof CONTENT_KINDS)[number]>('video')
  const [title, setTitle] = useState('')
  const [externalUrl, setExternalUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [minutes, setMinutes] = useState('')
  const [busy, setBusy] = useState(false)
  const needsFile = contentKind === 'video' || contentKind === 'document'

  const submit = async () => {
    if (!title.trim()) return
    setBusy(true)
    try {
      const fd = new FormData()
      fd.set('moduleId', moduleId)
      fd.set('title', title)
      fd.set('contentKind', contentKind)
      if (minutes) fd.set('estimatedMinutes', minutes)
      if (needsFile && file) fd.set('file', file)
      if (!needsFile) fd.set('externalUrl', externalUrl)
      const res = await fetch('/api/admin/community/training/items', { method: 'POST', body: fd })
      if (res.ok) {
        setTitle('')
        setExternalUrl('')
        setFile(null)
        setMinutes('')
        onDone()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg bg-gray-50 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Add lesson</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Lesson title"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <select
          value={contentKind}
          onChange={(e) => setContentKind(e.target.value as (typeof CONTENT_KINDS)[number])}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          {CONTENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        {needsFile ? (
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
        ) : (
          <input
            value={externalUrl}
            onChange={(e) => setExternalUrl(e.target.value)}
            placeholder="https://… (Google Doc or link)"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        )}
        <input
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          placeholder="Est. minutes (optional)"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      </div>
      <button
        onClick={submit}
        disabled={busy}
        className="mt-2 rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {busy ? 'Saving…' : 'Add lesson'}
      </button>
    </div>
  )
}

function AssignForm({ moduleId, onDone }: { moduleId: string; onDone: () => void }) {
  const [eventRef, setEventRef] = useState('')
  const [eventRole, setEventRole] = useState('all')
  const [mandatory, setMandatory] = useState(false)
  const [dueAt, setDueAt] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!eventRef.trim()) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/community/training/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          moduleId,
          eventRef,
          eventRole,
          isMandatory: mandatory,
          dueAt: dueAt || null,
        }),
      })
      if (res.ok) {
        setEventRef('')
        setDueAt('')
        setMandatory(false)
        onDone()
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg bg-gray-50 p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        Assign to event participants
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          value={eventRef}
          onChange={(e) => setEventRef(e.target.value)}
          placeholder="Sanity event _id"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <select
          value={eventRole}
          onChange={(e) => setEventRole(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="all">All roles</option>
          <option value="school_student">School Student</option>
          <option value="school_student_manager">School Student Manager</option>
          <option value="teacher">Teacher</option>
          <option value="mentor">Mentor</option>
          <option value="parent">Parent</option>
        </select>
        <input
          type="datetime-local"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} />
          Mandatory
        </label>
      </div>
      <button
        onClick={submit}
        disabled={busy}
        className="mt-2 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
      >
        {busy ? 'Saving…' : 'Assign'}
      </button>
    </div>
  )
}
