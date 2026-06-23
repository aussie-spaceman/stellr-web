'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

// Client-side navigation controls for the Training portal. State lives in the URL
// (?tab=&role=&layout=) so screens stay server-rendered and links are shareable;
// Next client navigation makes switching feel single-page (no full reload).

export type MemberTab = 'my' | 'browse' | 'group' | 'certs'

function useHrefBuilder() {
  const pathname = usePathname()
  const params = useSearchParams()
  return (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k)
      else next.set(k, v)
    }
    const qs = next.toString()
    return qs ? `${pathname}?${qs}` : pathname
  }
}

/* ─── Role switch (Student / Teacher) ────────────────────────────────────── */

export function RoleSwitch({ role }: { role: 'student' | 'teacher' }) {
  const build = useHrefBuilder()
  const opts: { value: 'student' | 'teacher'; label: string }[] = [
    { value: 'student', label: 'Student' },
    { value: 'teacher', label: 'Teacher' },
  ]
  return (
    <div
      role="tablist"
      aria-label="View as"
      className="inline-flex items-center rounded-full border border-brand-border bg-white p-1"
    >
      {opts.map((o) => {
        const active = role === o.value
        // Leaving Teacher hides Group progress — send Students to My training.
        const href = build({ role: o.value, tab: o.value === 'student' ? 'my' : null })
        return (
          <Link
            key={o.value}
            href={href}
            role="tab"
            aria-selected={active}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
              active ? 'bg-brand-blue-dark text-white' : 'text-brand-muted hover:text-brand-blue-dark'
            }`}
          >
            {o.label}
          </Link>
        )
      })}
    </div>
  )
}

/* ─── Sub-nav tabs ───────────────────────────────────────────────────────── */

export function TrainingTabs({ active, showGroup }: { active: MemberTab; showGroup: boolean }) {
  const build = useHrefBuilder()
  const tabs: { value: MemberTab; label: string }[] = [
    { value: 'my', label: 'My training' },
    { value: 'browse', label: 'Browse courses' },
    ...(showGroup ? [{ value: 'group' as const, label: 'Group progress' }] : []),
    { value: 'certs', label: 'Certificates' },
  ]
  return (
    <nav className="flex items-center gap-6 border-b border-brand-border" aria-label="Training sections">
      {tabs.map((t) => {
        const isActive = active === t.value
        return (
          <Link
            key={t.value}
            href={build({ tab: t.value })}
            aria-current={isActive ? 'page' : undefined}
            className={`-mb-px border-b-2 pb-3 pt-1 text-sm font-semibold transition ${
              isActive
                ? 'border-brand-blue text-brand-blue-dark'
                : 'border-transparent text-brand-muted-soft hover:text-brand-muted'
            }`}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}

/* ─── Layout toggle (A · Priority list / B · Grouped by Object) ───────────── */

export function LayoutToggle({ variant }: { variant: 'A' | 'B' }) {
  const build = useHrefBuilder()
  const opts: { value: 'A' | 'B'; label: string }[] = [
    { value: 'A', label: 'A · Priority list' },
    { value: 'B', label: 'B · Grouped by Object' },
  ]
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-brand-muted-soft">Layout</span>
      <div className="inline-flex items-center rounded-lg border border-brand-border bg-white p-0.5">
        {opts.map((o) => {
          const active = variant === o.value
          return (
            <Link
              key={o.value}
              href={build({ layout: o.value })}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                active ? 'bg-brand-canvas text-brand-blue-dark shadow-sm' : 'text-brand-muted-soft hover:text-brand-muted'
              }`}
            >
              {o.label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
