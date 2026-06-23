'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Search, GraduationCap } from 'lucide-react'
import { themeAccent, deriveType, type TrainingModuleSummary } from '@/lib/training-display'
import { ThemePill, AccessPill, type AccessState } from './Pills'

// Browse courses catalogue — search + Event/Campaign vs CTE segmented control.
// Filtering is client-side over the full published catalogue passed from the
// server. The access button collapses to two states (Q: README rule):
// has access → "View course"; otherwise → "View Access Options".

type CatTab = 'event' | 'cte'

function inTab(m: TrainingModuleSummary, tab: CatTab): boolean {
  if (tab === 'event') return m.material_kind === 'event' || m.material_kind === 'campaign'
  return m.material_kind === 'cte' || m.material_kind === 'curriculum' || m.material_kind === 'general'
}

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

const CONTEXT: Record<CatTab, string> = {
  event:
    'Tied to events and campaigns you are registered for. You can only enrol in courses you have permission to access.',
  cte: 'Ongoing Career Technical Education courses. Availability depends on your membership tier — some are free, some are paid.',
}

export function BrowseCourses({ modules }: { modules: TrainingModuleSummary[] }) {
  const [tab, setTab] = useState<CatTab>('event')
  const [q, setQ] = useState('')

  const query = q.trim().toLowerCase()
  const shown = modules.filter(
    (m) =>
      inTab(m, tab) &&
      (query === '' ||
        m.title.toLowerCase().includes(query) ||
        (m.description ?? '').toLowerCase().includes(query))
  )

  const tabs: { value: CatTab; label: string; color: string }[] = [
    { value: 'event', label: 'Event & Campaign', color: '#3C6DF6' },
    { value: 'cte', label: 'CTE · Career Technical', color: '#16B6C4' },
  ]

  return (
    <div className="space-y-5">
      {/* Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
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
        <div className="inline-flex shrink-0 items-center rounded-xl border border-brand-border bg-white p-1" role="tablist" aria-label="Course type">
          {tabs.map((t) => {
            const active = tab === t.value
            return (
              <button
                key={t.value}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.value)}
                className="rounded-lg px-4 py-1.5 text-sm font-semibold transition"
                style={
                  active
                    ? { background: t.color, color: '#fff' }
                    : { color: '#5A6178' }
                }
              >
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Context strip */}
      <div className="flex items-start gap-3 rounded-2xl border border-brand-border bg-brand-soft/40 p-4" style={{ background: '#EFF3FE' }}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: tab === 'event' ? '#3C6DF6' : '#16B6C4' }}>
          <GraduationCap className="h-5 w-5 text-white" />
        </span>
        <div>
          <p className="text-sm font-semibold text-brand-blue-dark">
            {tab === 'event' ? 'Event & Campaign training' : 'CTE · Career Technical Education'}
          </p>
          <p className="text-sm text-brand-muted-soft">{CONTEXT[tab]}</p>
        </div>
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
