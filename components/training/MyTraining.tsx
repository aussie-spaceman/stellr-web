import Link from 'next/link'
import { themeAccent, type TrainingModuleSummary, TYPE_META } from '@/lib/training'
import type { MyTraining as MyTrainingData, AssignedCourse } from '@/lib/training-portal'
import { roleLabel } from '@/lib/training-portal'
import { ThemePill, RequiredPill } from './Pills'
import { deadlineInfo } from './deadline'

// My training dashboard — priority list of required courses plus continue-learning.
// Pure presentational server component; data comes from getMyTraining.

function kindLabel(c: AssignedCourse): string {
  if (c.type === 'event_campaign') return c.objectType === 'campaign' ? 'Campaign' : 'Event'
  if (c.type === 'cte') return 'CTE'
  return 'Library'
}

function StatCard({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="rounded-2xl border border-brand-border bg-white p-5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-muted-soft">{label}</p>
      <p className={`mt-2 text-3xl font-bold ${danger ? 'text-[#C0392B]' : 'text-brand-blue-dark'}`}>{value}</p>
    </div>
  )
}

function StatsRow({ stats }: { stats: MyTrainingData['stats'] }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
      <StatCard label="Required to do" value={stats.requiredToDo} />
      <StatCard label="Due this week" value={stats.dueThisWeek} danger />
      <StatCard label="In progress" value={stats.inProgress} />
    </div>
  )
}

function ProgressBar({ done, total, theme }: { done: number; total: number; theme?: string }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const complete = total > 0 && done >= total
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-brand-hairline">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${pct}%`, background: complete ? '#1FA97A' : theme || '#3C6DF6' }}
      />
    </div>
  )
}

function startLabel(done: number, total: number): string {
  if (total > 0 && done >= total) return 'Review'
  return done > 0 ? 'Continue' : 'Start'
}

/* ─── Priority list row ──────────────────────────────────────────────────── */

function RequiredRow({ c }: { c: AssignedCourse }) {
  const accent = themeAccent(c.theme)
  const dl = deadlineInfo(c.dueAt)
  return (
    <div
      className="flex flex-col gap-3 rounded-2xl border border-brand-border bg-white p-5 sm:flex-row sm:items-center sm:justify-between"
      style={{ borderLeft: `4px solid ${accent.color}` }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <ThemePill theme={c.theme} label={kindLabel(c)} />
          <RequiredPill />
          <span className="text-xs text-brand-muted-soft">
            {c.objectLabel} · {roleLabel(c.role)}
          </span>
        </div>
        <h3 className="mt-2 text-base font-semibold text-brand-blue-dark">{c.title}</h3>
        <div className="mt-3 flex items-center gap-3">
          <div className="max-w-xs flex-1">
            <ProgressBar done={c.completedCount} total={c.itemCount} theme={accent.color} />
          </div>
          <span className="shrink-0 text-xs text-brand-muted-soft">
            {c.completedCount} of {c.itemCount} lessons
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4 sm:flex-col sm:items-end">
        {dl && (
          <span className="text-sm font-semibold" style={{ color: dl.color }}>
            {dl.text}
          </span>
        )}
        <Link
          href={`/community/training/${c.moduleId}`}
          className="shrink-0 rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-blue-bright"
        >
          {startLabel(c.completedCount, c.itemCount)}
        </Link>
      </div>
    </div>
  )
}

function ContinueCard({ m }: { m: TrainingModuleSummary }) {
  const accent = themeAccent(m.theme)
  const type = TYPE_META[m.material_kind === 'cte' || m.material_kind === 'curriculum' ? 'cte' : m.material_kind === 'event' || m.material_kind === 'campaign' ? 'event_campaign' : 'general']
  return (
    <Link
      href={`/community/training/${m.id}`}
      className="group flex flex-col gap-3 rounded-2xl border border-brand-border bg-white p-5 transition hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-30px_rgba(20,26,61,.4)]"
      style={{ borderTop: `3px solid ${accent.color}` }}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: type.ink }}>
        {type.short}
      </span>
      <h3 className="text-base font-semibold leading-snug text-brand-blue-dark">{m.title}</h3>
      <div className="mt-auto space-y-2">
        <ProgressBar done={m.completedCount} total={m.itemCount} theme={accent.color} />
        <div className="flex items-center justify-between text-xs text-brand-muted-soft">
          <span>{m.completedCount} of {m.itemCount} lessons</span>
          <span className="font-semibold text-brand-blue-dark group-hover:underline">
            {startLabel(m.completedCount, m.itemCount)} →
          </span>
        </div>
      </div>
    </Link>
  )
}

/* ─── Screen ─────────────────────────────────────────────────────────────── */

export function MyTraining({ data }: { data: MyTrainingData }) {
  return (
    <div className="space-y-8">
      <StatsRow stats={data.stats} />

      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-xl font-bold text-brand-blue-dark">Required for your events</h2>
          <span className="text-xs text-brand-muted-soft">Sorted by deadline</span>
        </div>
        {data.required.length > 0 ? (
          <div className="space-y-3">
            {data.required.map((c) => (
              <RequiredRow key={`${c.moduleId}-${c.objectRef}`} c={c} />
            ))}
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed border-brand-border bg-white p-6 text-sm text-brand-muted-soft">
            No required training right now. You&apos;re all caught up.
          </p>
        )}
      </section>

      {data.continueLearning.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-xl font-bold text-brand-blue-dark">Continue learning</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {data.continueLearning.map((m) => (
              <ContinueCard key={m.id} m={m} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
