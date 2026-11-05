// Per age-bracket requirements for training assigned to a Space
// (community_space_training.bracket_requirements — migration 127).
//
// A course can be mandatory for specific age brackets, each with its own
// completion deadline. When a member's bracket has no entry, callers fall back
// to the row's legacy `is_mandatory` boolean with no deadline.

export const SPACE_TRAINING_BRACKETS = [
  { value: 'high_school', label: 'High School' },
  { value: 'college', label: 'College' },
  { value: 'adult', label: 'Adult' },
] as const

export type AgeBracketKey = (typeof SPACE_TRAINING_BRACKETS)[number]['value']

export interface BracketRequirement {
  mandatory: boolean
  /** Absolute completion deadline, 'YYYY-MM-DD', or null for none. */
  due_at: string | null
}

export type BracketRequirements = Partial<Record<AgeBracketKey, BracketRequirement>>

const BRACKET_KEYS = SPACE_TRAINING_BRACKETS.map((b) => b.value)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Coerce untrusted input (from the admin API body or a jsonb column) into a
 * clean BracketRequirements. Only mandatory brackets are stored — an optional
 * bracket carries no deadline and is simply omitted (absent = optional). A
 * deadline is kept only when that bracket is mandatory and the date is valid.
 */
export function sanitizeBracketRequirements(input: unknown): BracketRequirements {
  const out: BracketRequirements = {}
  if (!input || typeof input !== 'object') return out
  const obj = input as Record<string, unknown>
  for (const key of BRACKET_KEYS) {
    const raw = obj[key]
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    if (!r.mandatory) continue
    const due_at = typeof r.due_at === 'string' && DATE_RE.test(r.due_at) ? r.due_at : null
    out[key] = { mandatory: true, due_at }
  }
  return out
}

/** Legacy rollup for `is_mandatory`: mandatory when any bracket is mandatory. */
export function anyBracketMandatory(reqs: BracketRequirements): boolean {
  return BRACKET_KEYS.some((k) => reqs[k]?.mandatory)
}

/**
 * Resolve a member's effective requirement for one assignment. Uses the entry
 * for the member's bracket when present, else falls back to the legacy
 * `is_mandatory` boolean (no deadline).
 */
export function resolveRequirement(
  reqs: BracketRequirements | null | undefined,
  bracket: string | null | undefined,
  fallbackMandatory: boolean
): { mandatory: boolean; dueAt: string | null } {
  const entry = reqs && bracket && (BRACKET_KEYS as string[]).includes(bracket)
    ? reqs[bracket as AgeBracketKey]
    : undefined
  if (entry) return { mandatory: entry.mandatory, dueAt: entry.due_at }
  return { mandatory: fallbackMandatory, dueAt: null }
}

/** A course shown on a Space's Training tab. */
export interface SpaceCourse {
  id: string
  title: string
  description: string | null
  mandatory: boolean
  dueAt: string | null
  total: number
  done: number
  /** The event or cohort that assigned it. Null when linked to the Space directly. */
  assignedVia: string | null
}

interface SpaceLink {
  training_module_id: string
  is_mandatory: boolean
  bracket_requirements: BracketRequirements | null
}

interface CourseSummary {
  id: string
  title: string
  description: string | null
  itemCount: number
  completedCount: number
}

interface MemberAssignment {
  moduleId: string
  title: string
  description: string | null
  itemCount: number
  completedCount: number
  objectRef: string
  eventSlug: string | null
  objectLabel: string
  requirement: string
  dueAt: string | null
}

const earliest = (a: string | null, b: string | null) => (a && b ? (a < b ? a : b) : a ?? b)

/**
 * What a member's Training tab shows for a Space. A course reaches a Space two
 * ways: linked to the Space itself (community_space_training), or assigned to
 * the event, cohort or container the Space belongs to (course_object_assignments
 * and the legacy event table). `assigned` is already narrowed to this member by
 * audience and tier; `refs` names what this Space belongs to. Directly linked
 * courses come first, in their configured order. `summaries` holds published
 * courses only, so a draft course never shows.
 */
export function coursesForSpace({
  links,
  summaries,
  assigned,
  refs,
  bracket,
}: {
  links: SpaceLink[]
  summaries: CourseSummary[]
  assigned: MemberAssignment[]
  refs: string[]
  bracket: string | null | undefined
}): SpaceCourse[] {
  const out = new Map<string, SpaceCourse>()
  const summaryById = new Map(summaries.map((s) => [s.id, s]))

  for (const link of links) {
    const summary = summaryById.get(link.training_module_id)
    if (!summary) continue
    const req = resolveRequirement(link.bracket_requirements, bracket, link.is_mandatory)
    out.set(summary.id, {
      id: summary.id,
      title: summary.title,
      description: summary.description,
      mandatory: req.mandatory,
      dueAt: req.dueAt,
      total: summary.itemCount,
      done: summary.completedCount,
      assignedVia: null,
    })
  }

  for (const a of assigned) {
    if (!refs.includes(a.eventSlug ?? a.objectRef) && !refs.includes(a.objectRef)) continue
    const mandatory = a.requirement === 'mandatory'
    const seen = out.get(a.moduleId)
    if (seen) {
      seen.mandatory = seen.mandatory || mandatory
      seen.dueAt = earliest(seen.dueAt, mandatory ? a.dueAt : null)
      continue
    }
    out.set(a.moduleId, {
      id: a.moduleId,
      title: a.title,
      description: a.description,
      mandatory,
      dueAt: mandatory ? a.dueAt : null,
      total: a.itemCount,
      done: a.completedCount,
      assignedVia: a.objectLabel,
    })
  }

  return [...out.values()]
}
