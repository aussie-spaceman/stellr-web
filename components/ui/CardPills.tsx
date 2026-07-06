import { Orbit, Environment } from '@stellr/icons'
import type { CampaignTheme } from '@/lib/campaigns'

// The three standardised pills shown on every Event and Campaign card + detail
// hero, one per /events filter group:
//   1. Location  — Event (blue) / Campaign (amber)
//   2. Grade     — Middle School / High School (neutral)
//   3. Theme     — Space (violet) / Environmental (green), with icon
// Keeping this in one component means cards and detail pages never drift apart.

const themeChip: Record<CampaignTheme, string> = {
  space: 'bg-space-violet-chip text-space-violet-text',
  enviro: 'bg-enviro-green-chip text-enviro-green-text',
}

// A Sanity `type` only maps to a theme when it names one; "Virtual"/blank → none.
function resolveTheme(theme?: CampaignTheme | null, type?: string | null): CampaignTheme | null {
  if (theme) return theme
  const t = (type ?? '').toLowerCase()
  if (t.includes('environ')) return 'enviro'
  if (t.includes('space')) return 'space'
  return null
}

export function CardPills({
  kind,
  gradeLevel,
  theme,
  type,
  size = 'sm',
  className = '',
}: {
  kind: 'event' | 'campaign'
  gradeLevel?: string | null
  /** Explicit theme (campaigns carry it); otherwise derived from `type`. */
  theme?: CampaignTheme | null
  /** Sanity `type` string, e.g. "Space Design Challenge" — used to derive theme. */
  type?: string | null
  size?: 'sm' | 'md'
  className?: string
}) {
  const resolvedTheme = resolveTheme(theme, type)
  const ThemeIcon = resolvedTheme === 'enviro' ? Environment : Orbit
  const themeLabel = resolvedTheme === 'enviro' ? 'Environmental' : 'Space'

  const pad = size === 'md' ? 'text-sm px-3 py-1.5' : 'text-xs px-2 py-1'
  const iconSize = size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5'

  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {/* 1. Location */}
      <span
        className={`font-bold uppercase tracking-[0.08em] rounded-full ${pad} ${
          kind === 'campaign'
            ? 'bg-pathway-amber-bg text-pathway-amber'
            : 'bg-blue-50 text-brand-blue'
        }`}
      >
        {kind === 'campaign' ? 'Campaign' : 'Event'}
      </span>

      {/* 2. Grade */}
      {gradeLevel && (
        <span className={`font-semibold rounded-full bg-surface text-content-body ${pad}`}>
          {gradeLevel}
        </span>
      )}

      {/* 3. Theme */}
      {resolvedTheme && (
        <span
          className={`inline-flex items-center gap-1 font-semibold rounded-full ${pad} ${themeChip[resolvedTheme]}`}
        >
          <ThemeIcon className={iconSize} /> {themeLabel}
        </span>
      )}
    </div>
  )
}
