'use client'

import { useState } from 'react'
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
  X,
} from 'lucide-react'

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
const CONTENT_KINDS = ['video', 'document', 'google_doc', 'link'] as const

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
}

export interface AdminModule {
  id: string
  title: string
  description: string | null
  material_kind: (typeof KINDS)[number]
  course_type: CourseType
  start_date: string | null
  event_ref: string | null
  min_tier_rank: number
  is_published: boolean
  training_sections: AdminSection[]
  training_items: AdminLesson[]
}

const kindIcon = (k: AdminLesson['content_kind']) =>
  k === 'video' ? Video : k === 'link' || k === 'google_doc' ? Link2 : FileText

export function TrainingManager({ modules }: { modules: AdminModule[] }) {
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
            <div key={m.id} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <button
                  onClick={() => setOpen(isOpen ? null : m.id)}
                  className="flex min-w-0 items-center gap-2 text-left"
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
                  )}
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-900 text-white">
                    <GraduationCap className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-gray-900">{m.title}</p>
                    <p className="truncate text-xs text-gray-400">
                      {sections.length} {sections.length === 1 ? 'section' : 'sections'} ·{' '}
                      {m.training_items.length} {m.training_items.length === 1 ? 'lesson' : 'lessons'} ·{' '}
                      {m.material_kind.toUpperCase()}
                      {m.min_tier_rank > 0 && ' · Paid'}
                    </p>
                  </div>
                </button>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="hidden rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 sm:inline">
                    {COURSE_TYPE_LABEL[m.course_type ?? 'self_paced']}
                  </span>
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

              {isOpen && (
                <div className="space-y-5 border-t border-gray-100 bg-gray-50/60 px-4 py-4">
                  <Curriculum module={m} sections={sections} onDone={() => router.refresh()} />
                  <AssignForm moduleId={m.id} onDone={() => router.refresh()} />
                </div>
              )}
            </div>
          )
        })}
        {modules.length === 0 && (
          <p className="text-sm text-gray-400">No modules yet — create one above.</p>
        )}
      </div>
    </div>
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
        className="inline-flex items-center gap-1.5 rounded-full bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
      >
        <Plus className="h-4 w-4" /> New course
      </button>
    )
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">
          {step === 'type' ? 'Choose course type' : 'Course details'}
        </h3>
        <button onClick={reset} className="text-gray-400 hover:text-gray-600" aria-label="Cancel">
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
                      ? 'border-gray-900 bg-gray-50 ring-1 ring-gray-900'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div>
                    <p className="font-semibold text-gray-900">{t.label}</p>
                    <p className="mt-0.5 text-sm text-gray-500">{t.blurb}</p>
                  </div>
                  <span
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                      selected ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300'
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
            className="mt-4 w-full rounded-full bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-800"
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
          {courseType === 'scheduled' && (
            <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
              Course start date (sections drip relative to this)
              <input
                type="datetime-local"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-fit rounded-md border border-gray-300 px-3 py-2 text-sm font-normal"
              />
            </label>
          )}
          <div className="flex gap-2">
            <button
              onClick={create}
              disabled={busy || !title.trim()}
              className="rounded-full bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {busy ? 'Creating…' : 'Create course'}
            </button>
            <button onClick={() => setStep('type')} className="px-3 py-2 text-sm text-gray-500">
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

  const deleteSection = async (id: string) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/community/training/sections?id=${id}`, { method: 'DELETE' })
      if (res.ok) onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Curriculum</p>

      {sections.map((s) => (
        <div key={s.id} className="rounded-lg border border-gray-200 bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-3 py-2">
            <p className="truncate text-sm font-semibold text-gray-800">{s.title}</p>
            <div className="flex shrink-0 items-center gap-3">
              {m.course_type !== 'self_paced' && <DripControl section={s} onDone={onDone} />}
              <button
                onClick={() => deleteSection(s.id)}
                disabled={busy}
                className="text-gray-300 hover:text-red-500 disabled:opacity-50"
                aria-label="Delete section"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="space-y-1.5 p-3">
            {lessonsIn(s.id).map((l) => (
              <LessonRow key={l.id} lesson={l} onDone={onDone} />
            ))}
            {lessonsIn(s.id).length === 0 && (
              <p className="px-1 py-2 text-xs text-gray-400">No lessons yet.</p>
            )}
            <AddLessonForm moduleId={m.id} sectionId={s.id} count={lessonsIn(s.id).length} onDone={onDone} />
          </div>
        </div>
      ))}

      {/* Ungrouped lessons */}
      {ungrouped.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-3 py-2">
            <p className="text-sm font-semibold text-gray-500">Ungrouped lessons</p>
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
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            onClick={createSection}
            disabled={busy || !sectionTitle.trim()}
            className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            Add
          </button>
          <button onClick={() => setAddingSection(false)} className="px-2 py-2 text-sm text-gray-500">
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setAddingSection(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
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
    <label className="flex items-center gap-1 text-xs text-gray-500" title="Days after enrollment / start date before this section unlocks">
      <span className="hidden sm:inline">Drip</span>
      <input
        type="number"
        min={0}
        value={days}
        disabled={busy}
        onChange={(e) => setDays(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && save()}
        className="w-14 rounded-md border border-gray-300 px-2 py-1 text-xs disabled:opacity-50"
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
      <div className="rounded-md border border-gray-200 bg-white p-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Lesson title"
          className="mb-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Lesson notes (shown beneath the featured media)"
          rows={3}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={saveEdit}
            disabled={busy || !title.trim()}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button onClick={() => setEditing(false)} className="px-2 py-1.5 text-xs text-gray-500">
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-gray-100 bg-gray-50/60 px-3 py-2">
      <button
        onClick={() => setEditing(true)}
        className="flex min-w-0 items-center gap-2.5 text-left"
        title="Edit lesson"
      >
        <Icon className="h-4 w-4 shrink-0 text-gray-400" />
        <span className="truncate text-sm text-gray-800 hover:underline">{lesson.title}</span>
        {lesson.body && <span className="shrink-0 text-[10px] text-gray-400">· notes</span>}
      </button>
      <div className="flex shrink-0 items-center gap-2">
        <select
          value={lesson.status}
          onChange={(e) => patch({ status: e.target.value })}
          disabled={busy}
          className={`rounded-md border px-2 py-1 text-xs font-medium disabled:opacity-50 ${
            lesson.status === 'published'
              ? 'border-green-200 bg-green-50 text-green-700'
              : 'border-gray-200 bg-white text-gray-600'
          }`}
        >
          <option value="draft">Draft</option>
          <option value="published">Published</option>
        </select>
        <button
          onClick={remove}
          disabled={busy}
          className="text-gray-300 hover:text-red-500 disabled:opacity-50"
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
  const needsFile = contentKind === 'video' || contentKind === 'document'

  const submit = async () => {
    if (!title.trim()) return
    setBusy(true)
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
      if (!needsFile) fd.set('externalUrl', externalUrl)
      const res = await fetch('/api/admin/community/training/items', { method: 'POST', body: fd })
      if (res.ok) {
        setTitle('')
        setExternalUrl('')
        setFile(null)
        setMinutes('')
        setBodyText('')
        setOpenForm(false)
        onDone()
      }
    } finally {
      setBusy(false)
    }
  }

  if (!openForm) {
    return (
      <button
        onClick={() => setOpenForm(true)}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800"
      >
        <Plus className="h-3.5 w-3.5" /> Add lesson
      </button>
    )
  }

  return (
    <div className="rounded-md border border-gray-200 bg-white p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Lesson title"
          autoFocus
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <select
          value={contentKind}
          onChange={(e) => setContentKind(e.target.value as (typeof CONTENT_KINDS)[number])}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          {CONTENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {k.replace('_', ' ')}
            </option>
          ))}
        </select>
        {needsFile ? (
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
        ) : (
          <input
            value={externalUrl}
            onChange={(e) => setExternalUrl(e.target.value)}
            placeholder="https://… (Google Doc, YouTube/Vimeo embed, or link)"
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
      <textarea
        value={bodyText}
        onChange={(e) => setBodyText(e.target.value)}
        placeholder="Lesson notes (optional) — shown beneath the featured media"
        rows={2}
        className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
      />
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={submit}
          disabled={busy || !title.trim()}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Add lesson'}
        </button>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as 'draft' | 'published')}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-xs"
        >
          <option value="published">Published</option>
          <option value="draft">Draft</option>
        </select>
        <button onClick={() => setOpenForm(false)} className="px-2 py-1.5 text-xs text-gray-500">
          Cancel
        </button>
      </div>
    </div>
  )
}

/* ─── Assign to event participants ───────────────────────────────────────────── */

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
    <div className="rounded-lg border border-gray-200 bg-white p-3">
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
