'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

export type AdminTab = 'overview' | 'builder' | 'tracking' | 'reminders'

const TABS: { value: AdminTab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'builder', label: 'Course builder' },
  { value: 'tracking', label: 'Event tracking' },
  { value: 'reminders', label: 'Reminders & escalation' },
]

export function AdminTrainingTabs({ active }: { active: AdminTab }) {
  const pathname = usePathname()
  const params = useSearchParams()
  // Switching tab drops tab-specific params (obj/filter/course) to start clean.
  const href = (tab: AdminTab) => {
    const next = new URLSearchParams()
    const role = params.get('role')
    if (role) next.set('role', role)
    next.set('tab', tab)
    return `${pathname}?${next.toString()}`
  }
  return (
    <nav className="flex flex-wrap items-center gap-6 border-b border-brand-border" aria-label="Admin training sections">
      {TABS.map((t) => {
        const isActive = active === t.value
        return (
          <Link
            key={t.value}
            href={href(t.value)}
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
