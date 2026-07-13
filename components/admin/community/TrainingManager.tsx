'use client'

import { useEffect, useState } from 'react'
import { formatDateShort } from '@/lib/utils'
import { useRouter } from 'next/navigation'
import {
  Plus,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Check,
  Trash2,
  Video,
  FileText,
  Link2,
  GraduationCap,
  GripVertical,
  Pencil,
  X,
} from 'lucide-react'
import { DeleteEntityButton } from '@/components/admin/DeleteEntityButton'
import { ObjectAssignments, type AdminAssignment, type AdminTier } from '@/components/admin/training/ObjectAssignments'
import type { TrainableObject } from '@/lib/training-admin'
import { deriveType, THEME_META, TYPE_META, type CourseTheme } from '@/lib/training-display'

const COURSE_TYPES = [
  {
    value: 'self_paced',
    label: 'Self-paced',
    blurb: 'Course starts when a member enrolls. All content is available immediately.',
  },
  {
    value: 'structured',
    label: 'Structured',
    blurb: 'Course starts when a member enrolls. Sections are dripped relative to their enrollment date.',
  },
  {
    value: 'scheduled',
    label: 'Scheduled',
    blurb: 'Course starts on a specific date. Sections are dripped relative to that date.',
  },
] as const
type CourseType = (typeof COURSE_TYPES)[number]['value']

const COURSE_TYPE_LABEL: Record<CourseType, string> = {
  self_paced: 'Self-paced',
  structured: 'Structured',
  scheduled: 'Scheduled',
}

const KINDS = ['general', 'event', 'campaign', 'cte', 'curriculum'] as const

// Readable labels that also hint WHERE each kind surfaces on the member training
// page (training/page.tsx): general/cte/curriculum appear in the catalogue for any
// member; event/campaign only surface to registered participants via an assignment.
const KIND_LABELS: Record<(typeof KINDS)[number], string> = {
  general: 'General — Library (all members)',
  curriculum: 'Academy curriculum (all members)',
  cte: 'CTE (all members)',
  event: 'Event — only via participant assignment',
  campaign: 'Campaign — only via participant assignment',
}

const CONTENT_KINDS = ['video', 'document', 'google_doc', 'link', 'live', 'interactive'] as const

// Human label for the lesson-type dropdown (raw enum values aren't all readable).
const CONTENT_KIND_LABELS: Record<(typeof CONTENT_KINDS)[number], string> = {
  video: 'video',
  document: 'document',
  google_doc: 'google doc',
  link: 'link',
  live: 'live video room',
  interactive: 'interactive tutorial',
}

export interface AdminSection {
  id: string
  title: string
  display_order: number
  drip_days: number
}

export interface AdminLesson {
  id: string
  title: string
  content_kind: (typeof CONTENT_KINDS)[number]
  status: 'draft' | 'published'
  section_id: string | null
  display_order: number
  estimated_minutes: number | null
  body: string | null
  external_url?: string | null
  /** For 'interactive' lessons: key into the code registry (lib/interactive-lessons-meta.ts). */
  interactive_key?: string | null
  /** For 'live' (Record) lessons: none | pending | available. */
  recording_status?: string | null
}

export interface AdminModule {
  id: string
  title: string
  description: string | null
  material_kind: (typeof KINDS)[number]
  course_type: CourseType
  theme: CourseTheme | null
  cert_template_path: string | null
  start_date: string | null
  event_ref: string | null
  min_tier_rank: number
  is_published: boolean
  training_sections: AdminSection[]
  training_items: AdminLesson[]
  course_object_assignments: AdminAssignment[]
}

const kindIcon = (k: AdminLesson['content_kind']) =>
  k === 'video' || k === 'live' ? Video : k === 'link' || k === 'google_doc' ? Link2 : FileText

