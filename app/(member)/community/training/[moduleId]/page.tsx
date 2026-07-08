import { redirect, notFound } from 'next/navigation'
import { formatDateShort } from '@/lib/utils'
import Link from 'next/link'
import { ArrowLeft, Lock, Clock, FileText, ExternalLink } from 'lucide-react'
import { getCurrentMember } from '@/lib/community'
import { getModule, getLesson, listLessonResources, deriveType, TYPE_META } from '@/lib/training'
import { getAssignedCourses, roleLabel, OBJECT_TYPE_LABELS } from '@/lib/training-portal'
import { ThemePill, RequiredPill, OptionalPill } from '@/components/training/Pills'
import { deadlineInfo } from '@/components/training/deadline'
import { LessonMedia } from '@/components/training/LessonMedia'
import { LessonActions } from '@/components/training/LessonActions'
import { CourseOutline } from '@/components/training/CourseOutline'

export const metadata = { title: 'Academy · Course' }

export default async function CourseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ moduleId: string }>
  searchParams: Promise<{ lesson?: string }>
}) {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const { moduleId } = await params
  const { lesson: lessonParam } = await searchParams
  const mod = await getModule(member, moduleId)
  if (!mod) notFound()

  // Tier gate — keep the upgrade prompt for inaccessible courses.
  if (!mod.canAccess) {
    return (
      <div className="mx-auto max-w-2xl py-12 text-center">
        <h1 className="font-heading text-2xl font-bold text-brand-blue-dark">{mod.title}</h1>
        <p className="mt-2 text-sm text-brand-muted-soft">This training is available with a higher membership tier.</p>
        <Link
          href="/membership"
          className="mt-4 inline-block rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white hover:bg-brand-blue-bright"
        >
          View Access Options
        </Link>
      </div>
    )
  }

  // Curriculum order (sections then ungrouped); default to first incomplete lesson.
  const ordered = [...mod.sections.flatMap((s) => s.items), ...mod.ungrouped]
  if (ordered.length === 0) {
    return (
      <div className="mx-auto max-w-2xl py-12 text-center text-sm text-brand-muted-soft">
        No lessons in this course yet.
      </div>
    )
  }
  const firstIncomplete = ordered.find((i) => !i.completed) ?? ordered[0]
  const currentId = lessonParam && ordered.some((i) => i.id === lessonParam) ? lessonParam : firstIncomplete.id
  const lesson = await getLesson(member, moduleId, currentId)
  if (!lesson) notFound()

  // "Section N · Lesson M" eyebrow for the current lesson.
  let eyebrow = ''
  outer: for (let si = 0; si < mod.sections.length; si++) {
    const items = mod.sections[si].items
    for (let li = 0; li < items.length; li++) {
      if (items[li].id === currentId) {
        eyebrow = `Section ${si + 1} · Lesson ${li + 1}`
        break outer
      }
    }
  }
  if (!eyebrow) {
    const ui = mod.ungrouped.findIndex((i) => i.id === currentId)
    if (ui >= 0) eyebrow = `Lesson ${ui + 1}`
  }

  // Assignment context: required?, which Object(s), role, deadline.
  const assigned = await getAssignedCourses(member)
  const ctx = assigned.filter((c) => c.moduleId === moduleId)
  const required = ctx.some((c) => c.requirement === 'mandatory')
  const kindLabels = [
    ...new Set(
      ctx.map((c) =>
        c.objectType === 'campaign' ? 'Campaign' : c.objectType === 'competition' ? 'Event' : OBJECT_TYPE_LABELS[c.objectType]
      )
    ),
  ]
  const objectLabel = [...new Set(ctx.map((c) => c.objectLabel))].join(' · ')
  const role = ctx[0]?.role ?? null
  const dueDates = ctx.filter((c) => c.requirement === 'mandatory' && c.dueAt).map((c) => c.dueAt as string)
  const dueAt = dueDates.sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] ?? null
  const dl = deadlineInfo(dueAt)

  const resources = await listLessonResources(currentId)
  const typeMeta = TYPE_META[deriveType(mod.material_kind)]
  const pct = mod.itemCount > 0 ? Math.round((mod.completedCount / mod.itemCount) * 100) : 0
  const displayName = [member.first_name, member.last_name].filter(Boolean).join(' ') || 'Member'

  return (
    <div className="space-y-6">
      <Link
        href="/community/training"
        className="inline-flex items-center gap-1.5 text-sm text-brand-muted-soft transition hover:text-brand-blue-dark"
      >
        <ArrowLeft className="h-4 w-4" /> Back to my training
      </Link>

      {/* Header */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          {kindLabels.length > 0 ? (
            kindLabels.map((label) => <ThemePill key={label} theme={mod.theme} label={label} />)
          ) : (
            <ThemePill theme={mod.theme} label={typeMeta.short} />
          )}
          {ctx.length > 0 && (required ? <RequiredPill /> : <OptionalPill />)}
          {objectLabel && (
            <span className="text-xs text-brand-muted-soft">
              {objectLabel}
              {role && ` · ${roleLabel(role)}`}
            </span>
          )}
        </div>
        <h1 className="mt-2 font-heading text-[28px] font-bold leading-tight text-brand-blue-dark">{mod.title}</h1>

        {dl && (
          <span
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold"
            style={{ color: dl.color, background: dl.urgent ? '#FCEBE8' : '#F0F2F8' }}
          >
            <Clock className="h-4 w-4" /> {dl.text}
            {dueAt && ` · ${formatDateShort(dueAt)}`}
          </span>
        )}

        {/* Course-level progress */}
        <div className="mt-4 flex items-center gap-3">
          <div className="h-2 max-w-md flex-1 overflow-hidden rounded-full bg-brand-hairline">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${pct}%`, background: pct === 100 ? '#1FA97A' : '#3C6DF6' }}
            />
          </div>
          <span className="text-sm text-brand-muted-soft">
            {mod.completedCount} of {mod.itemCount} lessons complete
          </span>
        </div>
      </div>

      {/* Player + outline */}
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          {lesson.locked ? (
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-brand-border bg-brand-canvas text-center">
              <Lock className="h-8 w-8 text-brand-muted-soft" />
              <p className="text-sm font-medium text-brand-muted">This lesson isn&apos;t available yet</p>
              {lesson.availableAt && (
                <p className="text-sm text-brand-muted-soft">Unlocks {formatDateShort(lesson.availableAt)}</p>
              )}
            </div>
          ) : (
            <LessonMedia media={lesson.media} title={lesson.title} displayName={displayName} itemId={lesson.id} />
          )}

          {eyebrow && (
            <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-muted-soft">{eyebrow}</p>
          )}
          <h2 className="text-xl font-bold text-brand-blue-dark">{lesson.title}</h2>
          {lesson.body && (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-brand-muted">{lesson.body}</p>
          )}

          {/* Attached resources — files/links the admin added to this lesson.
              Files open via the training-open redirect, which mints a fresh signed
              URL at click time (avoids the stale/expired URL that showed a blank tab)
              and routes Office documents through the in-browser viewer. */}
          {!lesson.locked && resources.length > 0 && (
            <div className="rounded-2xl border border-brand-border bg-white p-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-brand-muted-soft">Resources</p>
              <ul className="space-y-1.5">
                {resources.map((r) => (
                  <li key={r.id}>
                    <a
                      href={r.kind === 'link' ? (r.url ?? '#') : `/api/community/resources/training-open?ref=tr:${r.id}&redirect=1`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-lg border border-brand-hairline px-3 py-2 text-sm font-medium text-brand-muted transition hover:bg-brand-canvas"
                    >
                      {r.kind === 'file' ? <FileText className="h-4 w-4" /> : <ExternalLink className="h-4 w-4" />}
                      {r.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!lesson.locked && (
            <LessonActions moduleId={moduleId} itemId={currentId} nextId={lesson.nextId} completed={lesson.completed} />
          )}
        </div>

        <CourseOutline moduleId={moduleId} sections={mod.sections} ungrouped={mod.ungrouped} currentId={currentId} />
      </div>
    </div>
  )
}
