import { redirect } from 'next/navigation'
import { formatDateShort } from '@/lib/utils'
import Link from 'next/link'
import { GraduationCap, Lock, AlertCircle, BookOpen, Layers, Library } from 'lucide-react'
import { getCurrentMember } from '@/lib/community'
import {
  listModules,
  getAssignedModules,
  COURSE_TYPE_LABELS,
  type TrainingModuleSummary,
} from '@/lib/training'
import { getMemberEvents } from '@/lib/event-portal'
import { ProgressRing } from '@/components/ui/ProgressRing'
import { EmptyState } from '@/components/ui/EmptyState'

export const metadata = { title: 'Community · Training' }

// Section-colored cover gradients (T3.2): Curriculum = blue, CTE = orange,
// Library/general = navy. Keyed by material_kind.
const COVER: Record<string, { gradient: string; Icon: typeof GraduationCap }> = {
  curriculum: { gradient: 'linear-gradient(120deg,#3C6DF6,#2C53C6)', Icon: GraduationCap },
  cte:        { gradient: 'linear-gradient(120deg,#E0922F,#C2722A)', Icon: BookOpen },
  general:    { gradient: 'linear-gradient(120deg,#13183A,#3C6DF6)', Icon: Library },
}

function ModuleCard({ m }: { m: TrainingModuleSummary }) {
  const cover = COVER[m.material_kind] ?? COVER.general
  const CoverIcon = cover.Icon
  const pct = m.itemCount > 0 ? Math.round((m.completedCount / m.itemCount) * 100) : 0
  const done = m.itemCount > 0 && m.completedCount === m.itemCount
  const started = m.completedCount > 0

  const body = (
    <div
      className={`group flex h-full flex-col overflow-hidden rounded-2xl border bg-white transition ${
        m.canAccess
          ? 'border-brand-border hover:-translate-y-0.5 hover:border-brand-border hover:shadow-md'
          : 'border-brand-border opacity-80'
      }`}
    >
      {/* Cover — section-colored gradient by material kind */}
      <div className="relative flex h-24 items-center justify-center" style={{ background: cover.gradient }}>
        <CoverIcon className="h-9 w-9 text-white/90" />
        {!m.canAccess && (
          <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/95 px-2 py-0.5 text-[10px] font-semibold text-brand-gold-ink">
            <Lock className="h-3 w-3" /> Locked
          </span>
        )}
        {m.isMandatory && m.canAccess && (
          <span className="absolute right-3 top-3 rounded-full bg-brand-orange-alt px-2 py-0.5 text-[10px] font-subheading font-semibold uppercase tracking-wide text-white">
            Mandatory
          </span>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <span className="inline-flex w-fit items-center gap-1 rounded-full bg-brand-hairline px-2 py-0.5 text-[11px] font-medium text-brand-muted">
          {COURSE_TYPE_LABELS[m.course_type]}
        </span>
        <h3 className="font-semibold leading-snug text-brand-blue-dark">{m.title}</h3>
        {m.description && <p className="line-clamp-2 text-sm text-brand-muted-soft">{m.description}</p>}

        {m.dueAt && (
          <p className="flex items-center gap-1 text-xs font-medium text-brand-gold-ink">
            <AlertCircle className="h-3.5 w-3.5" />
            Due {formatDateShort(m.dueAt)}
          </p>
        )}

        <div className="mt-auto flex items-center justify-between gap-3 pt-2">
          <div className="flex items-center gap-3 text-xs text-brand-muted-soft">
            {m.sectionCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <Layers className="h-3.5 w-3.5" />
                {m.sectionCount} {m.sectionCount === 1 ? 'section' : 'sections'}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <BookOpen className="h-3.5 w-3.5" />
              {m.itemCount} {m.itemCount === 1 ? 'lesson' : 'lessons'}
            </span>
          </div>
          {m.itemCount > 0 && <ProgressRing pct={pct} done={done} />}
        </div>

        {m.canAccess && (
          <span className="mt-1 text-xs font-semibold text-brand-blue-dark group-hover:underline">
            {done ? 'Review course' : started ? 'Continue' : 'Start course'} →
          </span>
        )}
      </div>
    </div>
  )

  return m.canAccess ? (
    <Link href={`/community/training/${m.id}`} className="block h-full">
      {body}
    </Link>
  ) : (
    <div className="block h-full">{body}</div>
  )
}

function Section({ title, modules }: { title: string; modules: TrainingModuleSummary[] }) {
  if (modules.length === 0) return null
  return (
    <section>
      <h2 className="mb-3 text-sm font-subheading font-semibold uppercase tracking-wide text-brand-muted-soft">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {modules.map((m) => (
          <ModuleCard key={`${m.id}-${m.event_ref ?? ''}`} m={m} />
        ))}
      </div>
    </section>
  )
}

// FR-COM-10 — Training section.
// Shows (1) modules assigned for the member's upcoming events (mandatory surfaced
// first), and (2) the wider catalogue split by Event/Campaign vs CTE vs general.
export default async function TrainingPage() {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const events = await getMemberEvents(member)
  // Assignments are keyed by the event's Sanity _id, but match by slug too so an
  // assignment created with either identifier resolves.
  const eventRefs = events
    .flatMap((e) => [e.eventId, e.slug])
    .filter((id): id is string => !!id)
  // Resolve the member's Event Participation Role(s) so role-targeted assignments
  // surface (assignments also accept 'all'). A Student Manager also receives any
  // training assigned to School Students (mirrors lib/membership-grants).
  const eventRoles: string[] = []
  if (member.event_role) {
    eventRoles.push(member.event_role)
    if (member.event_role === 'school_student_manager') eventRoles.push('school_student')
  }
  const assigned = await getAssignedModules(member, { eventRefs, eventRoles })
  assigned.sort((a, b) => Number(b.isMandatory) - Number(a.isMandatory))

  const all = await listModules(member)
  const curriculum = all.filter((m) => m.material_kind === 'curriculum')
  const cte = all.filter((m) => m.material_kind === 'cte')
  const general = all.filter((m) => m.material_kind === 'general')

  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow flex items-center gap-2 text-brand-gold-ink">
          <span className="h-2 w-2 rounded-full bg-brand-orange" /> Academy
        </p>
        <h1 className="mt-1 font-heading uppercase text-title text-brand-blue-dark">Training</h1>
        <p className="mt-1 text-sm text-brand-muted-soft">
          Complete training for your events, plus ongoing courses available with your membership.
        </p>
      </div>

      <Section title="For your events" modules={assigned} />
      <Section title="Academy curriculum" modules={curriculum} />
      <Section title="Career &amp; Technical Education (CTE)" modules={cte} />
      <Section title="Library" modules={general} />

      {assigned.length === 0 && all.length === 0 && (
        <EmptyState title="No training available yet. Check back soon." />
      )}
    </div>
  )
}