export function TrainingManager({
  modules,
  objects = [],
  tiers = [],
}: {
  modules: AdminModule[]
  objects?: TrainableObject[]
  tiers?: AdminTier[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
      <CreateModule onDone={() => router.refresh()} />

      {/* Module list */}
      <div className="space-y-3">
        {modules.map((m) => {
          const sections = [...m.training_sections].sort((a, b) => a.display_order - b.display_order)
          const isOpen = open === m.id
          return (
            <div key={m.id} className="overflow-hidden rounded-xl border border-brand-border bg-white">
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <button
                  onClick={() => setOpen(isOpen ? null : m.id)}
                  className="flex min-w-0 items-center gap-2 text-left"
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-brand-muted-soft" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-brand-muted-soft" />
                  )}
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-blue-dark text-white">
                    <GraduationCap className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-brand-blue-dark">{m.title}</p>
                    <p className="truncate text-xs text-brand-muted-soft">
                      {sections.length} {sections.length === 1 ? 'section' : 'sections'} ·{' '}
                      {m.training_items.length} {m.training_items.length === 1 ? 'lesson' : 'lessons'} ·{' '}
                      {m.material_kind.toUpperCase()}
                      {m.min_tier_rank > 0 && ' · Paid'}
                    </p>
                  </div>
                </button>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="hidden rounded-full bg-brand-hairline px-2 py-0.5 text-[11px] font-medium text-brand-muted sm:inline">
                    {COURSE_TYPE_LABEL[m.course_type ?? 'self_paced']}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      m.is_published ? 'bg-green-50 text-green-700' : 'bg-brand-hairline text-brand-muted-soft'
                    }`}
                  >
                    {m.is_published ? 'Published' : 'Draft'}
                  </span>
                  <button
                    onClick={() => togglePublish(m)}
                    disabled={busy}
                    className="text-brand-muted-soft hover:text-brand-muted disabled:opacity-50"
                    aria-label={m.is_published ? 'Unpublish course' : 'Publish course'}
                    title={m.is_published ? 'Unpublish (hide from members)' : 'Publish (make visible to members)'}
                  >
                    {m.is_published ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {isOpen && (
                <div className="space-y-5 border-t border-brand-hairline bg-brand-canvas/60 px-4 py-4">
                  <CourseSettings module={m} onDone={() => router.refresh()} />
                  <ObjectAssignments
                    moduleId={m.id}
                    assignments={m.course_object_assignments ?? []}
                    objects={objects}
                    tiers={tiers}
                  />
                  <Curriculum module={m} sections={sections} onDone={() => router.refresh()} />
                </div>
              )}
            </div>
          )
        })}
        {modules.length === 0 && (
          <p className="text-sm text-brand-muted-soft">No modules yet — create one above.</p>
        )}
      </div>
    </div>
  )
}

/* ─── Course settings (rename + delete) ──────────────────────────────────────── */

function CourseSettings({ module: m, onDone }: { module: AdminModule; onDone: () => void }) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(m.title)
  const [description, setDescription] = useState(m.description ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    if (!title.trim()) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/community/training/modules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: m.id, title, description }),
      })
      if (res.ok) {
        setEditing(false)
        onDone()
      } else {
        const d = await res.json().catch(() => ({}))
        setError(d.error || 'Could not save changes')
      }
    } finally {
      setBusy(false)
    }
  }

  const cancel = () => {
    setEditing(false)
    setError(null)
    setTitle(m.title)
    setDescription(m.description ?? '')
  }

  // Change the course's material kind in place. This controls where the course
  // surfaces for members (see KIND_LABELS) — switching Event→General is what makes
  // a course appear in the membership catalogue without recreating it.
  const changeKind = async (materialKind: string) => {
    if (materialKind === m.material_kind) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/community/training/modules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: m.id, materialKind }),
      })
      if (res.ok) onDone()
      else {
        const d = await res.json().catch(() => ({}))
        setError(d.error || 'Could not change course type')
      }
    } finally {
      setBusy(false)
    }
  }

  // Theme drives the accent colour across member screens + certificates.
  const changeTheme = async (theme: string) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/community/training/modules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: m.id, theme: theme || null }),
      })
      if (res.ok) onDone()
      else setError('Could not change theme')
    } finally {
      setBusy(false)
    }
  }

  const typeMeta = TYPE_META[deriveType(m.material_kind)]

  if (editing) {
    return (
      <div className="space-y-2 rounded-lg border border-brand-border bg-white p-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Course title"
          autoFocus
          className="w-full rounded-md border border-brand-border px-3 py-2 text-sm"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          rows={2}
          className="w-full rounded-md border border-brand-border px-3 py-2 text-sm"
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex items-center gap-2">
          <button
            onClick={save}
            disabled={busy || !title.trim()}
            className="rounded-md bg-brand-blue-dark px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-blue-dark disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button onClick={cancel} className="px-2 py-1.5 text-xs text-brand-muted-soft">
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-border bg-white px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-muted hover:text-brand-blue-dark"
        >
          <Pencil className="h-3.5 w-3.5" /> Rename course
        </button>
        <label
          className="flex items-center gap-1.5 text-xs font-medium text-brand-muted-soft"
          title="Controls where this course surfaces for members. General/Curriculum/CTE show in the training library for all members; Event/Campaign only appear via a participant assignment."
        >
          Shows in
          <select
            value={m.material_kind}
            onChange={(e) => changeKind(e.target.value)}
            disabled={busy}
            className="rounded-md border border-brand-border px-2 py-1 text-xs font-medium text-brand-muted disabled:opacity-50"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs font-medium text-brand-muted-soft" title="Accent theme shown on member course rows, cards and certificates.">
          Theme
          <select
            value={m.theme ?? ''}
            onChange={(e) => changeTheme(e.target.value)}
            disabled={busy}
            className="rounded-md border border-brand-border px-2 py-1 text-xs font-medium text-brand-muted disabled:opacity-50"
          >
            <option value="">None</option>
            {(['space', 'environmental', 'campaign'] as CourseTheme[]).map((t) => (
              <option key={t} value={t}>{THEME_META[t].label}</option>
            ))}
          </select>
        </label>
        <span
          className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
          style={{ background: typeMeta.tint, color: typeMeta.ink }}
          title="Type is derived from the course kind"
        >
          {typeMeta.label}
        </span>
        <CertTemplateControl module={m} onDone={onDone} />
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
      <DeleteEntityButton
        entity="training_module"
        id={m.id}
        name={m.title}
        softDeletable={false}
        label="Delete course"
        className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-600 hover:text-red-800"
      />
    </div>
  )
}

/* ─── Certificate template (optional uploaded PDF) ──────────────────────────── */

function CertTemplateControl({ module: m, onDone }: { module: AdminModule; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const has = !!m.cert_template_path

  const upload = async (file: File) => {
    setBusy(true)
    try {
      const fd = new FormData()
      fd.set('moduleId', m.id)
      fd.set('file', file)
      const res = await fetch('/api/admin/community/training/cert-template', { method: 'POST', body: fd })
      if (res.ok) onDone()
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/community/training/cert-template?moduleId=${m.id}`, { method: 'DELETE' })
      if (res.ok) onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-brand-muted-soft" title="Optional PDF template for this course's completion certificate. If unset, a default Stellr certificate is generated.">
      Certificate
      {has ? (
        <>
          <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">Template set</span>
          <button onClick={clear} disabled={busy} className="text-brand-muted-soft hover:text-red-500 disabled:opacity-50">
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      ) : (
        <label className="cursor-pointer rounded-md border border-brand-border px-2 py-1 text-[11px] font-medium text-brand-muted hover:bg-brand-canvas">
          {busy ? 'Uploading…' : 'Upload PDF'}
          <input
            type="file"
            accept="application/pdf"
            className="hidden"
            disabled={busy}
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
        </label>
      )}
    </span>
  )
}

/* ─── Create module (with course-type chooser) ──────────────────────────────── */

function CreateModule({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<'idle' | 'type' | 'details'>('idle')
  const [courseType, setCourseType] = useState<CourseType>('self_paced')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [materialKind, setMaterialKind] = useState<(typeof KINDS)[number]>('general')
  const [eventRef, setEventRef] = useState('')
  const [startDate, setStartDate] = useState('')
  const [paidOnly, setPaidOnly] = useState(false)
  const [busy, setBusy] = useState(false)

  const reset = () => {
    setStep('idle')
    setCourseType('self_paced')
    setTitle('')
    setDescription('')
    setEventRef('')
    setStartDate('')
    setPaidOnly(false)
  }

  const create = async () => {
    if (!title.trim()) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/community/training/modules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description,
          courseType,
          startDate: courseType === 'scheduled' && startDate ? startDate : null,
          materialKind,
          eventRef: eventRef || null,
          minTierRank: paidOnly ? 1 : 0,
        }),
      })
      if (res.ok) {
        reset()
        onDone()
      }
    } finally {
      setBusy(false)
    }
  }

  if (step === 'idle') {
    return (
      <button
        onClick={() => setStep('type')}
        className="inline-flex items-center gap-1.5 rounded-full bg-brand-blue-dark px-4 py-2 text-sm font-medium text-white hover:bg-brand-blue-dark"
      >
        <Plus className="h-4 w-4" /> New course
      </button>
    )
  }

  return (
    <div className="rounded-xl border border-brand-border bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold text-brand-blue-dark">
          {step === 'type' ? 'Choose course type' : 'Course details'}
        </h3>
        <button onClick={reset} className="text-brand-muted-soft hover:text-brand-muted" aria-label="Cancel">
          <X className="h-4 w-4" />
        </button>
      </div>

      {step === 'type' ? (
        <>
          <div className="space-y-3">
            {COURSE_TYPES.map((t) => {
              const selected = courseType === t.value
              return (
                <button
                  key={t.value}
                  onClick={() => setCourseType(t.value)}
                  className={`flex w-full items-start justify-between gap-3 rounded-xl border p-4 text-left transition ${
                    selected
                      ? 'border-brand-border bg-brand-canvas ring-1 ring-brand-border'
                      : 'border-brand-border hover:border-brand-border'
                  }`}
                >
                  <div>
                    <p className="font-semibold text-brand-blue-dark">{t.label}</p>
                    <p className="mt-0.5 text-sm text-brand-muted-soft">{t.blurb}</p>
                  </div>
                  <span
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                      selected ? 'border-brand-border bg-brand-blue-dark text-white' : 'border-brand-border'
                    }`}
                  >
                    {selected && <Check className="h-3 w-3" />}
                  </span>
                </button>
              )
            })}
          </div>
          <button
            onClick={() => setStep('details')}
            className="mt-4 w-full rounded-full bg-brand-blue-dark px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-blue-dark"
          >
            Next
          </button>
        </>
      ) : (
        <div className="space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Course title"
            autoFocus
            className="w-full rounded-md border border-brand-border px-3 py-2 text-sm"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={2}
            className="w-full rounded-md border border-brand-border px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={materialKind}
              onChange={(e) => setMaterialKind(e.target.value as (typeof KINDS)[number])}
              title="Controls where this course surfaces for members"
              className="rounded-md border border-brand-border px-3 py-2 text-sm"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
            <input
              value={eventRef}
              onChange={(e) => setEventRef(e.target.value)}
              placeholder="Competition slug (optional — links course to a specific event)"
              className="flex-1 rounded-md border border-brand-border px-3 py-2 text-sm"
            />
            <label
              className="flex items-center gap-1.5 text-sm text-brand-muted"
              title="If checked, only members with a paid tier can access this course"
            >
              <input type="checkbox" checked={paidOnly} onChange={(e) => setPaidOnly(e.target.checked)} />
              Paid only
            </label>
          </div>
          {courseType === 'scheduled' && (
            <label className="flex flex-col gap-1 text-xs font-medium text-brand-muted">
              Course start date (sections drip relative to this)
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-fit rounded-md border border-brand-border px-3 py-2 text-sm font-normal"
              />
            </label>
          )}
          <div className="flex gap-2">
            <button
              onClick={create}
              disabled={busy || !title.trim()}
              className="rounded-full bg-brand-blue-dark px-4 py-2 text-sm font-medium text-white hover:bg-brand-blue-dark disabled:opacity-50"
            >
              {busy ? 'Creating…' : 'Create course'}
            </button>
            <button onClick={() => setStep('type')} className="px-3 py-2 text-sm text-brand-muted-soft">
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Curriculum (sections + lessons) ────────────────────────────────────────── */

function Curriculum({
  module: m,
  sections,
  onDone,
}: {
  module: AdminModule
  sections: AdminSection[]
  onDone: () => void
}) {
  const [addingSection, setAddingSection] = useState(false)
  const [sectionTitle, setSectionTitle] = useState('')
  const [busy, setBusy] = useState(false)
  // Local section order for drag-and-drop; resynced when the server set changes.
  const [orderIds, setOrderIds] = useState<string[]>(sections.map((s) => s.id))
  const [dragId, setDragId] = useState<string | null>(null)

  const idsKey = sections.map((s) => s.id).join(',')
  useEffect(() => {
    setOrderIds(sections.map((s) => s.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey])

  const byId = new Map(sections.map((s) => [s.id, s]))
  const ordered = orderIds.map((id) => byId.get(id)).filter((s): s is AdminSection => !!s)

  const lessonsIn = (sectionId: string | null) =>
    m.training_items
      .filter((i) => i.section_id === sectionId)
      .sort((a, b) => a.display_order - b.display_order)
  const ungrouped = lessonsIn(null)

  const createSection = async () => {
    if (!sectionTitle.trim()) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/community/training/sections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          moduleId: m.id,
          title: sectionTitle,
          displayOrder: sections.length,
        }),
      })
      if (res.ok) {
        setSectionTitle('')
        setAddingSection(false)
        onDone()
      }
    } finally {
      setBusy(false)
    }
  }

  // Reorder live as the dragged section passes over another, then persist the
  // resulting display_order for every section that moved on drop.
  const reorderOver = (overId: string) => {
    if (!dragId || dragId === overId) return
    setOrderIds((prev) => {
      const from = prev.indexOf(dragId)
      const to = prev.indexOf(overId)
      if (from === -1 || to === -1) return prev
      const next = [...prev]
      next.splice(from, 1)
      next.splice(to, 0, dragId)
      return next
    })
  }

  const persistOrder = async () => {
    const ids = orderIds
    setDragId(null)
    const moved = ids.some((id, idx) => (byId.get(id)?.display_order ?? idx) !== idx)
    if (!moved) return
    try {
      await Promise.all(
        ids
          .map((id, idx) =>
            (byId.get(id)?.display_order ?? idx) === idx
              ? null
              : fetch('/api/admin/community/training/sections', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ id, displayOrder: idx }),
                })
          )
          .filter((p): p is Promise<Response> => p !== null)
      )
    } finally {
      onDone()
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-subheading font-semibold uppercase tracking-wide text-brand-muted-soft">Curriculum</p>
        {ordered.length > 1 && <p className="text-[11px] text-brand-muted-soft">Drag sections to reorder</p>}
      </div>

      {ordered.map((s) => (
        <SectionCard
          key={s.id}
          module={m}
          section={s}
          lessons={lessonsIn(s.id)}
          reorderable={ordered.length > 1}
          dragging={dragId === s.id}
          onDragStart={() => setDragId(s.id)}
          onDragEnter={() => reorderOver(s.id)}
          onDrop={persistOrder}
          onDragEnd={() => setDragId(null)}
          onDone={onDone}
        />
      ))}

      {/* Ungrouped lessons */}
      {ungrouped.length > 0 && (
        <div className="rounded-lg border border-brand-border bg-white">
          <div className="border-b border-brand-hairline px-3 py-2">
            <p className="text-sm font-semibold text-brand-muted-soft">Ungrouped lessons</p>
          </div>
          <div className="space-y-1.5 p-3">
            {ungrouped.map((l) => (
              <LessonRow key={l.id} lesson={l} onDone={onDone} />
            ))}
          </div>
        </div>
      )}

      {/* Add section */}
      {addingSection ? (
        <div className="flex items-center gap-2">
          <input
            value={sectionTitle}
            onChange={(e) => setSectionTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createSection()}
            placeholder="Section name"
            autoFocus
            className="flex-1 rounded-md border border-brand-border px-3 py-2 text-sm"
          />
          <button
            onClick={createSection}
            disabled={busy || !sectionTitle.trim()}
            className="rounded-md bg-brand-blue-dark px-3 py-2 text-sm font-medium text-white hover:bg-brand-blue-dark disabled:opacity-50"
          >
            Add
          </button>
          <button onClick={() => setAddingSection(false)} className="px-2 py-2 text-sm text-brand-muted-soft">
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setAddingSection(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-brand-border bg-white px-3 py-1.5 text-sm font-medium text-brand-muted hover:bg-brand-canvas"
        >
          <Plus className="h-4 w-4" /> Add section
        </button>
      )}

      {/* Add lesson without a section (only useful before any sections exist) */}
      {sections.length === 0 && (
        <AddLessonForm moduleId={m.id} sectionId={null} count={ungrouped.length} onDone={onDone} />
      )}
    </div>
  )
}

function SectionCard({
  module: m,
  section: s,
  lessons,
  reorderable,
  dragging,
  onDragStart,
  onDragEnter,
  onDrop,
  onDragEnd,
  onDone,
}: {
  module: AdminModule
  section: AdminSection
  lessons: AdminLesson[]
  reorderable: boolean
  dragging: boolean
  onDragStart: () => void
  onDragEnter: () => void
  onDrop: () => void
  onDragEnd: () => void
  onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(s.title)

  const rename = async () => {
    const next = title.trim()
    if (!next || next === s.title) {
      setEditing(false)
      setTitle(s.title)
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/admin/community/training/sections', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: s.id, title: next }),
      })
      if (res.ok) {
        setEditing(false)
        onDone()
      }
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/community/training/sections?id=${s.id}`, { method: 'DELETE' })
      if (res.ok) onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        onDrop()
      }}
      className={`rounded-lg border bg-white transition ${
        dragging ? 'border-brand-border opacity-60' : 'border-brand-border'
      }`}
    >
      <div
        draggable={reorderable && !editing}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        className="flex items-center justify-between gap-2 border-b border-brand-hairline px-3 py-2"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {reorderable && (
            <span className="cursor-grab text-brand-muted-soft hover:text-brand-muted-soft" title="Drag to reorder">
              <GripVertical className="h-4 w-4" />
            </span>
          )}
          {editing ? (
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={rename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') rename()
                if (e.key === 'Escape') {
                  setTitle(s.title)
                  setEditing(false)
                }
              }}
              disabled={busy}
              autoFocus
              className="min-w-0 flex-1 rounded-md border border-brand-border px-2 py-1 text-sm"
            />
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="min-w-0 truncate text-left text-sm font-semibold text-brand-blue-dark hover:underline"
              title="Rename section"
            >
              {s.title}
            </button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {m.course_type !== 'self_paced' && <DripControl section={s} onDone={onDone} />}
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="text-brand-muted-soft hover:text-brand-muted"
              aria-label="Rename section"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={remove}
            disabled={busy}
            className="text-brand-muted-soft hover:text-red-500 disabled:opacity-50"
            aria-label="Delete section"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="space-y-1.5 p-3">
        {lessons.map((l) => (
          <LessonRow key={l.id} lesson={l} onDone={onDone} />
        ))}
        {lessons.length === 0 && <p className="px-1 py-2 text-xs text-brand-muted-soft">No lessons yet.</p>}
        <AddLessonForm moduleId={m.id} sectionId={s.id} count={lessons.length} onDone={onDone} />
      </div>
    </div>
  )
}

function DripControl({ section, onDone }: { section: AdminSection; onDone: () => void }) {
  const [days, setDays] = useState(String(section.drip_days ?? 0))
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const n = parseInt(days, 10)
    if (!Number.isFinite(n) || n === section.drip_days) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/community/training/sections', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: section.id, dripDays: n }),
      })
      if (res.ok) onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <label className="flex items-center gap-1 text-xs text-brand-muted-soft" title="Days after enrollment / start date before this section unlocks">
      <span className="hidden sm:inline">Drip</span>
      <input
        type="number"
        min={0}
        value={days}
        disabled={busy}
        onChange={(e) => setDays(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && save()}
        className="w-14 rounded-md border border-brand-border px-2 py-1 text-xs disabled:opacity-50"
      />
      <span>days</span>
    </label>
  )
}

