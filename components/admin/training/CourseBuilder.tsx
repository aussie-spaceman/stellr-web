'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus, Trash2, GripVertical, Pencil, Check, X, ChevronDown, ChevronRight,
  Radio, Video, FileText, Paperclip, Link2, Play, Upload,
} from 'lucide-react'
import { DeleteEntityButton } from '@/components/admin/DeleteEntityButton'
import { ObjectAssignments, type AdminTier } from '@/components/admin/training/ObjectAssignments'
import { RecordSession } from '@/components/admin/training/RecordSession'
import type { TrainableObject } from '@/lib/training-admin'
import type { AdminModule, AdminSection, AdminLesson } from '@/components/admin/community/TrainingManager'
import { deriveType, THEME_META, TYPE_META, type CourseTheme } from '@/lib/training-display'

// Course builder — design-faithful single-course editor: course selector, meta
// card (inline title · Theme · Type · Certificate · Delete/Save draft/Publish),
// Assignments & requirements, then a 2-col Curriculum + Lesson editor with the
// 4-up content-type picker. Reuses the existing modules/sections/items APIs.

const KINDS = ['general', 'event', 'campaign', 'cte', 'curriculum'] as const
const KIND_LABELS: Record<(typeof KINDS)[number], string> = {
  general: 'General — Library (all members)',
  curriculum: 'Academy curriculum (all members)',
  cte: 'CTE (all members)',
  event: 'Event — only via participant assignment',
  campaign: 'Campaign — only via participant assignment',
}

// The 4-up lesson content types (design) mapped onto our content_kind enum.
type ContentKey = AdminLesson['content_kind']
const CONTENT_TYPES: {
  key: ContentKey
  label: string
  Icon: typeof Radio
  input: 'none' | 'url' | 'file'
  title: string
  desc: string
  cta: string
  accept?: string
}[] = [
  { key: 'live', label: 'Record', Icon: Radio, input: 'none', title: 'Live recording session', desc: 'Opens an in-browser Jitsi room. The recording saves to this lesson automatically when the session ends.', cta: 'No upload needed' },
  { key: 'link', label: 'Video link', Icon: Video, input: 'url', title: 'Paste a video URL', desc: 'YouTube, Vimeo or any embeddable video link.', cta: 'Add URL' },
  { key: 'google_doc', label: 'Google Doc', Icon: FileText, input: 'url', title: 'Paste a Google Doc URL', desc: 'A shared Google Doc shown inline in the lesson.', cta: 'Add URL' },
  { key: 'document', label: 'Resource', Icon: Paperclip, input: 'file', title: 'Upload a file', desc: 'A PDF or document attached to this lesson.', cta: 'Choose file', accept: '.pdf,.doc,.docx,.ppt,.pptx' },
]
const typeIcon = (k: ContentKey) =>
  k === 'live' ? Radio : k === 'link' ? Video : k === 'google_doc' ? FileText : k === 'video' ? Play : Paperclip

/* ─── Root ───────────────────────────────────────────────────────────────── */

export function CourseBuilder({
  courses,
  objects,
  tiers,
  initialCourseId,
}: {
  courses: AdminModule[]
  objects: TrainableObject[]
  tiers: AdminTier[]
  initialCourseId?: string
}) {
  const router = useRouter()
  const [selectedId, setSelectedId] = useState<string>(
    initialCourseId && courses.some((c) => c.id === initialCourseId) ? initialCourseId : courses[0]?.id ?? ''
  )
  const [creating, setCreating] = useState(false)
  const course = courses.find((c) => c.id === selectedId)

  return (
    <div className="space-y-5">
      {/* Course selector */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-semibold text-brand-muted">Editing</label>
        <div className="relative">
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="appearance-none rounded-lg border border-brand-border bg-white py-2 pl-3 pr-9 text-sm font-medium text-brand-blue-dark focus:border-brand-blue focus:outline-none"
          >
            {courses.length === 0 && <option value="">No courses yet</option>}
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} {c.is_published ? '' : '(draft)'}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-muted-soft" />
        </div>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 rounded-full bg-brand-blue-dark px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> New course
        </button>
      </div>

      {creating && (
        <CreateCourse
          onCancel={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false)
            setSelectedId(id)
            router.refresh()
          }}
        />
      )}

      {!course ? (
        <p className="rounded-2xl border border-dashed border-brand-border bg-white p-8 text-center text-sm text-brand-muted-soft">
          {creating ? '' : 'No course selected — create one to start building.'}
        </p>
      ) : (
        <>
          <CourseMetaCard key={course.id} course={course} onDone={() => router.refresh()} />
          <ObjectAssignments
            key={`assign-${course.id}`}
            moduleId={course.id}
            assignments={course.course_object_assignments ?? []}
            objects={objects}
            tiers={tiers}
          />
          <Curriculum key={`curr-${course.id}`} course={course} onDone={() => router.refresh()} />
        </>
      )}
    </div>
  )
}

