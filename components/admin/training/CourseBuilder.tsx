'use client'

import { useId, useState, useEffect, useRef } from 'react'
import { Field, Input, Select, Textarea } from '@stellr/web-ui'
import { postUpload, uploadDirectToStorage } from '@/lib/upload-client'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import {
  Plus, Trash2, GripVertical, Pencil, Check, X, ChevronDown, ChevronRight, ChevronUp,
  Radio, Video, FileText, Paperclip, Play, Upload, Sparkles,
} from 'lucide-react'
import { INTERACTIVE_OPTIONS } from '@/lib/interactive-lessons-meta'
import { DeleteEntityButton } from '@/components/admin/DeleteEntityButton'
import { ObjectAssignments, type AdminTier } from '@/components/admin/training/ObjectAssignments'
import { RecordSession } from '@/components/admin/training/RecordSession'
import { LessonResources, attachPendingResources, type PendingResource } from '@/components/admin/training/LessonResources'
import { UNSECTIONED, buildLayout, canStep, layoutMoves, moveLesson, sectionKey, stepLesson, type LessonLayout } from '@/lib/training-curriculum'
import type { RecordingPhase } from '@/lib/recording-view'
import type { TrainableObject } from '@/lib/training-admin'
import type { AdminModule, AdminSection, AdminLesson } from '@/components/admin/community/TrainingManager'

// Course builder — design-faithful single-course editor: course selector, meta
// card (inline title · Theme · Type · Certificate · Delete/Save draft/Publish),
// Assignments & requirements, then a 2-col Curriculum + Lesson editor with the
// 4-up content-type picker. Reuses the existing modules/sections/items APIs.

// The 4-up lesson content types (design) mapped onto our content_kind enum.
type ContentKey = AdminLesson['content_kind']
const CONTENT_TYPES: {
  key: ContentKey
  label: string
  Icon: typeof Radio
  input: 'none' | 'url' | 'file' | 'select'
  title: string
  desc: string
  cta: string
  accept?: string
}[] = [
  { key: 'live', label: 'Record', Icon: Radio, input: 'none', title: 'Live recording session', desc: 'Opens an in-browser Jitsi room. The recording saves to this lesson automatically when the session ends.', cta: 'No upload needed' },
  { key: 'link', label: 'Video link', Icon: Video, input: 'url', title: 'Paste a video URL', desc: 'YouTube, Vimeo or any embeddable video link.', cta: 'Add URL' },
  { key: 'google_doc', label: 'Google Doc', Icon: FileText, input: 'url', title: 'Paste a Google Doc URL', desc: 'A shared Google Doc shown inline in the lesson.', cta: 'Add URL' },
  { key: 'document', label: 'Resource', Icon: Paperclip, input: 'file', title: 'Upload a file', desc: 'A PDF or document attached to this lesson.', cta: 'Choose file', accept: '.pdf,.doc,.docx,.ppt,.pptx' },
  { key: 'interactive', label: 'Interactive', Icon: Sparkles, input: 'select', title: 'Choose an interactive tutorial', desc: 'A built-in interactive lesson (e.g. a guided tutorial with calculators), rendered natively in the player.', cta: 'Select tutorial' },
]
const typeIcon = (k: ContentKey) =>
  k === 'live' ? Radio : k === 'link' ? Video : k === 'google_doc' ? FileText : k === 'video' ? Play : k === 'interactive' ? Sparkles : Paperclip

/* ─── Root ───────────────────────────────────────────────────────────────── */

export function CourseBuilder({
  courses,
  objects,
  tiers,
  initialCourseId,
  recordingPhases = {},
}: {
  courses: AdminModule[]
  objects: TrainableObject[]
  tiers: AdminTier[]
  initialCourseId?: string
  /** Lessons whose recording is not simply saved or absent, by lesson id. */
  recordingPhases?: Record<string, RecordingPhase>
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const courseSelectId = useId()
  const [selectedId, setSelectedId] = useState<string>(
    initialCourseId && courses.some((c) => c.id === initialCourseId) ? initialCourseId : courses[0]?.id ?? ''
  )
  // Open the create form immediately when arrived at via the header "New course"
  // button (?new=1) — initialise from the param so the empty-list redirect below
  // doesn't bounce a fresh admin to Overview before they can create.
  const [creating, setCreating] = useState(searchParams.get('new') === '1')
  const course = courses.find((c) => c.id === selectedId)

  // The header "New course" button links to ?new=1. Honour it (also when already
  // on the builder tab) and strip the trigger so cancelling doesn't re-open it.
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setCreating(true)
      const params = new URLSearchParams(searchParams.toString())
      params.delete('new')
      router.replace(`${pathname}?${params.toString()}`)
    }
  }, [searchParams, pathname, router])

  // Keep the selection valid as the course list changes (e.g. after a delete or
  // a router.refresh). If the selected course no longer exists, fall back to the
  // first remaining course; if none remain, leave the builder and return to the
  // Overview tab. Skipped while creating so a fresh admin isn't bounced away.
  useEffect(() => {
    if (creating) return
    if (courses.length === 0) {
      const params = new URLSearchParams(searchParams.toString())
      params.set('tab', 'overview')
      params.delete('course')
      router.replace(`${pathname}?${params.toString()}`)
      return
    }
    if (!courses.some((c) => c.id === selectedId)) {
      setSelectedId(courses[0].id)
    }
  }, [courses, selectedId, creating, pathname, searchParams, router])

  return (
    <div className="space-y-5">
      {/* Course selector */}
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={courseSelectId} className="text-sm font-semibold text-brand-muted">Editing</label>
        <div className="w-72 max-w-full">
          <Select id={courseSelectId} value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className="font-medium">
            {courses.length === 0 && <option value="">No courses yet</option>}
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} {c.is_published ? '' : '(draft)'}
              </option>
            ))}
          </Select>
        </div>
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
          <Curriculum key={`curr-${course.id}`} course={course} recordingPhases={recordingPhases} onDone={() => router.refresh()} />
        </>
      )}
    </div>
  )
}