function LessonRow({ lesson, onDone }: { lesson: AdminLesson; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(lesson.title)
  const [body, setBody] = useState(lesson.body ?? '')
  const Icon = kindIcon(lesson.content_kind)

  const patch = async (fields: Record<string, unknown>) => {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/community/training/items', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: lesson.id, ...fields }),
      })
      if (res.ok) onDone()
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/community/training/items?id=${lesson.id}`, {
        method: 'DELETE',
      })
      if (res.ok) onDone()
    } finally {
      setBusy(false)
    }
  }

  const saveEdit = async () => {
    await patch({ title, body })
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="rounded-md border border-brand-border bg-white p-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Lesson title"
          className="mb-2 w-full rounded-md border border-brand-border px-3 py-2 text-sm"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Lesson notes (shown beneath the featured media)"
          rows={3}
          className="w-full rounded-md border border-brand-border px-3 py-2 text-sm"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={saveEdit}
            disabled={busy || !title.trim()}
            className="rounded-md bg-brand-blue-dark px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-blue-dark disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button onClick={() => setEditing(false)} className="px-2 py-1.5 text-xs text-brand-muted-soft">
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-brand-hairline bg-brand-canvas/60 px-3 py-2">
      <button
        onClick={() => setEditing(true)}
        className="flex min-w-0 items-center gap-2.5 text-left"
        title="Edit lesson"
      >
        <Icon className="h-4 w-4 shrink-0 text-brand-muted-soft" />
        <span className="truncate text-sm text-brand-blue-dark hover:underline">{lesson.title}</span>
        {lesson.body && <span className="shrink-0 text-[10px] text-brand-muted-soft">· notes</span>}
      </button>
      <div className="flex shrink-0 items-center gap-2">
        <select
          value={lesson.status}
          onChange={(e) => patch({ status: e.target.value })}
          disabled={busy}
          className={`rounded-md border px-2 py-1 text-xs font-medium disabled:opacity-50 ${
            lesson.status === 'published'
              ? 'border-green-200 bg-green-50 text-green-700'
              : 'border-brand-border bg-white text-brand-muted'
          }`}
        >
          <option value="draft">Draft</option>
          <option value="published">Published</option>
        </select>
        <button
          onClick={remove}
          disabled={busy}
          className="text-brand-muted-soft hover:text-red-500 disabled:opacity-50"
          aria-label="Delete lesson"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

function AddLessonForm({
  moduleId,
  sectionId,
  count,
  onDone,
}: {
  moduleId: string
  sectionId: string | null
  count: number
  onDone: () => void
}) {
  const [openForm, setOpenForm] = useState(false)
  const [contentKind, setContentKind] = useState<(typeof CONTENT_KINDS)[number]>('video')
  const [title, setTitle] = useState('')
  const [externalUrl, setExternalUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [minutes, setMinutes] = useState('')
  const [bodyText, setBodyText] = useState('')
  const [status, setStatus] = useState<'draft' | 'published'>('published')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const needsFile = contentKind === 'video' || contentKind === 'document'
  const needsUrl = contentKind === 'google_doc' || contentKind === 'link'
  // 'live' needs neither a file nor a URL — the room is created from the item id.
  const missingMedia = needsFile ? !file : needsUrl ? !externalUrl.trim() : false

  const submit = async () => {
    if (!title.trim()) return
    if (needsFile && !file) {
      setError(`Choose a ${contentKind} file to upload, or switch the type to a link.`)
      return
    }
    if (needsUrl && !externalUrl.trim()) {
      setError('Add a URL for this lesson, or switch the type to a video/document upload.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.set('moduleId', moduleId)
      if (sectionId) fd.set('sectionId', sectionId)
      fd.set('title', title)
      fd.set('contentKind', contentKind)
      fd.set('status', status)
      fd.set('displayOrder', String(count))
      if (minutes) fd.set('estimatedMinutes', minutes)
      if (bodyText.trim()) fd.set('body', bodyText)
      if (needsFile && file) fd.set('file', file)
      if (needsUrl) fd.set('externalUrl', externalUrl)
      const res = await fetch('/api/admin/community/training/items', { method: 'POST', body: fd })
      if (res.ok) {
        setTitle('')
        setExternalUrl('')
        setFile(null)
        setMinutes('')
        setBodyText('')
        setError(null)
        setOpenForm(false)
        onDone()
      } else {
        const d = await res.json().catch(() => ({}))
        setError(d.error || `Could not add lesson (${res.status})`)
      }
    } catch {
      setError('Network error — please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!openForm) {
    return (
      <button
        onClick={() => setOpenForm(true)}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-brand-muted-soft hover:bg-brand-hairline hover:text-brand-blue-dark"
      >
        <Plus className="h-3.5 w-3.5" /> Add lesson
      </button>
    )
  }

  return (
    <div className="rounded-md border border-brand-border bg-white p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Lesson title"
          autoFocus
          className="rounded-md border border-brand-border px-3 py-2 text-sm"
        />
        <select
          value={contentKind}
          onChange={(e) => {
            setContentKind(e.target.value as (typeof CONTENT_KINDS)[number])
            setError(null)
          }}
          className="rounded-md border border-brand-border px-3 py-2 text-sm"
        >
          {CONTENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {CONTENT_KIND_LABELS[k]}
            </option>
          ))}
        </select>
        {needsFile ? (
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
        ) : needsUrl ? (
          <input
            value={externalUrl}
            onChange={(e) => setExternalUrl(e.target.value)}
            placeholder="https://… (Google Doc, YouTube/Vimeo embed, or link)"
            className="rounded-md border border-brand-border px-3 py-2 text-sm"
          />
        ) : (
          <p className="self-center text-xs text-brand-muted-soft">
            A live video room opens in the lesson; the recording replaces it afterwards.
          </p>
        )}
        <input
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          placeholder="Est. minutes (optional)"
          className="rounded-md border border-brand-border px-3 py-2 text-sm"
        />
      </div>
      <textarea
        value={bodyText}
        onChange={(e) => setBodyText(e.target.value)}
        placeholder="Lesson notes (optional) — shown beneath the featured media"
        rows={2}
        className="mt-2 w-full rounded-md border border-brand-border px-3 py-2 text-sm"
      />
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={submit}
          disabled={busy || !title.trim() || missingMedia}
          className="rounded-md bg-brand-blue-dark px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-blue-dark disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Add lesson'}
        </button>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as 'draft' | 'published')}
          className="rounded-md border border-brand-border px-2 py-1.5 text-xs"
        >
          <option value="published">Published</option>
          <option value="draft">Draft</option>
        </select>
        <button onClick={() => setOpenForm(false)} className="px-2 py-1.5 text-xs text-brand-muted-soft">
          Cancel
        </button>
      </div>
    </div>
  )
}

/* ─── (AssignForm removed — course-to-competition assignment moved to the     ── */
/* ─── event's Training tab: /admin/competitions/[slug]?tab=training                ── */
/* ─── Existing training_assignments rows remain and still surface to members. ── */

