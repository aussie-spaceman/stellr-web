import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, BookOpen, Layers, Lock } from 'lucide-react'
import { getCurrentMember } from '@/lib/community'
import { getModule, COURSE_TYPE_LABELS } from '@/lib/training'
import { TrainingItemRow } from '@/components/community/TrainingItemRow'

export const metadata = { title: 'Community · Training Module' }

export default async function TrainingModulePage({
  params,
}: {
  params: Promise<{ moduleId: string }>
}) {
  const member = await getCurrentMember()
  if (!member) redirect('/sign-up')

  const { moduleId } = await params
  const mod = await getModule(member, moduleId)
  if (!mod) notFound()

  // Tier gate (entitlement-aware). Free-tier members see an upgrade prompt
  // rather than the lesson list (FR-COM-08 / FR-COM-10).
  if (!mod.canAccess) {
    return (
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="font-heading uppercase text-title text-brand-blue-dark">{mod.title}</h1>
        <p className="mt-2 text-sm text-brand-muted-soft">
          This training is available to a higher membership tier.
        </p>
        <a
          href="/account?tab=billing"
          className="mt-4 inline-block rounded-md border border-brand-orange bg-brand-orange/5 px-4 py-2 text-sm font-medium text-brand-gold-ink hover:bg-brand-orange/10"
        >
          Upgrade to access
        </a>
      </div>
    )
  }

  const pct = mod.itemCount > 0 ? Math.round((mod.completedCount / mod.itemCount) * 100) : 0

  // Sequential lesson numbering across all sections + ungrouped.
  let counter = 0

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/community/training"
        className="mb-4 inline-flex items-center gap-1 text-sm text-brand-muted-soft hover:text-brand-muted"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Training
      </Link>

      {/* Course header */}
      <div className="overflow-hidden rounded-2xl border border-brand-border bg-white">
        <div className="bg-gradient-to-br from-brand-blue-dark to-brand-blue px-6 py-6 text-white">
          <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-medium">
            {COURSE_TYPE_LABELS[mod.course_type]}
          </span>
          <h1 className="mt-2 text-2xl font-bold">{mod.title}</h1>
          {mod.description && <p className="mt-1 max-w-2xl text-sm text-white/75">{mod.description}</p>}
          <div className="mt-3 flex items-center gap-4 text-xs text-white/70">
            {mod.sectionCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <Layers className="h-3.5 w-3.5" />
                {mod.sectionCount} {mod.sectionCount === 1 ? 'section' : 'sections'}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <BookOpen className="h-3.5 w-3.5" />
              {mod.itemCount} {mod.itemCount === 1 ? 'lesson' : 'lessons'}
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="px-6 py-4">
          <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-brand-muted-soft">
            <span>
              {mod.completedCount} of {mod.itemCount} complete
            </span>
            <span className={pct === 100 ? 'text-green-600' : 'text-brand-muted'}>{pct}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-brand-hairline">
            <div
              className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-green-500' : 'bg-brand-blue-dark'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Curriculum */}
      <div className="mt-6 space-y-6">
        {mod.sections.map((section) => {
          const start = counter
          counter += section.items.length
          const done = section.items.filter((i) => i.completed).length
          return (
            <section key={section.id}>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h2 className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-brand-muted">
                  {section.locked && <Lock className="h-3.5 w-3.5 text-brand-gold-ink" />}
                  {section.title}
                </h2>
                {section.locked && section.availableAt ? (
                  <span className="text-xs font-medium text-brand-gold-ink">
                    Unlocks {new Date(section.availableAt).toLocaleDateString()}
                  </span>
                ) : (
                  <span className="text-xs text-brand-muted-soft">
                    {done}/{section.items.length}
                  </span>
                )}
              </div>
              <ul className="space-y-2">
                {section.items.map((item, i) => (
                  <TrainingItemRow
                    key={item.id}
                    item={item}
                    index={start + i + 1}
                    moduleId={mod.id}
                    locked={section.locked}
                    availableAt={section.availableAt}
                  />
                ))}
                {section.items.length === 0 && (
                  <li className="rounded-lg border border-dashed border-brand-border p-3 text-xs text-brand-muted-soft">
                    No lessons in this section yet.
                  </li>
                )}
              </ul>
            </section>
          )
        })}

        {mod.ungrouped.length > 0 && (
          <section>
            {mod.sections.length > 0 && (
              <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-brand-muted">
                More lessons
              </h2>
            )}
            <ul className="space-y-2">
              {mod.ungrouped.map((item, i) => (
                <TrainingItemRow
                  key={item.id}
                  item={item}
                  index={counter + i + 1}
                  moduleId={mod.id}
                />
              ))}
            </ul>
          </section>
        )}

        {mod.items.length === 0 && (
          <p className="text-sm text-brand-muted-soft">No lessons in this module yet.</p>
        )}
      </div>
    </div>
  )
}