/* ─── Course meta card ───────────────────────────────────────────────────── */

function CourseMetaCard({ course: m, onDone }: { course: AdminModule; onDone: () => void }) {
  const [title, setTitle] = useState(m.title)
  const [busy, setBusy] = useState(false)
  const titleId = useId()

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
          {/* Edited in place at heading size (24px, so no iOS zoom); a real label names it. */}
          <label htmlFor={titleId} className="block text-xs font-semibold uppercase tracking-wide text-brand-muted-soft">
            Course title
          </label>
          <input
            id={titleId}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title !== m.title && patch({ title: title.trim() })}
            className="mt-1 w-full border-0 border-b border-transparent bg-transparent p-0 font-heading text-2xl font-bold text-brand-blue-dark focus:border-brand-border focus:outline-hidden"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <CertTemplate moduleId={m.id} hasTemplate={!!m.cert_template_path} onDone={onDone} />
          </div>
          <CredentialFields course={m} patch={patch} busy={busy} />
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

/* ─── Credential defaults ─────────────────────────────────────────────────
 * What the completion credential says on its public page and on LinkedIn.
 * Snapshotted onto each credential at issue, so edits only affect future
 * completions. Title falls back to the course title. */
function CredentialFields({ course: m, patch, busy }: { course: AdminModule; patch: (b: Record<string, unknown>) => Promise<void>; busy: boolean }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(m.credential_title ?? '')
  const [description, setDescription] = useState(m.credential_description ?? '')
  const [criteria, setCriteria] = useState(m.credential_criteria ?? '')
  const [skills, setSkills] = useState((m.credential_skills ?? []).join(', '))
  const save = () =>
    patch({
      credentialTitle: title,
      credentialDescription: description,
      credentialCriteria: criteria,
      credentialSkills: skills.split(',').map((s) => s.trim()).filter(Boolean),
    })
  return (
    <div className="mt-3">
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs font-medium text-brand-blue hover:underline" aria-expanded={open}>
        {open ? 'Hide credential details' : 'Credential details (page + LinkedIn)'}
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-1 gap-3 rounded-lg border border-brand-border bg-brand-canvas p-3 md:grid-cols-2">
          <Field label="Title on LinkedIn" labelSize="small" className="md:col-span-2">
            <Input value={title} placeholder={m.title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Description" labelSize="small">
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="How it was earned" labelSize="small">
            <Textarea rows={3} value={criteria} onChange={(e) => setCriteria(e.target.value)} />
          </Field>
          <Field label="Skills (comma-separated)" labelSize="small" className="md:col-span-2">
            <Input value={skills} onChange={(e) => setSkills(e.target.value)} />
          </Field>
          <div className="md:col-span-2">
            <button type="button" onClick={save} disabled={busy} className="rounded-lg border border-brand-border bg-white px-3 py-1.5 text-xs font-semibold text-brand-blue-dark hover:bg-brand-canvas disabled:opacity-50">
              {busy ? 'Saving…' : 'Save credential details'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function CertTemplate({ moduleId, hasTemplate, onDone }: { moduleId: string; hasTemplate: boolean; onDone: () => void }) {
  const previewHref = `/api/admin/training/cert-preview?moduleId=${moduleId}`
  const [busy, setBusy] = useState(false)
  // Shown, not dropped: a refused template must not look like nothing happened.
  const [error, setError] = useState<string | null>(null)
  const upload = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      // Bytes go browser → storage via a signed URL; only the path is posted.
      const stored = await uploadDirectToStorage(file, 'training-cert-template', { moduleId })
      if ('error' in stored) return setError(stored.error)
      const result = await postUpload(
        '/api/admin/community/training/cert-template',
        JSON.stringify({ moduleId, storagePath: stored.storagePath }),
        { headers: { 'Content-Type': 'application/json' } },
      )
      if ('error' in result) return setError(result.error)
      onDone()
    } finally {
      setBusy(false)
    }
  }
  const clear = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/community/training/cert-template?moduleId=${moduleId}`, { method: 'DELETE' })
      if (res.ok) return onDone()
      const data = await res.json().catch(() => ({}))
      setError(typeof data.error === 'string' ? data.error : 'Could not remove the template. Please try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <span className="flex items-center gap-1.5 text-xs font-medium text-brand-muted-soft" title="Optional certificate template PDF — overlaid with the member's details. If unset, a default Stellr certificate is generated.">
        Certificate
        {hasTemplate ? (
          <>
            <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">Template set</span>
            <button onClick={clear} disabled={busy} aria-label="Remove certificate template" className="text-brand-muted-soft hover:text-red-500 disabled:opacity-50"><X className="h-3.5 w-3.5" aria-hidden="true" /></button>
          </>
        ) : (
          <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-brand-border px-2 py-1 text-xs font-medium text-brand-muted hover:bg-brand-canvas focus-within:ring-2 focus-within:ring-primary-deep/30">
            <Upload className="h-3 w-3" aria-hidden="true" /> {busy ? 'Uploading…' : 'Upload PDF'}
            {/* sr-only, not display:none, so the picker is reachable by keyboard.
                Cleared once read, so the same file can be picked again after a refusal. */}
            <input
              type="file"
              accept="application/pdf"
              className="sr-only"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) upload(file)
              }}
            />
          </label>
        )}
        <a href={previewHref} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-brand-blue-bright hover:underline">
          Preview
        </a>
      </span>
      {error && <p role="alert" className="w-full text-xs text-danger">{error}</p>}
    </>
  )
}

/* ─── Curriculum + lesson editor (2-col) ─────────────────────────────────── */

// Lesson-row chips, for a recording that is on its way or has failed.
const RECORDING_CHIP: Partial<Record<RecordingPhase, { label: string; className: string }>> = {
  recording: { label: 'Recording', className: 'bg-red-50 text-danger' },
  processing: { label: 'Processing', className: 'bg-surface text-gold-ink' },
  saving: { label: 'Saving', className: 'bg-surface text-gold-ink' },
  failed: { label: 'Not saved', className: 'bg-red-50 text-danger' },
}

function Curriculum({ course: m, recordingPhases, onDone }: { course: AdminModule; recordingPhases: Record<string, RecordingPhase>; onDone: () => void }) {
  const sections = [...m.training_sections].sort((a, b) => a.display_order - b.display_order)
  // Editor target: a lesson id (edit) or { sectionId } (create) or null.
  const [editing, setEditing] = useState<{ lesson?: AdminLesson; sectionId: string | null } | null>(null)
  const [addingSection, setAddingSection] = useState(false)
  const [sectionTitle, setSectionTitle] = useState('')
  const [orderIds, setOrderIds] = useState<string[]>(sections.map((s) => s.id))
  const [dragId, setDragId] = useState<string | null>(null)
  const [moveStatus, setMoveStatus] = useState('')

  const idsKey = sections.map((s) => s.id).join(',')
  useEffect(() => setOrderIds(sections.map((s) => s.id)), [idsKey]) // eslint-disable-line react-hooks/exhaustive-deps -- `sections` is rebuilt every render; the joined id string is the stable identity

  // The order the server holds, as far as this tab knows: reset from the
  // props, then updated as each PATCH goes out, so a second move made before
  // the refresh lands diffs against what was just sent, not the stale props.
  const orderKey = sections.map((s) => `${s.id}:${s.display_order}`).join(',')
  const savedOrder = useRef(new Map<string, number>())
  useEffect(() => { savedOrder.current = new Map(sections.map((s) => [s.id, s.display_order])) }, [orderKey]) // eslint-disable-line react-hooks/exhaustive-deps -- keyed on the joined id:order string, as above

  const byId = new Map(sections.map((s) => [s.id, s]))
  const ordered = orderIds.map((id) => byId.get(id)).filter((s): s is AdminSection => !!s)

  // ── Lessons: where each sits while it is being dragged, and as last saved. ──
  // Reset from the props whenever they change, the same way as the section order.
  const lessonById = new Map(m.training_items.map((i) => [i.id, i]))
  const lessonKey = m.training_items.map((i) => `${i.id}:${i.section_id}:${i.display_order}`).sort().join(',')
  const makeLayout = () => buildLayout(m.training_items, sections.map((s) => s.id))
  const [layout, setLayout] = useState<LessonLayout>(makeLayout)
  // The order the server holds as far as this tab knows, updated as saves go out.
  const savedLessons = useRef(new Map<string, { sectionId: string | null; displayOrder: number }>())
  const [lessonDragId, setLessonDragId] = useState<string | null>(null)
  const [lessonDrop, setLessonDrop] = useState<{ key: string; index: number } | null>(null)
  // What the drop reads. A dragover's render can still be pending when drop fires,
  // and the state would then land the lesson where the pointer was a moment ago.
  const lessonDropRef = useRef<{ key: string; index: number } | null>(null)
  const [refocusLesson, setRefocusLesson] = useState<{ id: string; dir: -1 | 1 } | null>(null)
  const [lessonError, setLessonError] = useState<string | null>(null)
  const [resourceNotice, setResourceNotice] = useState<string | null>(null)

  useEffect(() => {
    const fresh = makeLayout()
    setLayout(fresh)
    const saved = new Map<string, { sectionId: string | null; displayOrder: number }>()
    for (const key of Object.keys(fresh)) {
      fresh[key].forEach((id, displayOrder) => saved.set(id, { sectionId: lessonById.get(id)?.section_id ?? null, displayOrder: lessonById.get(id)?.display_order ?? displayOrder }))
    }
    savedLessons.current = saved
  }, [lessonKey, idsKey]) // eslint-disable-line react-hooks/exhaustive-deps -- keyed on the joined strings; the arrays are rebuilt every render

  const lessonsIn = (sid: string | null): AdminLesson[] =>
    (layout[sectionKey(sid)] ?? []).map((id) => lessonById.get(id)).filter((l): l is AdminLesson => !!l)

  const unsectioned = lessonsIn(null)
  // The order sections appear on screen. The unsectioned group is listed last.
  const layoutKeys = [...ordered.map((s) => s.id), ...(unsectioned.length > 0 ? [UNSECTIONED] : [])]

  const saveLessons = async (next: LessonLayout) => {
    const moves = layoutMoves(next, savedLessons.current)
    if (moves.length === 0) return
    for (const move of moves) savedLessons.current.set(move.id, { sectionId: move.sectionId, displayOrder: move.displayOrder })
    setLessonError(null)
    const res = await fetch('/api/admin/community/training/items', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moduleId: m.id, reorder: moves }),
    }).catch(() => null)
    if (!res?.ok) setLessonError('Could not save the new lesson order. The list has been put back.')
    onDone()
    if (!res?.ok) setLayout(makeLayout())
  }

  // Rows stay where they are during a drag, with a line showing where the lesson
  // will land. Moving the row live across sections would remount it, and a browser
  // never delivers dragend to a drag source that has left the page.
  const dragLessonOver = (toKey: string, toIndex: number) => {
    if (!lessonDragId) return
    const prev = lessonDropRef.current
    if (prev?.key === toKey && prev.index === toIndex) return
    lessonDropRef.current = { key: toKey, index: toIndex }
    setLessonDrop(lessonDropRef.current)
  }
  // Anywhere on a section's card. Read from the rows on screen rather than the
  // element under the pointer, so the header and the gaps between rows land
  // somewhere sensible: before the first row whose middle is below the pointer.
  // A collapsed section shows no rows, so the lesson joins the end of it.
  const dragLessonOverCard = (toKey: string, card: HTMLElement, clientY: number) => {
    if (!lessonDragId) return
    const rows = [...card.querySelectorAll<HTMLElement>('[data-lesson-row]')]
    const others = rows.filter((r) => r.dataset.lessonRow !== lessonDragId)
    const end = (layout[toKey] ?? []).filter((id) => id !== lessonDragId).length
    dragLessonOver(toKey, rows.length === 0 ? end : others.filter((r) => { const box = r.getBoundingClientRect(); return box.top + box.height / 2 < clientY }).length)
  }
  const dropLesson = () => {
    const id = lessonDragId
    const at = lessonDropRef.current
    setLessonDragId(null)
    setLessonDrop(null)
    lessonDropRef.current = null
    if (!id || !at) return
    const next = moveLesson(layout, id, at.key, at.index)
    if (next === layout) return
    setLayout(next)
    void saveLessons(next)
  }
  // Released outside any section, or cancelled with Escape: nothing moved.
  const cancelLessonDrag = () => {
    setLessonDragId(null)
    setLessonDrop(null)
    lessonDropRef.current = null
  }

  // The non-drag way to move a lesson (WCAG 2.5.7).
  const stepLessonBy = (id: string, dir: -1 | 1) => {
    const next = stepLesson(layout, id, dir, layoutKeys)
    if (next === layout) return
    setLayout(next)
    setRefocusLesson({ id, dir })
    const toKey = Object.keys(next).find((k) => next[k].includes(id)) ?? ''
    const place = toKey === UNSECTIONED ? 'Not in a section' : byId.get(toKey)?.title ?? 'Section'
    setMoveStatus(`“${lessonById.get(id)?.title ?? 'Lesson'}” moved to position ${next[toKey].indexOf(id) + 1} of ${next[toKey].length} in ${place}.`)
    void saveLessons(next)
  }
  // Keep focus on the arrow pressed, or the other one once this one is disabled.
  useEffect(() => {
    if (!refocusLesson) return
    const { id, dir } = refocusLesson
    const target = canStep(layout, id, dir, layoutKeys) ? dir : (dir === -1 ? 1 : -1)
    document.querySelector<HTMLButtonElement>(`[data-lesson-step="${id}:${target}"]`)?.focus()
    setRefocusLesson(null)
  }, [refocusLesson]) // eslint-disable-line react-hooks/exhaustive-deps -- runs once per move, after the row has re-rendered

  const lessonProps = {
    recordingPhases,
    layout,
    layoutKeys,
    lessonDragId,
    lessonDrop,
    onStepLesson: stepLessonBy,
    onLessonDragStart: setLessonDragId,
    onLessonDragOverCard: dragLessonOverCard,
    onLessonDragEnd: cancelLessonDrag,
  }

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
  // Saves every section whose position changed. Shared by drag-and-drop and
  // the Move up / Move down buttons.
  const persist = async (ids: string[]) => {
    const saved = savedOrder.current
    const changed = ids.filter((id, idx) => (saved.get(id) ?? idx) !== idx)
    if (changed.length === 0) return
    for (const id of changed) saved.set(id, ids.indexOf(id))
    await Promise.all(
      changed.map((id) =>
        fetch('/api/admin/community/training/sections', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, displayOrder: ids.indexOf(id) }) }))
    )
    onDone()
  }
  const persistOrder = async () => {
    if (lessonDragId) { dropLesson(); return }
    const ids = orderIds; setDragId(null)
    await persist(ids)
  }
  // The non-drag way to reorder (WCAG 2.5.7): one step up or down per press.
  const move = (id: string, dir: -1 | 1) => {
    const from = orderIds.indexOf(id)
    const to = from + dir
    if (from === -1 || to < 0 || to >= orderIds.length) return
    const next = [...orderIds]; next.splice(from, 1); next.splice(to, 0, id)
    setOrderIds(next)
    setMoveStatus(`“${byId.get(id)?.title ?? 'Section'}” moved to position ${to + 1} of ${next.length}.`)
    void persist(next)
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-muted-soft">Curriculum</p>
        <p className="text-xs text-brand-muted-soft">{ordered.length > 1 ? 'Drag sections and lessons to reorder' : 'Drag lessons to reorder'}</p>
      </div>
      <p className="sr-only" aria-live="polite">{moveStatus}</p>
      {lessonError && <p role="alert" className="mb-3 text-xs text-danger">{lessonError}</p>}
      {resourceNotice && <p role="alert" className="mb-3 text-xs text-danger">{resourceNotice}</p>}

      <div className="grid gap-5 lg:grid-cols-[1fr_1.15fr]">
        {/* Left — sections + lessons. min-w-0 so a grid track cannot outgrow a phone. */}
        <div className="min-w-0 space-y-3">
          {ordered.map((s, idx) => (
            <SectionCard
              key={s.id}
              {...lessonProps}
              section={s}
              lessons={lessonsIn(s.id)}
              selectedLessonId={editing?.lesson?.id ?? null}
              reorderable={ordered.length > 1}
              isFirst={idx === 0}
              isLast={idx === ordered.length - 1}
              onMove={(dir) => move(s.id, dir)}
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

          {/* Lessons with no section used to be missing from this list entirely,
              and so could not be opened or moved. */}
          {unsectioned.length > 0 && (
            <div
              onDragOver={(e) => { e.preventDefault(); dragLessonOverCard(UNSECTIONED, e.currentTarget, e.clientY) }}
              onDrop={(e) => { e.preventDefault(); if (lessonDragId) dropLesson() }}
              className={`rounded-xl border border-dashed bg-white ${lessonDrop?.key === UNSECTIONED ? 'border-primary' : 'border-brand-border'}`}
            >
              <div className="border-b border-brand-hairline px-3 py-2.5">
                <p className="text-sm font-bold text-brand-blue-dark">Not in a section</p>
                <p className="text-xs text-brand-muted-soft">Drag these into a section to place them in the course.</p>
              </div>
              <LessonList
                {...lessonProps}
                listKey={UNSECTIONED}
                lessons={unsectioned}
                selectedLessonId={editing?.lesson?.id ?? null}
                onSelectLesson={(lesson) => setEditing({ lesson, sectionId: null })}
              />
            </div>
          )}

          {addingSection ? (
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <Input value={sectionTitle} onChange={(e) => setSectionTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createSection()} placeholder="Section name" aria-label="Section name" autoFocus />
              </div>
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
          onSaved={(notice) => { setResourceNotice(notice ?? null); setEditing(null); onDone() }}
          onCancel={() => setEditing(null)}
          onChanged={onDone}
        />
      </div>
    </div>
  )
}

const MOVE_BUTTON =
  'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-control text-content-muted hover:bg-surface hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent'

// What every list of lessons needs in order to be dragged around.
interface LessonDragProps {
  recordingPhases: Record<string, RecordingPhase>
  layout: LessonLayout
  layoutKeys: string[]
  lessonDragId: string | null
  lessonDrop: { key: string; index: number } | null
  onStepLesson: (id: string, dir: -1 | 1) => void
  onLessonDragStart: (id: string) => void
  onLessonDragOverCard: (toKey: string, card: HTMLElement, clientY: number) => void
  onLessonDragEnd: () => void
}

function LessonList({
  listKey, lessons, selectedLessonId, onSelectLesson, recordingPhases, layout, layoutKeys, lessonDragId, lessonDrop,
  onStepLesson, onLessonDragStart, onLessonDragEnd,
}: Omit<LessonDragProps, 'onLessonDragOverCard'> & {
  listKey: string; lessons: AdminLesson[]; selectedLessonId: string | null; onSelectLesson: (l: AdminLesson) => void
}) {
  // Indexes are read with the dragged lesson lifted out of the list, as moveLesson does.
  const others = lessons.filter((x) => x.id !== lessonDragId)
  const lineAt = lessonDrop?.key === listKey ? lessonDrop.index : null
  // Absolute, so showing it moves nothing. A line that took up space pushed the
  // rows down, left the pointer in the gap above them, and sent the drop to the
  // end of the section.
  const dropLine = (edge: string) => <div className={`pointer-events-none absolute inset-x-1 ${edge} h-0.5 rounded-full bg-primary`} aria-hidden="true" />
  return (
    <div className="space-y-1 p-2">
      {lessons.map((l) => {
        const Icon = typeIcon(l.content_kind)
        const active = l.id === selectedLessonId
        const chip = RECORDING_CHIP[recordingPhases[l.id]]
        const position = others.findIndex((x) => x.id === l.id)
        return (
          <div
            key={l.id}
            data-lesson-row={l.id}
            draggable
            onDragStart={(e) => {
              // Firefox will not start a drag without data. Stop here so the
              // section this row sits in does not treat it as its own drag.
              e.dataTransfer.setData('text/plain', l.id)
              e.dataTransfer.effectAllowed = 'move'
              e.stopPropagation()
              onLessonDragStart(l.id)
            }}
            onDragEnd={(e) => { e.stopPropagation(); onLessonDragEnd() }}
            className={`group relative flex items-center gap-1 rounded-lg transition ${active ? 'bg-brand-soft' : 'hover:bg-brand-canvas'} ${lessonDragId === l.id ? 'opacity-50' : ''}`}
            style={active ? { background: '#EAF0FE' } : undefined}
          >
            {lineAt !== null && position === lineAt && dropLine('-top-[3px]')}
            {lineAt !== null && lineAt >= others.length && position === others.length - 1 && dropLine('-bottom-[3px]')}
            <span className="shrink-0 cursor-grab pl-1 text-brand-muted-soft" aria-hidden="true"><GripVertical className="h-4 w-4" /></span>
            <button onClick={() => onSelectLesson(l)} className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-1 pr-2 text-left text-sm">
              <Icon className="h-4 w-4 shrink-0 text-brand-muted-soft" aria-hidden="true" />
              <span className={`min-w-0 flex-1 truncate ${active ? 'font-semibold text-brand-blue-dark' : 'text-brand-muted'}`}>{l.title}</span>
              {chip && <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium ${chip.className}`}>{chip.label}</span>}
              {l.status === 'draft' && <span className="shrink-0 rounded-full bg-brand-hairline px-1.5 py-0.5 text-xs font-medium text-brand-muted-soft">Draft</span>}
            </button>
            {/* Always there on touch; on a mouse they appear with the row or on focus. */}
            {([-1, 1] as const).map((dir) => (
              <button
                key={dir}
                type="button"
                data-lesson-step={`${l.id}:${dir}`}
                onClick={() => onStepLesson(l.id, dir)}
                disabled={!canStep(layout, l.id, dir, layoutKeys)}
                aria-label={`Move ${l.title} ${dir === -1 ? 'up' : 'down'}`}
                className={`${MOVE_BUTTON} mouse:opacity-0 mouse:group-hover:opacity-100 mouse:focus-visible:opacity-100`}
              >
                {dir === -1 ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
              </button>
            ))}
          </div>
        )
      })}
      {lessons.length === 0 && (
        <p className="px-3 py-1.5 text-xs text-brand-muted-soft">{lessonDragId ? 'Drop here to move the lesson into this section.' : 'No lessons yet.'}</p>
      )}
    </div>
  )
}

