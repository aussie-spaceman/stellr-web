// Client-safe Training display helpers: pure constants, derived-label functions,
// and the data-shape types. NO server imports — so client components ('use client')
// can pull theme/type helpers without dragging Clerk/Supabase server-only code into
// the browser bundle. lib/training.ts re-exports everything here for server callers.

export type MaterialKind = 'general' | 'event' | 'campaign' | 'cte' | 'curriculum'

/** How a course's content is paced/released (Circle-style course types). */
export type CourseType = 'self_paced' | 'structured' | 'scheduled'

export const COURSE_TYPE_LABELS: Record<CourseType, string> = {
  self_paced: 'Self-paced',
  structured: 'Structured',
  scheduled: 'Scheduled',
}

/**
 * Visual/content theme of a course (Training Scope domain model). Distinct from
 * material_kind (which controls WHERE a course surfaces): theme drives the accent
 * colour shown on course rows, cards, certificates, and event-readiness tiles.
 */
export type CourseTheme = 'space' | 'environmental' | 'campaign'

export const THEME_META: Record<CourseTheme, { label: string; color: string; tint: string; ink: string }> = {
  space:         { label: 'Space',         color: '#7C5CFC', tint: '#F1ECFF', ink: '#5B3FD6' },
  environmental: { label: 'Environmental', color: '#1FA97A', tint: '#E7F7F1', ink: '#158463' },
  campaign:      { label: 'Campaign',      color: '#E0922F', tint: '#FBEFDD', ink: '#C2722A' },
}

/** Neutral fallback accent for courses with no theme set yet. */
export const NO_THEME_ACCENT = { label: '', color: '#3C6DF6', tint: '#EAF0FE', ink: '#2C53C6' }

export function themeAccent(theme: CourseTheme | null | undefined) {
  return theme ? THEME_META[theme] : NO_THEME_ACCENT
}

/**
 * The course "Type" shown on cards/headers is DERIVED, not stored: Event &
 * Campaign vs CTE · Career Technical. Curriculum is treated as CTE-flavoured
 * (ongoing, tier-dependent); general/library courses are their own neutral kind.
 */
export type TrainingType = 'event_campaign' | 'cte' | 'general'

export const TYPE_META: Record<TrainingType, { label: string; short: string; color: string; tint: string; ink: string }> = {
  event_campaign: { label: 'Event & Campaign', short: 'Event', color: '#3C6DF6', tint: '#EAF0FE', ink: '#2C53C6' },
  cte:            { label: 'CTE · Career Technical', short: 'CTE', color: '#16B6C4', tint: '#E2F6F8', ink: '#0E8C97' },
  general:        { label: 'Library', short: 'Library', color: '#5A6178', tint: '#F0F2F8', ink: '#5A6178' },
}

/** Derive the displayed Type from a course's material_kind. */
export function deriveType(kind: MaterialKind): TrainingType {
  if (kind === 'event' || kind === 'campaign') return 'event_campaign'
  if (kind === 'cte' || kind === 'curriculum') return 'cte'
  return 'general'
}

/** Issuer name shown on certificates, derived from the course kind. */
export function courseIssuer(kind: MaterialKind): string {
  return kind === 'cte' || kind === 'curriculum' ? 'Stellr Academy' : 'Stellr Education'
}

export interface TrainingItem {
  id: string
  title: string
  content_kind: 'video' | 'document' | 'google_doc' | 'link' | 'live' | 'interactive'
  external_url: string | null
  estimated_minutes: number | null
  display_order: number
  completed: boolean
}

/** A named, ordered group of lessons within a module. */
export interface TrainingSection {
  id: string
  title: string
  display_order: number
  items: TrainingItem[]
  /** Drip release: when this section unlocks (null = available now). */
  availableAt: string | null
  /** True when the section's content is not yet released to this member. */
  locked: boolean
}

export interface TrainingModuleSummary {
  id: string
  title: string
  description: string | null
  material_kind: MaterialKind
  course_type: CourseType
  theme: CourseTheme | null
  event_ref: string | null
  /** Legacy tier gate (0 = any authenticated member; >0 = needs a paid tier). */
  minTierRank: number
  sectionCount: number
  itemCount: number
  completedCount: number
  /** Set when surfaced via an event assignment. */
  isMandatory?: boolean
  dueAt?: string | null
  /** Whether the current member can access this module (entitlement-aware). */
  canAccess: boolean
}
