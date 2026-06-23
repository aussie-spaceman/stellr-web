// Pure, client-safe helpers for the Mentoring redesign (no server imports).
// Session times are stored in UTC and always DISPLAYED in the cohort's time zone
// with the zone shown (US Central / CT by default), per the handoff.

export const DEFAULT_TZ = 'America/Chicago'

/** Selectable cohort time zones (handoff: default CT, selectable per cohort). */
export const TIMEZONES: { value: string; label: string }[] = [
  { value: 'America/Chicago', label: 'Central Time (CT)' },
  { value: 'America/New_York', label: 'Eastern Time (ET)' },
  { value: 'America/Denver', label: 'Mountain Time (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific Time (PT)' },
  { value: 'America/Anchorage', label: 'Alaska Time (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii Time (HT)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
]

/** Short zone abbreviation for a given instant (e.g. "CT", "CDT"). */
export function tzAbbr(tz: string, when: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'short',
    }).formatToParts(when)
    const z = parts.find((p) => p.type === 'timeZoneName')?.value ?? ''
    // Collapse CST/CDT → CT etc. for the friendly label used across the design.
    const friendly: Record<string, string> = {
      CST: 'CT', CDT: 'CT', EST: 'ET', EDT: 'ET', MST: 'MT', MDT: 'MT',
      PST: 'PT', PDT: 'PT', AKST: 'AKT', AKDT: 'AKT', HST: 'HT',
    }
    return friendly[z] ?? z
  } catch {
    return ''
  }
}

function fmt(tz: string, opts: Intl.DateTimeFormatOptions, d: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...opts }).format(d)
}

export interface SessionTimeParts {
  /** "Tuesday 1 July" */
  dateLine: string
  /** "Tue 1 Jul" */
  dateShort: string
  /** "18:00–19:30 CT" */
  timeLine: string
  /** "90 min" */
  durationLabel: string
  /** "Tuesday 1 July · 18:00–19:30 CT · 90 min" */
  full: string
  /** day-of-month + short month, for calendar/list tiles */
  day: string
  month: string
}

/** Format a session start/end in the cohort time zone for display. */
export function formatSessionTime(
  startIso: string,
  endIso: string | null,
  tz: string = DEFAULT_TZ,
): SessionTimeParts {
  const start = new Date(startIso)
  const end = endIso ? new Date(endIso) : new Date(start.getTime() + 60 * 60_000)
  const abbr = tzAbbr(tz, start)

  const dateLine = fmt(tz, { weekday: 'long', day: 'numeric', month: 'long' }, start)
  const dateShort = fmt(tz, { weekday: 'short', day: 'numeric', month: 'short' }, start)
  const startT = fmt(tz, { hour: '2-digit', minute: '2-digit', hour12: false }, start)
  const endT = fmt(tz, { hour: '2-digit', minute: '2-digit', hour12: false }, end)
  const timeLine = `${startT}–${endT}${abbr ? ' ' + abbr : ''}`
  const mins = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000))
  const durationLabel = mins >= 60 && mins % 60 === 0 ? `${mins / 60} hr` : `${mins} min`

  return {
    dateLine,
    dateShort,
    timeLine,
    durationLabel,
    full: `${dateLine} · ${timeLine} · ${durationLabel}`,
    day: fmt(tz, { day: 'numeric' }, start),
    month: fmt(tz, { month: 'short' }, start),
  }
}

// ─── Theme tiles (handoff: space violet / enviro green) ─────────────────────
export type CohortTheme = 'space' | 'enviro'

export function themeTile(theme: string): { gradient: string; chip: string; label: string } {
  if (theme === 'enviro') {
    return {
      gradient: 'linear-gradient(150deg,#1FA97A,#15805C)',
      chip: 'bg-enviro-green-chip text-enviro-green-text',
      label: 'ENVIRO',
    }
  }
  return {
    gradient: 'linear-gradient(150deg,#7C5CFC,#5B3FE0)',
    chip: 'bg-space-violet-chip text-space-violet-text',
    label: 'SPACE',
  }
}

// ─── Access labels (handoff colour coding) ──────────────────────────────────
export type AccessKind = 'free' | 'credit' | 'paid'

export function accessLabel(kind: AccessKind, opts: { priceCents?: number | null; creditCost?: number } = {}): {
  text: string
  className: string
} {
  if (kind === 'free') return { text: 'Free with membership', className: 'text-enviro-green-text' }
  if (kind === 'credit') {
    const n = opts.creditCost ?? 1
    return { text: `${n} mentoring credit${n === 1 ? '' : 's'}`, className: 'text-space-violet' }
  }
  return { text: `${formatUsd(opts.priceCents ?? 0)} one-off`, className: 'text-pathway-amber' }
}

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`
}
