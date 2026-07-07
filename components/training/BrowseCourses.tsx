'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { themeAccent, type TrainingModuleSummary } from '@/lib/training-display'
import { ThemePill, AccessPill, type AccessState } from './Pills'

// Browse courses catalogue — a single searchable list over the full published
// catalogue passed from the server. The access button collapses to two states:
// has access → "View course"; otherwise → "View Access Options".

function kindLabel(m: TrainingModuleSummary): string {
  if (m.material_kind === 'campaign') return 'Campaign'
  if (m.material_kind === 'event') return 'Event'
  if (m.material_kind === 'cte' || m.material_kind === 'curriculum') return 'CTE'
  return 'Library'
}

function accessState(m: TrainingModuleSummary): AccessState {
  if (!m.canAccess) return m.minTierRank > 0 ? 'tier' : 'locked'
  if (m.minTierRank > 0) return 'paid'
  if (m.material_kind === 'event' || m.material_kind === 'campaign') return 'included'
  return 'free'
}

function CourseCard({ m }: { m: TrainingModuleSummary }) {
  const accent = themeAccent(m.theme)
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-brand-border bg-white">
      <div className="h-1.5" style={{ background: accent.color }} aria-hidden />
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-center justify-between gap-2">
          <ThemePill theme={m.theme} label={kindLabel(m)} />
          <AccessPill state={accessState(m)} />
        </div>
        <h3 className="text-base font-semibold leading-snug text-brand-blue-dark">{m.title}</h3>
        {m.description && <p className="line-clamp-2 text-sm text-brand-muted-soft">{m.description}</p>}
        <p className="text-xs text-brand-muted-soft">
          {m.itemCount} {m.itemCount === 1 ? 'lesson' : 'lessons'}
          {m.sectionCount > 0 && ` · ${m.sectionCount} ${m.sectionCount === 1 ? 'section' : 'sections'}`}
        </p>
        <div className="mt-auto pt-1">
          {m.canAccess ? (
            <Link
              href={`/community/training/${m.id}`}
              className="block w-full rounded-lg bg-brand-blue px-4 py-2 text-center text-sm font-semibold text-white transition hover:bg-brand-blue-bright"
            >
              View course
            </Link>
          ) : (
            <Link
              href="/membership"
              className="block w-full rounded-lg bg-brand-soft px-4 py-2 text-center text-sm font-semibold text-brand-blue-bright transition hover:bg-[#DCE6FD]"
              style={{ background: '#EAF0FE', color: '#2C53C6' }}
            >
              View Access Options
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

export function BrowseCourses({ modules }: { modules: TrainingModuleSummary[] }) {
  const [q, setQ] = useState('')

  const query = q.trim().toLowerCase()
  const shown = modules.filter(
    (m) =>
      query === '' ||
      m.title.toLowerCase().includes(query) ||
      (m.description ?? '').toLowerCase().includes(query)
  )

  return (
    <div className="space-y-5">
      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-muted-soft" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search all courses"
          aria-label="Search all courses"
          className="w-full rounded-xl border border-brand-border bg-white py-2.5 pl-10 pr-4 text-sm text-brand-blue-dark placeholder:text-brand-muted-soft focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
        />
      </div>

      {/* Cards */}
      {shown.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((m) => (
            <CourseCard key={m.id} m={m} />
          ))}
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-brand-border bg-white p-6 text-sm text-brand-muted-soft">
          No courses match{query ? ` “${q}”` : ' this filter'}.
        </p>
      )}
    </div>
  )
}
