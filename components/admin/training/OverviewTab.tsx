import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { formatDateShort } from '@/lib/utils'
import type { AdminOverview } from '@/lib/training-admin'

// Admin Overview: stats (incl. clickable Needs attention → tracking?filter=outstanding),
// per-Object event-training readiness, and recently-edited courses.

function readinessColor(pct: number): string {
  if (pct >= 80) return '#158463'
  if (pct >= 60) return '#B07A1E'
  return '#C0392B'
}

export function OverviewTab({ data }: { data: AdminOverview }) {
  return (
    <div className="space-y-8">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-brand-border bg-white p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-muted-soft">Published courses</p>
          <p className="mt-2 text-3xl font-bold text-brand-blue-dark">{data.publishedCourses}</p>
        </div>
        <div className="rounded-2xl border border-brand-border bg-white p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-muted-soft">Enrolled members</p>
          <p className="mt-2 text-3xl font-bold text-brand-blue-dark">{data.enrolledMembers}</p>
        </div>
        <div className="rounded-2xl border border-brand-border bg-white p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-muted-soft">Avg completion</p>
          <p className="mt-2 text-3xl font-bold text-[#158463]">{data.avgCompletion}%</p>
        </div>
        {/* Needs attention — clickable, jumps to tracking with outstanding filter. */}
        <Link
          href="?tab=tracking&filter=outstanding"
          className="group rounded-2xl border p-5 transition"
          style={{ borderColor: '#F3C9C0', background: '#FFF8F7' }}
        >
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#C0392B]">Needs attention</p>
          <p className="mt-2 text-3xl font-bold text-[#C0392B]">
            {data.needsAttention} <span className="text-xl font-semibold">{data.needsAttention === 1 ? 'event' : 'events'}</span>
          </p>
          <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-[#C0392B] group-hover:underline">
            Overdue mandatory training <ArrowRight className="h-3 w-3" />
          </p>
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        {/* Event training readiness */}
        <section>
          <h2 className="mb-3 text-lg font-bold text-brand-blue-dark">Event training readiness</h2>
          <div className="space-y-3">
            {data.readiness.length === 0 && (
              <p className="rounded-2xl border border-dashed border-brand-border bg-white p-5 text-sm text-brand-muted-soft">
                No events have mandatory training assigned yet.
              </p>
            )}
            {data.readiness.map((o) => {
              const color = readinessColor(o.pct)
              return (
                <div
                  key={o.ref}
                  className="rounded-2xl border border-brand-border bg-white p-4"
                  style={{ borderLeft: `4px solid ${color}` }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate font-semibold text-brand-blue-dark">{o.label}</p>
                    <span className="shrink-0 text-sm font-bold" style={{ color }}>{o.pct}%</span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-brand-hairline">
                    <div className="h-full rounded-full" style={{ width: `${o.pct}%`, background: color }} />
                  </div>
                  <Link
                    href={`?tab=tracking&obj=${encodeURIComponent(o.ref)}`}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-blue-bright hover:underline"
                  >
                    Track <ArrowRight className="h-3 w-3" />
                  </Link>
                </div>
              )
            })}
          </div>
        </section>

        {/* Recently edited */}
        <section>
          <h2 className="mb-3 text-lg font-bold text-brand-blue-dark">Recently edited</h2>
          <div className="divide-y divide-brand-hairline rounded-2xl border border-brand-border bg-white">
            {data.recentlyEdited.map((c) => (
              <Link
                key={c.id}
                href={`?tab=builder&course=${c.id}`}
                className="flex items-center gap-3 px-4 py-3 transition hover:bg-brand-canvas"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-blue-dark font-mono text-xs font-bold text-white">
                  {c.title.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-brand-blue-dark">{c.title}</p>
                  <p className="text-xs text-brand-muted-soft">
                    {c.lessons} {c.lessons === 1 ? 'lesson' : 'lessons'} · {formatDateShort(c.updatedAt)}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    c.isPublished ? 'bg-[#E7F7F1] text-[#158463]' : 'bg-brand-hairline text-brand-muted-soft'
                  }`}
                >
                  {c.isPublished ? 'Published' : 'Draft'}
                </span>
              </Link>
            ))}
            {data.recentlyEdited.length === 0 && (
              <p className="px-4 py-3 text-sm text-brand-muted-soft">No courses yet.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
