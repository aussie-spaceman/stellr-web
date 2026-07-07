'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

// Client-side navigation controls for the Training portal. State lives in the URL
// (?tab=) so screens stay server-rendered and links are shareable; Next client
// navigation makes switching feel single-page (no full reload).

export type MemberTab = 'my' | 'browse' | 'group'

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

/* ─── Sub-nav tabs ───────────────────────────────────────────────────────── */

export function TrainingTabs({ active, showGroup }: { active: MemberTab; showGroup: boolean }) {
  const build = useHrefBuilder()
  const tabs: { value: MemberTab; label: string }[] = [
    { value: 'my', label: 'My training' },
    { value: 'browse', label: 'Browse courses' },
    ...(showGroup ? [{ value: 'group' as const, label: 'Group progress' }] : []),
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