/* ─── Course meta card ───────────────────────────────────────────────────── */

function CourseMetaCard({ course: m, onDone }: { course: AdminModule; onDone: () => void }) {
  const [title, setTitle] = useState(m.title)
  const [busy, setBusy] = useState(false)
  const typeMeta = TYPE_META[deriveType(m.material_kind)]

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/community/training/modules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: m.id, ...body }),
      })
      if (res.ok) onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border border-brand-border bg-white p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-muted-soft">Course title</p>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title !== m.title && patch({ title: title.trim() })}
            className="mt-1 w-full border-0 border-b border-transparent bg-transparent p-0 font-heading text-2xl font-bold text-brand-blue-dark focus:border-brand-border focus:outline-none"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs font-medium text-brand-muted-soft">
              Theme
              <select
                value={m.theme ?? ''}
                onChange={(e) => patch({ theme: e.target.value || null })}
                disabled={busy}
                className="rounded-md border border-brand-border px-2 py-1 text-xs font-medium text-brand-muted"
              >
                <option value="">None</option>
                {(['space', 'environmental', 'campaign'] as CourseTheme[]).map((t) => (
                  <option key={t} value={t}>{THEME_META[t].label}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs font-medium text-brand-muted-soft">
              Shows in
              <select
                value={m.material_kind}
                onChange={(e) => patch({ materialKind: e.target.value })}
                disabled={busy}
                className="rounded-md border border-brand-border px-2 py-1 text-xs font-medium text-brand-muted"
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>{KIND_LABELS[k]}</option>
                ))}
              </select>
            </label>
            <span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ background: typeMeta.tint, color: typeMeta.ink }}>
              {typeMeta.label}
            </span>
            <CertTemplate moduleId={m.id} hasTemplate={!!m.cert_template_path} onDone={onDone} />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <DeleteEntityButton
            entity="training_module"
            id={m.id}
            name={m.title}
            softDeletable={false}
            label="Delete"
            className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
          />
          <button
            onClick={() => patch({ isPublished: false })}
            disabled={busy}
            className="rounded-lg border border-brand-border px-3 py-2 text-sm font-semibold text-brand-muted transition hover:bg-brand-canvas disabled:opacity-50"
          >
            Save draft
          </button>
          <button
            onClick={() => patch({ isPublished: true })}
            disabled={busy}
            className="rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-bright disabled:opacity-50"
          >
            {m.is_published ? 'Published' : 'Publish'}
          </button>
        </div>
      </div>
    </div>
  )
}

