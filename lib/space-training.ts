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