function SectionCard({
  section: s, lessons, selectedLessonId, reorderable, isFirst, isLast, onMove, dragging,
  onDragStart, onDragEnter, onDrop, onDragEnd, onSelectLesson, onAddLesson, onDone,
  recordingPhases, layout, layoutKeys, lessonDragId, lessonDrop, onStepLesson, onLessonDragStart, onLessonDragOverCard, onLessonDragEnd,
}: LessonDragProps & {
  section: AdminSection; lessons: AdminLesson[]; selectedLessonId: string | null
  reorderable: boolean; isFirst: boolean; isLast: boolean; onMove: (dir: -1 | 1) => void; dragging: boolean
  onDragStart: () => void; onDragEnter: () => void; onDrop: () => void; onDragEnd: () => void
  onSelectLesson: (l: AdminLesson) => void; onAddLesson: () => void; onDone: () => void
}) {
  const [open, setOpen] = useState(true)
  const [editingTitle, setEditingTitle] = useState(false)
  const [title, setTitle] = useState(s.title)
  // Keep focus on the arrow that was pressed as the card moves (or on the
  // other one once it reaches an end and the pressed one is disabled).
  const upRef = useRef<HTMLButtonElement>(null)
  const downRef = useRef<HTMLButtonElement>(null)
  const [refocus, setRefocus] = useState<-1 | 1 | null>(null)
  useEffect(() => {
    if (refocus === null) return
    const target = refocus === -1 ? (isFirst ? downRef : upRef) : (isLast ? upRef : downRef)
    target.current?.focus()
    setRefocus(null)
  }, [refocus, isFirst, isLast])
  const moveBy = (dir: -1 | 1) => { onMove(dir); setRefocus(dir) }

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
      onDragOver={(e) => { e.preventDefault(); onLessonDragOverCard(s.id, e.currentTarget, e.clientY) }}
      onDrop={(e) => { e.preventDefault(); onDrop() }}
      className={`rounded-xl border bg-white transition ${dragging ? 'border-brand-blue opacity-60' : lessonDrop?.key === s.id ? 'border-primary' : 'border-brand-border'}`}
    >
      <div draggable={reorderable && !editingTitle} onDragStart={onDragStart} onDragEnd={onDragEnd} className="flex items-center gap-2 border-b border-brand-hairline px-3 py-2.5">
        {reorderable && <span className="cursor-grab text-brand-muted-soft"><GripVertical className="h-4 w-4" /></span>}
        <button onClick={() => setOpen((v) => !v)} className="text-brand-muted-soft">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {editingTitle ? (
          <div className="min-w-0 flex-1">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={rename} onKeyDown={(e) => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') { setTitle(s.title); setEditingTitle(false) } }} aria-label={`Rename section ${s.title}`} autoFocus />
          </div>
        ) : (
          <button onClick={() => setEditingTitle(true)} className="min-w-0 flex-1 truncate text-left text-sm font-bold text-brand-blue-dark">{s.title}</button>
        )}
        <span className="shrink-0 text-xs text-brand-muted-soft">{lessons.length} {lessons.length === 1 ? 'lesson' : 'lessons'}</span>
        {reorderable && (
          <>
            <button ref={upRef} type="button" onClick={() => moveBy(-1)} disabled={isFirst} aria-label={`Move ${s.title} up`} className={MOVE_BUTTON}>
              <ChevronUp className="h-4 w-4" aria-hidden="true" />
            </button>
            <button ref={downRef} type="button" onClick={() => moveBy(1)} disabled={isLast} aria-label={`Move ${s.title} down`} className={MOVE_BUTTON}>
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </button>
          </>
        )}
        <button onClick={() => setEditingTitle(true)} className="text-brand-muted-soft hover:text-brand-muted" aria-label="Rename section"><Pencil className="h-3.5 w-3.5" /></button>
        <button onClick={remove} className="text-brand-muted-soft hover:text-red-500" aria-label="Delete section"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
      {open && (
        <>
          <LessonList
            listKey={s.id}
            lessons={lessons}
            selectedLessonId={selectedLessonId}
            onSelectLesson={onSelectLesson}
            recordingPhases={recordingPhases}
            layout={layout}
            layoutKeys={layoutKeys}
            lessonDragId={lessonDragId}
            lessonDrop={lessonDrop}
            onStepLesson={onStepLesson}
            onLessonDragStart={onLessonDragStart}
            onLessonDragEnd={onLessonDragEnd}
          />
          <button onClick={onAddLesson} className="mb-2 ml-2 inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-semibold text-brand-muted-soft hover:bg-brand-hairline hover:text-brand-blue-dark">
            <Plus className="h-3.5 w-3.5" /> Add lesson
          </button>
        </>
      )}
    </div>
  )
}