function CertTemplate({ moduleId, hasTemplate, onDone }: { moduleId: string; hasTemplate: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const upload = async (file: File) => {
    setBusy(true)
    try {
      const fd = new FormData()
      fd.set('moduleId', moduleId)
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
      const res = await fetch(`/api/admin/community/training/cert-template?moduleId=${moduleId}`, { method: 'DELETE' })
      if (res.ok) onDone()
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-brand-muted-soft" title="Optional certificate template PDF — overlaid with the member's details. If unset, a default Stellr certificate is generated.">
      Certificate
      {hasTemplate ? (
        <>
          <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">Template set</span>
          <button onClick={clear} disabled={busy} className="text-brand-muted-soft hover:text-red-500 disabled:opacity-50"><X className="h-3.5 w-3.5" /></button>
        </>
      ) : (
        <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-brand-border px-2 py-1 text-[11px] font-medium text-brand-muted hover:bg-brand-canvas">
          <Upload className="h-3 w-3" /> {busy ? 'Uploading…' : 'Upload PDF'}
          <input type="file" accept="application/pdf" className="hidden" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
      )}
    </span>
  )
}

/* ─── Curriculum + lesson editor (2-col) ─────────────────────────────────── */

function Curriculum({ course: m, onDone }: { course: AdminModule; onDone: () => void }) {
  const sections = [...m.training_sections].sort((a, b) => a.display_order - b.display_order)
  // Editor target: a lesson id (edit) or { sectionId } (create) or null.
  const [editing, setEditing] = useState<{ lesson?: AdminLesson; sectionId: string | null } | null>(null)
  const [addingSection, setAddingSection] = useState(false)
  const [sectionTitle, setSectionTitle] = useState('')
  const [orderIds, setOrderIds] = useState<string[]>(sections.map((s) => s.id))
  const [dragId, setDragId] = useState<string | null>(null)

  const idsKey = sections.map((s) => s.id).join(',')
  useEffect(() => setOrderIds(sections.map((s) => s.id)), [idsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const byId = new Map(sections.map((s) => [s.id, s]))
  const ordered = orderIds.map((id) => byId.get(id)).filter((s): s is AdminSection => !!s)
  const lessonsIn = (sid: string | null) =>
    m.training_items.filter((i) => i.section_id === sid).sort((a, b) => a.display_order - b.display_order)

  const createSection = async () => {
    if (!sectionTitle.trim()) return
    const res = await fetch('/api/admin/community/training/sections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moduleId: m.id, title: sectionTitle, displayOrder: sections.length }),
    })
    if (res.ok) { setSectionTitle(''); setAddingSection(false); onDone() }
  }

  const reorderOver = (overId: string) => {
    if (!dragId || dragId === overId) return
    setOrderIds((prev) => {
      const from = prev.indexOf(dragId); const to = prev.indexOf(overId)
      if (from === -1 || to === -1) return prev
      const next = [...prev]; next.splice(from, 1); next.splice(to, 0, dragId); return next
    })
  }
  const persistOrder = async () => {
    const ids = orderIds; setDragId(null)
    const moved = ids.some((id, idx) => (byId.get(id)?.display_order ?? idx) !== idx)
    if (!moved) return
    await Promise.all(
      ids.map((id, idx) => (byId.get(id)?.display_order ?? idx) === idx ? null
        : fetch('/api/admin/community/training/sections', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, displayOrder: idx }) }))
        .filter((p): p is Promise<Response> => p !== null)
    )
    onDone()
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-muted-soft">Curriculum</p>
        {ordered.length > 1 && <p className="text-[11px] text-brand-muted-soft">Drag sections to reorder</p>}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_1.15fr]">
        {/* Left — sections + lessons */}
        <div className="space-y-3">
          {ordered.map((s) => (
            <SectionCard
              key={s.id}
              moduleId={m.id}
              section={s}
              lessons={lessonsIn(s.id)}
              selectedLessonId={editing?.lesson?.id ?? null}
              reorderable={ordered.length > 1}
              dragging={dragId === s.id}
              onDragStart={() => setDragId(s.id)}
              onDragEnter={() => reorderOver(s.id)}
              onDrop={persistOrder}
              onDragEnd={() => setDragId(null)}
              onSelectLesson={(lesson) => setEditing({ lesson, sectionId: s.id })}
              onAddLesson={() => setEditing({ sectionId: s.id })}
              onDone={onDone}
            />
          ))}

          {addingSection ? (
            <div className="flex items-center gap-2">
              <input value={sectionTitle} onChange={(e) => setSectionTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createSection()} placeholder="Section name" autoFocus className="flex-1 rounded-md border border-brand-border px-3 py-2 text-sm" />
              <button onClick={createSection} disabled={!sectionTitle.trim()} className="rounded-md bg-brand-blue px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Add</button>
              <button onClick={() => setAddingSection(false)} className="px-2 py-2 text-sm text-brand-muted-soft">Cancel</button>
            </div>
          ) : (
            <button onClick={() => setAddingSection(true)} className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-brand-border bg-white px-3 py-2 text-sm font-semibold text-brand-muted hover:bg-brand-canvas">
              <Plus className="h-4 w-4" /> Add section
            </button>
          )}
        </div>

        {/* Right — lesson editor */}
        <LessonEditor
          key={editing?.lesson?.id ?? editing?.sectionId ?? 'none'}
          moduleId={m.id}
          target={editing}
          lessonCount={editing ? lessonsIn(editing.sectionId).length : 0}
          onSaved={() => { setEditing(null); onDone() }}
          onCancel={() => setEditing(null)}
        />
      </div>
    </div>
  )
}

