'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback } from 'react'

// Three filter groups, one per standardised card pill:
//   Theme    — Space / Environmental          (blue when active)
//   Location — Live Events / Async Campaigns   (gold when active)
//   Grade    — Middle / High School            (dark-blue when active)
const THEME_OPTIONS = [
  { value: '', label: 'All Themes' },
  { value: 'space', label: 'Space Design' },
  { value: 'enviro', label: 'Environmental Design' },
]

const LOCATION_OPTIONS = [
  { value: '', label: 'All Locations' },
  { value: 'event', label: 'Live Events' },
  { value: 'campaign', label: 'Async Campaigns' },
]

const GRADE_OPTIONS = [
  { value: '', label: 'All Grades' },
  { value: 'Middle School', label: 'Middle School' },
  { value: 'High School', label: 'High School' },
]

type Accent = 'blue' | 'gold' | 'blueDark'

const ACTIVE: Record<Accent, string> = {
  blue: 'bg-brand-blue text-white border-brand-blue',
  gold: 'bg-pathway-amber text-white border-pathway-amber',
  blueDark: 'bg-brand-blue-dark text-white border-brand-blue-dark',
}

const HOVER: Record<Accent, string> = {
  blue: 'hover:border-brand-blue hover:text-brand-blue',
  gold: 'hover:border-pathway-amber hover:text-pathway-amber',
  blueDark: 'hover:border-brand-blue-dark hover:text-brand-blue-dark',
}

export function EventsFilterBar() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const setParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value) params.set(key, value)
      else params.delete(key)
      router.push(`${pathname}?${params.toString()}`)
    },
    [searchParams, pathname, router]
  )

  const renderGroup = (
    paramKey: string,
    options: { value: string; label: string }[],
    accent: Accent
  ) => {
    const current = searchParams.get(paramKey) ?? ''
    return (
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setParam(paramKey, opt.value)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors border ${
              current === opt.value
                ? ACTIVE[accent]
                : `bg-white text-brand-grey-dark border-line ${HOVER[accent]}`
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    )
  }

  const divider = <div className="h-6 w-px bg-line-light hidden sm:block" />

  return (
    <div className="flex flex-wrap gap-3 items-center">
      {renderGroup('theme', THEME_OPTIONS, 'blue')}
      {divider}
      {renderGroup('location', LOCATION_OPTIONS, 'gold')}
      {divider}
      {renderGroup('grade', GRADE_OPTIONS, 'blueDark')}
    </div>
  )
}
