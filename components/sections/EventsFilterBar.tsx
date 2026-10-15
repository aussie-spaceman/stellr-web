'use client'

// Three filter groups, one per standardised card pill:
//   Theme    — Space / Environmental          (blue when active)
//   Location — Live Events / Async Campaigns   (gold when active)
//   Grade    — Middle / High School            (dark-blue when active)
export const THEME_OPTIONS = [
  { value: '', label: 'All Themes' },
  { value: 'space', label: 'Space Design' },
  { value: 'enviro', label: 'Environmental Design' },
]

export const LOCATION_OPTIONS = [
  { value: '', label: 'All Locations' },
  { value: 'event', label: 'Live Events' },
  { value: 'campaign', label: 'Async Campaigns' },
]

export const GRADE_OPTIONS = [
  { value: '', label: 'All Grades' },
  { value: 'Middle School', label: 'Middle School' },
  { value: 'High School', label: 'High School' },
]

export type EventFilters = { theme: string; location: string; grade: string }

type Accent = 'blue' | 'gold' | 'blueDark'

const ACTIVE: Record<Accent, string> = {
  blue: 'bg-primary-deep text-white border-primary-deep',
  gold: 'bg-pathway-amber text-ink border-pathway-amber',
  blueDark: 'bg-ink text-white border-ink',
}

const HOVER: Record<Accent, string> = {
  blue: 'hover:border-primary-deep hover:text-primary-deep',
  gold: 'hover:border-pathway-amber-deep hover:text-ink',
  blueDark: 'hover:border-ink hover:text-ink',
}

/**
 * The /events filter chips. Filtering happens in the browser (EventsBoard):
 * the lists are small, and filtering on the server made every tap a full round
 * trip with no feedback, and kept the page from being cached.
 */
export function EventsFilterBar({ value, onChange }: { value: EventFilters; onChange: (next: EventFilters) => void }) {
  const renderGroup = (key: keyof EventFilters, label: string, options: { value: string; label: string }[], accent: Accent) => (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = value[key] === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange({ ...value, [key]: opt.value })}
            className={`min-h-11 rounded-full border px-4 text-sm font-medium transition-colors ${
              active ? ACTIVE[accent] : `border-line bg-white text-brand-grey-dark ${HOVER[accent]}`
            }`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )

  const divider = <div className="hidden h-6 w-px bg-line-light sm:block" />

  return (
    <div className="flex flex-wrap items-center gap-3">
      {renderGroup('theme', 'Theme', THEME_OPTIONS, 'blue')}
      {divider}
      {renderGroup('location', 'Format', LOCATION_OPTIONS, 'gold')}
      {divider}
      {renderGroup('grade', 'Grades', GRADE_OPTIONS, 'blueDark')}
    </div>
  )
}
