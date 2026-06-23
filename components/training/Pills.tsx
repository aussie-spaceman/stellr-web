import { themeAccent, type CourseTheme } from '@/lib/training'

// Small presentational pills shared across the Training portal. Theme accents are
// dynamic hex (from THEME_META), so those use inline styles; everything else uses
// brand-* Tailwind tokens.

const PILL = 'inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide'

/** Theme-tinted kind pill, e.g. EVENT / CAMPAIGN / CTE / LIBRARY. */
export function ThemePill({ theme, label }: { theme: CourseTheme | null; label: string }) {
  const a = themeAccent(theme)
  return (
    <span className={PILL} style={{ background: a.tint, color: a.ink }}>
      {label}
    </span>
  )
}

/** Gold "Required" pill for mandatory courses. */
export function RequiredPill() {
  return (
    <span className={PILL} style={{ background: '#FBEFDD', color: '#C2722A' }}>
      Required
    </span>
  )
}

export function OptionalPill() {
  return <span className={`${PILL} bg-brand-hairline text-brand-muted-soft`}>Optional</span>
}

export type AccessState = 'included' | 'free' | 'paid' | 'tier' | 'locked'

const ACCESS_STYLE: Record<AccessState, { label: string; bg: string; color: string }> = {
  included: { label: 'Included', bg: '#EAF0FE', color: '#2C53C6' },
  free: { label: 'Free', bg: '#E7F7F1', color: '#158463' },
  paid: { label: 'Paid', bg: '#FBEFDD', color: '#C2722A' },
  tier: { label: 'Tier', bg: '#F1ECFF', color: '#5B3FD6' },
  locked: { label: 'Locked', bg: '#F0F2F8', color: '#5A6178' },
}

export function AccessPill({ state }: { state: AccessState }) {
  const s = ACCESS_STYLE[state]
  return (
    <span className={PILL} style={{ background: s.bg, color: s.color }}>
      {s.label}
    </span>
  )
}
