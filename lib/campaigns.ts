import type { StellarEvent } from './sanity'

export type CampaignSeason = 'fall' | 'spring'

export interface CampaignDates {
  label: string       // e.g. "Fall 2026"
  startDate: string   // ISO date
  endDate: string     // ISO date
  registrationOpens: string
  registrationCloses: string
}

/**
 * Returns all derived dates for a campaign based solely on its season and year.
 *
 * Fall   — Campaign: Aug 15 – Dec 15. Registration: Aug 1 – Nov 30.
 * Spring — Campaign: Jan 1  – Apr 30. Registration: Dec 1 (prior year) – Mar 31.
 */
export function getCampaignDates(season: CampaignSeason, year: number): CampaignDates {
  if (season === 'fall') {
    return {
      label: `Fall ${year}`,
      startDate: `${year}-08-15`,
      endDate: `${year}-12-15`,
      registrationOpens: `${year}-08-01`,
      registrationCloses: `${year}-11-30`,
    }
  }
  // spring — registration opens in December of the prior year
  return {
    label: `Spring ${year}`,
    startDate: `${year}-01-01`,
    endDate: `${year}-04-30`,
    registrationOpens: `${year - 1}-12-01`,
    registrationCloses: `${year}-03-31`,
  }
}

export function campaignStatusFromDates(
  dates: CampaignDates,
  registrationOpenOverride?: boolean
): 'Open' | 'Coming soon' | 'Closed' {
  if (registrationOpenOverride === false) return 'Closed'
  const today = new Date().toISOString().split('T')[0]
  if (dates.endDate < today) return 'Closed'
  if (dates.startDate > today) return 'Coming soon'
  return 'Open'
}

// ── Theme ─────────────────────────────────────────────────────────────────────
// Campaigns carry a competition theme (Space or Environmental). The Sanity `type`
// field stores the full theme name ("Space Design Challenge" / "Environmental
// Design Challenge"); this derives the short theme id everything else keys off.
export type CampaignTheme = 'space' | 'enviro'

export function themeFromType(type?: string | null): CampaignTheme {
  return (type ?? '').toLowerCase().includes('environ') ? 'enviro' : 'space'
}

// Design-system display metadata per theme. Themes keep their own violet/green
// coding *in addition* to the amber Campaign accent (see CLAUDE.md visual code).
// `icon` is the @stellr/icons export name to render in a tile.
export const THEME_META: Record<
  CampaignTheme,
  { label: string; chip: string; iconBg: string; icon: 'Orbit' | 'Environment' }
> = {
  space: {
    label: 'Space',
    chip: 'bg-space-violet-chip text-space-violet-text',
    iconBg: 'bg-space-violet',
    icon: 'Orbit',
  },
  enviro: {
    label: 'Environmental',
    chip: 'bg-enviro-green-chip text-enviro-green-text',
    iconBg: 'bg-enviro-green',
    icon: 'Environment',
  },
}

// ── Deadline ────────────────────────────────────────────────────────────────
export interface DeadlineInfo {
  iso: string
  /** e.g. "15 May 2026" (en-GB, British spelling per Stellr voice). */
  label: string
  /** Whole days from today until the deadline (negative once passed). */
  daysLeft: number
  passed: boolean
}

export function deadlineInfo(deadline?: string | null): DeadlineInfo | null {
  if (!deadline) return null
  const due = new Date(`${deadline}T00:00:00`)
  if (Number.isNaN(due.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const daysLeft = Math.round((due.getTime() - today.getTime()) / 86_400_000)
  return {
    iso: deadline,
    label: due.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
    daysLeft,
    passed: daysLeft < 0,
  }
}

// "in 41 days" / "due today" / "closed" — the phrase shown next to a deadline date.
export function deadlinePhrase(info: DeadlineInfo | null): string {
  if (!info) return ''
  if (info.passed) return 'closed'
  if (info.daysLeft === 0) return 'due today'
  return `in ${info.daysLeft} day${info.daysLeft === 1 ? '' : 's'}`
}

// Short season label from a campaign's season + year — e.g. "Spring 2026".
export function seasonLabel(season?: string | null, year?: number | null): string {
  if (!season || !year) return ''
  return `${season === 'fall' ? 'Fall' : 'Spring'} ${year}`
}

// ── View model ──────────────────────────────────────────────────────────────
// Serializable shape passed from server components to the client CampaignCard /
// registration modal. Keeps Sanity + date/theme logic in one place.
export interface CampaignCardData {
  slug: string
  title: string
  theme: CampaignTheme
  themeLabel: string
  seasonLabel: string
  gradeLevel?: string | null
  tagline?: string | null
  deadlineLabel: string
  registered?: boolean
  /** Watermarked card-header image URL, computed server-side (urlFor + wmSrc). */
  imageUrl?: string | null
}

// Serializable view of a campaign passed from server components to the signup /
// dashboard campaign pickers (which link to the group registration flow).
export interface CampaignOption {
  slug: string
  title: string
  theme: CampaignTheme
  themeLabel: string
  seasonLabel: string
  deadlineLabel: string
}

export function toCampaignCardData(e: StellarEvent): CampaignCardData {
  const theme = themeFromType(e.type)
  return {
    slug: e.slug?.current ?? '',
    title: e.title,
    theme,
    themeLabel: THEME_META[theme].label,
    seasonLabel: seasonLabel(e.season, e.campaignYear),
    gradeLevel: e.gradeLevel ?? null,
    tagline: e.tagline ?? null,
    deadlineLabel: deadlineInfo(e.deadline)?.label ?? '',
  }
}