function SectionCard({
  moduleId, section: s, lessons, selectedLessonId, reorderable, dragging,
  onDragStart, onDragEnter, onDrop, onDragEnd, onSelectLesson, onAddLesson, onDone,
}: {
  moduleId: string; section: AdminSection; lessons: AdminLesson[]; selectedLessonId: string | null
  reorderable: boolean; dragging: boolean
  onDragStart: () => void; onDragEnter: () => void; onDrop: () => void; onDragEnd: () => void
  onSelectLesson: (l: AdminLesson) => void; onAddLesson: () => void; onDone: () => void
}) {
  const [open, setOpen] = useState(true)
  const [editingTitle, setEditingTitle] = useState(false)
  const [title, setTitle] = useState(s.title)

  const rename = async () => {
    const next = title.trim()
    if (!next || next === s.title) { setEditingTitle(false); setTitle(s.title); return }
    const res = await fetch('/api/admin/community/training/sections', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: s.id, title: next }) })
    if (res.ok) { setEditingTitle(false); onDone() }
  }
  const remove = async () => {
    const res = await fetch(`/api/admin/community/training/sections?id=${s.id}`, { method: 'DELETE' })
    if (res.ok) onDone()
  }

  return (
    <div
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); onDrop() }}
      className={`rounded-xl border bg-white transition ${dragging ? 'border-brand-blue opacity-60' : 'border-brand-border'}`}
    >
      <div draggable={reorderable && !editingTitle} onDragStart={onDragStart} onDragEnd={onDragEnd} className="flex items-center gap-2 border-b border-brand-hairline px-3 py-2.5">
        {reorderable && <span className="cursor-grab text-brand-muted-soft"><GripVertical className="h-4 w-4" /></span>}
        <button onClick={() => setOpen((v) => !v)} className="text-brand-muted-soft">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {editingTitle ? (
          <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={rename} onKeyDown={(e) => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') { setTitle(s.title); setEditingTitle(false) } }} autoFocus className="min-w-0 flex-1 rounded-md border border-brand-border px-2 py-1 text-sm" />
        ) : (
          <button onClick={() => setEditingTitle(true)} className="min-w-0 flex-1 truncate text-left text-sm font-bold text-brand-blue-dark">{s.title}</button>
        )}
        <span className="shrink-0 text-xs text-brand-muted-soft">{lessons.length} {lessons.length === 1 ? 'lesson' : 'lessons'}</span>
        <button onClick={() => setEditingTitle(true)} className="text-brand-muted-soft hover:text-brand-muted" aria-label="Rename section"><Pencil className="h-3.5 w-3.5" /></button>
        <button onClick={remove} className="text-brand-muted-soft hover:text-red-500" aria-label="Delete section"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
      {open && (
        <div className="space-y-1 p-2">
          {lessons.map((l) => {
            const Icon = typeIcon(l.content_kind)
            const active = l.id === selectedLessonId
            return (
              <button key={l.id} onClick={() => onSelectLesson(l)} className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition ${active ? 'bg-brand-soft' : 'hover:bg-brand-canvas'}`} style={active ? { background: '#EAF0FE' } : undefined}>
                <Icon className="h-4 w-4 shrink-0 text-brand-muted-soft" />
                <span className={`min-w-0 flex-1 truncate ${active ? 'font-semibold text-brand-blue-dark' : 'text-brand-muted'}`}>{l.title}</span>
                {l.status === 'draft' && <span className="shrink-0 rounded-full bg-brand-hairline px-1.5 py-0.5 text-[10px] font-medium text-brand-muted-soft">Draft</span>}
              </button>
            )
          })}
          {lessons.length === 0 && <p className="px-3 py-1.5 text-xs text-brand-muted-soft">No lessons yet.</p>}
          <button onClick={onAddLesson} className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-semibold text-brand-muted-soft hover:bg-brand-hairline hover:text-brand-blue-dark">
            <Plus className="h-3.5 w-3.5" /> Add lesson
          </button>
        </div>
      )}
    </div>
  )
}

function LessonEditor({
  moduleId, target, lessonCount, onSaved, onCancel,
}: {
  moduleId: string
  target: { lesson?: AdminLesson; sectionId: string | null } | null
  lessonCount: number
  onSaved: () => void
  onCancel: () => void
}) {
  const existing = target?.lesson
  const [contentKind, setContentKind] = useState<ContentKey>(existing?.content_kind ?? 'live')
  const [title, setTitle] = useState(existing?.title ?? '')
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [minutes, setMinutes] = useState(existing?.estimated_minutes ? String(existing.estimated_minutes) : '')
  const [body, setBody] = useState(existing?.body ?? '')
  const [status, setStatus] = useState<'draft' | 'published'>(existing?.status ?? 'published')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!target) {
    return (
      <div className="flex min-h-[280px] items-center justify-center rounded-2xl border border-dashed border-brand-border bg-white p-6 text-center text-sm text-brand-muted-soft">
        Select a lesson to edit, or use “Add lesson” to create one.
      </div>
    )
  }

  const active = CONTENT_TYPES.find((c) => c.key === contentKind) ?? CONTENT_TYPES[0]
  const needsUrl = !existing && active.input === 'url'
  const needsFile = !existing && active.input === 'file'

  const save = async () => {
    if (!title.trim()) { setError('Add a lesson title.'); return }
    setBusy(true); setError(null)
    try {
      if (existing) {
        // Edit: title / notes / status (content type fixed after creation).
        const res = await fetch('/api/admin/community/training/items', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: existing.id, title: title.trim(), body, status, estimatedMinutes: minutes ? Number(minutes) : undefined }),
        })
        if (res.ok) onSaved(); else setError('Could not save lesson.')
      } else {
        if (needsUrl && !url.trim()) { setError('Add a URL for this lesson.'); setBusy(false); return }
        if (needsFile && !file) { setError('Choose a file to upload.'); setBusy(false); return }
        const fd = new FormData()
        fd.set('moduleId', moduleId)
        if (target.sectionId) fd.set('sectionId', target.sectionId)
        fd.set('title', title.trim())
        fd.set('contentKind', contentKind)
        fd.set('status', status)
        fd.set('displayOrder', String(lessonCount))
        if (minutes) fd.set('estimatedMinutes', minutes)
        if (body.trim()) fd.set('body', body)
        if (needsUrl) fd.set('externalUrl', url)
        if (needsFile && file) fd.set('file', file)
        const res = await fetch('/api/admin/community/training/items', { method: 'POST', body: fd })
        if (res.ok) onSaved(); else { const d = await res.json().catch(() => ({})); setError(d.error || 'Could not add lesson.') }
      }
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!existing) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/community/training/items?id=${existing.id}`, { method: 'DELETE' })
      if (res.ok) onSaved()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-brand-border bg-white p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-brand-blue-dark">{existing ? 'Edit lesson' : 'New lesson'}</h3>
        <button onClick={onCancel} className="text-brand-muted-soft hover:text-brand-muted" aria-label="Close editor"><X className="h-4 w-4" /></button>
      </div>

      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Lesson title" autoFocus className="w-full rounded-lg border border-brand-border px-3 py-2 text-sm" />

      {/* 4-up content-type picker */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-brand-muted-soft">Lesson content</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {CONTENT_TYPES.map((c) => {
            const selected = contentKind === c.key
            const disabled = !!existing && c.key !== contentKind
            return (
              <button
                key={c.key}
                type="button"
                disabled={disabled}
                onClick={() => { setContentKind(c.key); setError(null) }}
                title={disabled ? 'Delete and re-add the lesson to change its content type.' : undefined}
                className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition ${selected ? 'border-brand-blue bg-brand-soft' : 'border-brand-border hover:bg-brand-canvas'} ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
                style={selected ? { background: '#EAF0FE', borderColor: '#3C6DF6' } : undefined}
              >
                <c.Icon className={`h-5 w-5 ${selected ? 'text-brand-blue-bright' : 'text-brand-muted-soft'}`} />
                <span className={`text-xs font-semibold ${selected ? 'text-brand-blue-dark' : 'text-brand-muted'}`}>{c.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Morphing dropzone for the active type (creation only). */}
      {!existing && (
        <div className="rounded-xl border border-dashed border-brand-border bg-brand-canvas/50 p-4">
          <div className="flex items-center gap-2">
            <active.Icon className="h-4 w-4 text-brand-muted" />
            <p className="text-sm font-semibold text-brand-blue-dark">{active.title}</p>
          </div>
          <p className="mt-0.5 text-xs text-brand-muted-soft">{active.desc}</p>
          {active.input === 'url' && (
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="mt-2 w-full rounded-md border border-brand-border px-3 py-2 text-sm" />
          )}
          {active.input === 'file' && (
            <label className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-brand-border bg-white px-3 py-2 text-sm font-medium text-brand-muted hover:bg-brand-canvas">
              <Upload className="h-4 w-4" /> {file ? file.name : active.cta}
              <input type="file" accept={active.accept} className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
          )}
          {active.input === 'none' && <p className="mt-2 text-xs font-medium text-brand-muted-soft">{active.cta}</p>}
        </div>
      )}

      {/* Existing 'live' (Record) lesson: launch + record the JaaS session here. */}
      {existing && existing.content_kind === 'live' && (
        <RecordSession itemId={existing.id} recordingStatus={existing.recording_status} />
      )}

      {/* Existing non-live lesson: show current content as an attached resource. */}
      {existing && existing.content_kind !== 'live' && (
        <div className="rounded-xl border border-brand-border p-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-brand-muted-soft">Attached resource</p>
          <div className="flex items-center gap-2 text-sm text-brand-muted">
            <Link2 className="h-4 w-4 text-brand-muted-soft" />
            {active.label}
          </div>
          <p className="mt-1 text-[11px] text-brand-muted-soft">Delete and re-add the lesson to replace its content.</p>
        </div>
      )}

      <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Lesson notes (optional) — shown beneath the content" rows={3} className="w-full rounded-lg border border-brand-border px-3 py-2 text-sm" />

      <div className="flex flex-wrap items-center gap-3">
        <input value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="Est. minutes" className="w-28 rounded-md border border-brand-border px-3 py-2 text-sm" />
        <select value={status} onChange={(e) => setStatus(e.target.value as 'draft' | 'published')} className="rounded-md border border-brand-border px-2 py-2 text-sm">
          <option value="published">Published</option>
          <option value="draft">Draft</option>
        </select>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={busy || !title.trim()} className="rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-bright disabled:opacity-50">
          {busy ? 'Saving…' : existing ? 'Save lesson' : 'Add lesson'}
        </button>
        {existing && (
          <button onClick={remove} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
            <Trash2 className="h-4 w-4" /> Delete
          </button>
        )}
        <button onClick={onCancel} className="px-2 py-2 text-sm text-brand-muted-soft">Cancel</button>
      </div>
    </div>
  )
}

/* ─── Create course ──────────────────────────────────────────────────────── */

function CreateCourse({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState('')
  const [materialKind, setMaterialKind] = useState<(typeof KINDS)[number]>('general')
  const [courseType, setCourseType] = useState<'self_paced' | 'structured' | 'scheduled'>('self_paced')
  const [busy, setBusy] = useState(false)

  const create = async () => {
    if (!title.trim()) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/community/training/modules', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), materialKind, courseType }),
      })
      if (res.ok) { const { id } = await res.json(); onCreated(id) }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border border-brand-border bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold text-brand-blue-dark">New course</h3>
        <button onClick={onCancel} className="text-brand-muted-soft hover:text-brand-muted"><X className="h-4 w-4" /></button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Course title" autoFocus className="flex-1 rounded-md border border-brand-border px-3 py-2 text-sm" />
        <select value={materialKind} onChange={(e) => setMaterialKind(e.target.value as (typeof KINDS)[number])} className="rounded-md border border-brand-border px-2 py-2 text-sm">
          {KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
        </select>
        <select value={courseType} onChange={(e) => setCourseType(e.target.value as typeof courseType)} className="rounded-md border border-brand-border px-2 py-2 text-sm">
          <option value="self_paced">Self-paced</option>
          <option value="structured">Structured</option>
          <option value="scheduled">Scheduled</option>
        </select>
        <button onClick={create} disabled={busy || !title.trim()} className="rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? 'Creating…' : 'Create'}
        </button>
      </div>
    </div>
  )
}