function LessonEditor({
  moduleId, target, lessonCount, onSaved, onCancel, onChanged,
}: {
  moduleId: string
  target: { lesson?: AdminLesson; sectionId: string | null } | null
  lessonCount: number
  /** A notice is a problem the admin still needs to see once the editor has closed. */
  onSaved: (notice?: string) => void
  onCancel: () => void
  onChanged: () => void
}) {
  const existing = target?.lesson
  const [contentKind, setContentKind] = useState<ContentKey>(existing?.content_kind ?? 'live')
  const [title, setTitle] = useState(existing?.title ?? '')
  const [url, setUrl] = useState(existing?.external_url ?? '')
  const [interactiveKey, setInteractiveKey] = useState(existing?.interactive_key ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [minutes, setMinutes] = useState(existing?.estimated_minutes ? String(existing.estimated_minutes) : '')
  const [body, setBody] = useState(existing?.body ?? '')
  const [status, setStatus] = useState<'draft' | 'published'>(existing?.status ?? 'published')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingResources, setPendingResources] = useState<PendingResource[]>([])

  if (!target) {
    return (
      <div className="flex min-h-[280px] items-center justify-center rounded-2xl border border-dashed border-brand-border bg-white p-6 text-center text-sm text-brand-muted-soft">
        Select a lesson to edit, or use “Add lesson” to create one.
      </div>
    )
  }

  const active = CONTENT_TYPES.find((c) => c.key === contentKind) ?? CONTENT_TYPES[0]
  // Whether the content (type/url/file) is being set — always for a new lesson;
  // for an existing one, only when the admin changes the type, the URL, or picks
  // a new file. An unchanged existing lesson is a metadata-only edit.
  const contentChanged =
    !existing ||
    contentKind !== existing.content_kind ||
    (active.input === 'url' && url.trim() !== (existing.external_url ?? '')) ||
    (active.input === 'select' && interactiveKey !== (existing.interactive_key ?? '')) ||
    (active.input === 'file' && !!file)
  const showDropzone = active.input !== 'none' && (contentChanged || !existing)

  const save = async () => {
    if (!title.trim()) { setError('Add a lesson title.'); return }
    if (contentChanged && active.input === 'url' && !url.trim()) { setError('Add a URL for this lesson.'); return }
    if (contentChanged && active.input === 'file' && !file) { setError('Choose a file to upload.'); return }
    if (contentChanged && active.input === 'select' && !interactiveKey) { setError('Choose a tutorial for this lesson.'); return }
    setBusy(true); setError(null)
    try {
      if (existing && !contentChanged) {
        // Metadata-only edit.
        const res = await fetch('/api/admin/community/training/items', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: existing.id, title: title.trim(), body, status, estimatedMinutes: minutes ? Number(minutes) : undefined }),
        })
        if (res.ok) onSaved(); else setError('Could not save lesson.')
        return
      }

      if (existing) {
        // Edit incl. content change. Multipart when a file is involved.
        let res: Response
        if (active.input === 'file' && file) {
          // Lesson media (document or VIDEO) goes browser → storage via a signed
          // URL; only its path is posted. A request body over 4.5MB never
          // reaches the function, so this is what makes video uploads work.
          const stored = await uploadDirectToStorage(file, 'training-item')
          if ('error' in stored) {
            setError(stored.error)
            return
          }
          res = await fetch('/api/admin/community/training/items', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: existing.id, title: title.trim(), body, status, contentKind,
              estimatedMinutes: minutes ? Number(minutes) : undefined,
              storagePath: stored.storagePath, fileType: stored.fileType,
            }),
          })
        } else {
          res = await fetch('/api/admin/community/training/items', {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: existing.id, title: title.trim(), body, status,
              estimatedMinutes: minutes ? Number(minutes) : undefined,
              contentKind, externalUrl: active.input === 'url' ? url.trim() : undefined,
              interactiveKey: active.input === 'select' ? interactiveKey : undefined,
            }),
          })
        }
        if (res.ok) onSaved(); else { const d = await res.json().catch(() => ({})); setError(d.error || 'Could not save lesson.') }
        return
      }

      // New lesson. Media goes browser → storage first; only its path is posted.
      let stored: { storagePath: string; fileType: string } | null = null
      if (active.input === 'file' && file) {
        const up = await uploadDirectToStorage(file, 'training-item')
        if ('error' in up) {
          setError(up.error)
          return
        }
        stored = up
      }
      const res = await fetch('/api/admin/community/training/items', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          moduleId,
          sectionId: target.sectionId || undefined,
          title: title.trim(),
          contentKind,
          status,
          displayOrder: String(lessonCount),
          estimatedMinutes: minutes || undefined,
          body: body.trim() || undefined,
          externalUrl: active.input === 'url' ? url : undefined,
          interactiveKey: active.input === 'select' ? interactiveKey : undefined,
          storagePath: stored?.storagePath,
          fileType: stored?.fileType,
        }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || 'Could not add lesson.'); return }
      // The lesson exists from here, so a resource that fails must not leave this
      // form open, where a second press would create the lesson twice.
      const { id } = await res.json()
      const failed = await attachPendingResources(id, pendingResources)
      onSaved(failed.length > 0
        ? `“${title.trim()}” was added, but ${failed.length === 1 ? 'this resource' : 'these resources'} could not be attached: ${failed.join(', ')}. Open the lesson to add ${failed.length === 1 ? 'it' : 'them'} again.`
        : undefined)
    } finally {
      setBusy(false)
    }
  }

  const pickType = (k: ContentKey) => { setContentKind(k); setError(null) }

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

      <Field label="Lesson title" labelSize="small">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Lesson title" autoFocus />
      </Field>

      {/* Content-type picker */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-muted-soft">Lesson content</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {CONTENT_TYPES.map((c) => {
            const selected = contentKind === c.key
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => pickType(c.key)}
                className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition ${selected ? 'border-brand-blue bg-brand-soft' : 'border-brand-border hover:bg-brand-canvas'}`}
                style={selected ? { background: '#EAF0FE', borderColor: '#3C6DF6' } : undefined}
              >
                <c.Icon className={`h-5 w-5 ${selected ? 'text-brand-blue-bright' : 'text-brand-muted-soft'}`} />
                <span className={`text-xs font-semibold ${selected ? 'text-brand-blue-dark' : 'text-brand-muted'}`}>{c.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Morphing dropzone for the active type. Shown for new lessons and when an
          existing lesson's content type/URL/file is being changed. */}
      {showDropzone && (
        <div className="rounded-xl border border-dashed border-brand-border bg-brand-canvas/50 p-4">
          <div className="flex items-center gap-2">
            <active.Icon className="h-4 w-4 text-brand-muted" />
            <p className="text-sm font-semibold text-brand-blue-dark">{active.title}</p>
          </div>
          <p className="mt-0.5 text-xs text-brand-muted-soft">{active.desc}</p>
          {active.input === 'url' && (
            <div className="mt-2">
              <Input type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" aria-label={`${active.title} URL`} />
            </div>
          )}
          {active.input === 'file' && (
            <label className="mt-2 inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md border border-brand-border bg-white px-3 py-2 text-sm font-medium text-brand-muted hover:bg-brand-canvas focus-within:ring-2 focus-within:ring-primary-deep/30">
              <Upload className="h-4 w-4" aria-hidden="true" /> {file ? file.name : active.cta}
              {/* sr-only, not display:none, so the picker is reachable by keyboard. */}
              <input type="file" accept={active.accept} className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
          )}
          {active.input === 'select' && (
            <div className="mt-2">
              <Select value={interactiveKey} onChange={(e) => setInteractiveKey(e.target.value)} aria-label={active.title}>
                <option value="">{active.cta}…</option>
                {INTERACTIVE_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </Select>
            </div>
          )}
        </div>
      )}

      {/* 'live' (Record) — note for new lessons; full launch/record once saved. */}
      {contentKind === 'live' && (
        existing && existing.content_kind === 'live' ? (
          <RecordSession itemId={existing.id} onChanged={onChanged} />
        ) : (
          <p className="rounded-xl border border-dashed border-brand-border bg-brand-canvas/50 p-4 text-xs text-brand-muted-soft">
            {active.desc} Save the lesson, then reopen it to launch the recording session.
          </p>
        )
      )}

      {/* Attached resources (files / links beneath the primary content). */}
      {existing
        ? <LessonResources itemId={existing.id} />
        : <LessonResources pending={pendingResources} onPendingChange={setPendingResources} />}

      <Field label="Lesson notes" labelSize="small" hint="Optional — shown beneath the content.">
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Lesson notes (optional) — shown beneath the content" rows={3} />
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Est. minutes" labelSize="small">
          <Input value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="Est. minutes" inputMode="numeric" />
        </Field>
        <Field label="Status" labelSize="small">
          <Select value={status} onChange={(e) => setStatus(e.target.value as 'draft' | 'published')}>
            <option value="published">Published</option>
            <option value="draft">Draft</option>
          </Select>
        </Field>
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
  const [busy, setBusy] = useState(false)

  const create = async () => {
    if (!title.trim()) return
    setBusy(true)
    try {
      // Material kind / course type default server-side (general · self-paced);
      // both are edited later in the course, so creation only needs a title.
      const res = await fetch('/api/admin/community/training/modules', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim() }),
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
        <button onClick={onCancel} aria-label="Close" className="text-brand-muted-soft hover:text-brand-muted"><X className="h-4 w-4" aria-hidden="true" /></button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} placeholder="Course title" aria-label="Course title" autoFocus />
        </div>
        <button onClick={create} disabled={busy || !title.trim()} className="rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? 'Creating…' : 'Create'}
        </button>
      </div>
    </div>
  )
}
