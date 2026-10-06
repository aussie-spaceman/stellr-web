/**
 * Survey definitions: the stored JSON (lib/survey/definitions/*.json, then
 * `survey_definitions.definition`) normalised into pages and questions the
 * renderer, validator and exporter all share.
 *
 * The stored form is the authoring form — shared blocks referenced by `ref`,
 * scales named once, option lists that are either strings or {key,label}. It
 * is never rewritten; everything here is derived on read, so a published
 * definition's hash keeps meaning what respondents saw.
 */
export const ROLES = ['student', 'mentor', 'adult'] as const
export type RespondentRole = (typeof ROLES)[number]

export type QuestionType =
  | 'single'
  | 'multi'
  | 'nps'
  | 'grid'
  | 'number'
  | 'text_short'
  | 'text_long'
  | 'boolean'
  | 'school_lookup'

export interface Option {
  /** Stored as the answer: the option's key, or the label itself for plain-string options. */
  key: string
  label: string
  /** Numeric score for scale options (higher = more positive); null for "Not applicable" and the like. */
  numeric: number | null
  exclusive?: boolean
}

export interface GridRow {
  key: string
  label: string
}

export interface Question {
  key: string
  type: QuestionType
  label: string
  required: boolean
  options?: Option[]
  /** Options filled at runtime from the profile vocabularies (gender, ethnicity, grade). */
  optionsSource?: OptionsSource
  rows?: GridRow[]
  min?: number
  max?: number
  unit?: string
  maxChars?: number
  showIf?: string
  /** Answers to this question may be quoted (V2.3 §2) — shown with a visible tag. */
  quotable: boolean
  labelTag?: string
  help?: string
  /** The answer is already known from the invitation; the question is skipped and the known value recorded. */
  skipIfKnownFrom?: string
  npsLabels?: { min: string; max: string }
}

export type OptionsSource = 'gender' | 'ethnicity' | 'grade'

export interface Page {
  id: string
  questions: Question[]
}

export interface SurveyDefinition {
  key: string
  version: number
  /** How the version is named to people ("1.1"); the stored version stays an integer. */
  versionLabel: string
  title: string
  targetMinutes: Record<RespondentRole, number>
  intro: { heading: string; bodyStudent: string; bodyAdult: string }
  branches: Record<RespondentRole, Page[]>
}

// ── Raw (authoring) shapes ───────────────────────────────────────────────────

type RawOption = string | { key: string; label: string; exclusive?: boolean }
interface RawQuestion {
  key?: string
  ref?: string
  type?: QuestionType
  label?: string
  required?: boolean
  scale?: string
  options?: RawOption[]
  extra_options?: string[]
  options_source?: string
  rows?: GridRow[]
  extra_rows?: GridRow[]
  min?: number
  max?: number
  unit?: string
  max_chars?: number
  show_if?: string
  quotable?: boolean
  label_tag?: string
  help?: string
  skip_if_known_from?: string
}
interface RawDefinition {
  key: string
  version: number
  version_label?: string
  title: string
  target_minutes?: Partial<Record<RespondentRole, number>>
  scales: Record<string, string[] | { min: number; max: number; min_label: string; max_label: string }>
  intro: { heading: string; body_student: string; body_adult: string }
  branches: Record<RespondentRole, { page: string; questions: RawQuestion[] }[]>
  shared?: Record<string, RawQuestion>
}

/**
 * Scales listed best-first score in reverse. Everything else is listed
 * worst-first and scores 1..n. "Not applicable" and extra options (e.g. "I'm
 * graduating") score null; a middle "Not sure" is the scale's midpoint.
 */
const DESCENDING_SCALES = new Set(['return5'])
const UNSCORED = new Set(['Not applicable'])

function scaleOptions(name: string, labels: string[], extra: string[] = []): Option[] {
  const scored = labels.filter((l) => !UNSCORED.has(l))
  const n = scored.length
  const opts = labels.map((label) => {
    const i = scored.indexOf(label)
    const numeric = i < 0 ? null : DESCENDING_SCALES.has(name) ? n - i : i + 1
    return { key: label, label, numeric }
  })
  return [...opts, ...extra.map((label) => ({ key: label, label, numeric: null }))]
}

function plainOptions(raw: RawOption[]): Option[] {
  return raw.map((o) =>
    typeof o === 'string'
      ? { key: o, label: o, numeric: null }
      : { key: o.key, label: o.label, numeric: null, ...(o.exclusive ? { exclusive: true } : {}) },
  )
}

function optionsSourceOf(raw?: string): OptionsSource | undefined {
  if (!raw) return undefined
  if (raw.startsWith('members.gender')) return 'gender'
  if (raw.startsWith('ethnicity_options')) return 'ethnicity'
  if (raw.startsWith('members.grade')) return 'grade'
  throw new Error(`Unknown options_source: ${raw}`)
}

function normaliseQuestion(raw: RawQuestion, def: RawDefinition): Question {
  let q: RawQuestion = raw
  if (raw.ref) {
    const shared = def.shared?.[raw.ref]
    if (!shared) throw new Error(`Unknown shared question: ${raw.ref}`)
    q = {
      ...shared,
      ...(raw.show_if ? { show_if: raw.show_if } : {}),
      rows: [...(shared.rows ?? []), ...(raw.extra_rows ?? [])],
    }
  }
  if (!q.key || !q.type || !q.label) throw new Error(`Question missing key/type/label: ${JSON.stringify(raw)}`)

  const out: Question = {
    key: q.key,
    type: q.type,
    label: q.label,
    required: q.required === true,
    quotable: q.quotable === true,
  }
  if (q.show_if) out.showIf = q.show_if
  if (q.label_tag) out.labelTag = q.label_tag
  if (q.help) out.help = q.help
  if (q.skip_if_known_from) out.skipIfKnownFrom = q.skip_if_known_from
  if (q.max_chars) out.maxChars = q.max_chars
  if (q.type === 'text_long' && !out.maxChars) out.maxChars = 600
  if (q.type === 'text_short' && !out.maxChars) out.maxChars = 200
  if (q.type === 'school_lookup') out.maxChars = 160
  if (q.min !== undefined) out.min = q.min
  if (q.max !== undefined) out.max = q.max
  if (q.unit) out.unit = q.unit
  if (q.rows?.length) out.rows = q.rows

  if (q.type === 'nps') {
    const s = def.scales.nps
    if (s && !Array.isArray(s)) out.npsLabels = { min: s.min_label, max: s.max_label }
    out.min = 0
    out.max = 10
  } else if (q.scale) {
    const s = def.scales[q.scale]
    if (!Array.isArray(s)) throw new Error(`Unknown scale: ${q.scale}`)
    out.options = scaleOptions(q.scale, s, q.extra_options)
  } else if (q.options) {
    out.options = plainOptions(q.options)
  }
  const source = optionsSourceOf(q.options_source)
  if (source) out.optionsSource = source
  return out
}

export function normaliseDefinition(raw: unknown): SurveyDefinition {
  const def = raw as RawDefinition
  if (!def?.key || !def.version || !def.branches) throw new Error('Not a survey definition')
  const branches = {} as Record<RespondentRole, Page[]>
  for (const role of ROLES) {
    const pages = def.branches[role]
    if (!pages) throw new Error(`Definition has no ${role} branch`)
    branches[role] = pages.map((p) => ({ id: p.page, questions: p.questions.map((q) => normaliseQuestion(q, def)) }))
  }
  return {
    key: def.key,
    version: def.version,
    versionLabel: def.version_label || String(def.version),
    title: def.title,
    targetMinutes: {
      student: def.target_minutes?.student ?? 5,
      mentor: def.target_minutes?.mentor ?? 4,
      adult: def.target_minutes?.adult ?? 4,
    },
    intro: { heading: def.intro.heading, bodyStudent: def.intro.body_student, bodyAdult: def.intro.body_adult },
    branches,
  }
}

/**
 * "v1.1": the version as people name it. Versions are stored as integers
 * (post_event v1.1 is version 2), so a definition may carry a display label.
 */
export function versionName(version: number, label?: string | null): string {
  return `v${label || version}`
}

/** Every question in a branch, page order. */
export function questionsFor(def: SurveyDefinition, role: RespondentRole): Question[] {
  return def.branches[role].flatMap((p) => p.questions)
}

/** Fill runtime option lists (gender, ethnicity, grade) into a question. */
export function withRuntimeOptions(q: Question, sources: Partial<Record<OptionsSource, Option[]>>): Question {
  if (!q.optionsSource) return q
  return { ...q, options: sources[q.optionsSource] ?? [] }
}

export interface CatalogEntry {
  question_key: string
  label: string
  type: string
  options: unknown
}

/**
 * The answer keys a definition can produce, for survey_question_catalog. Grid
 * rows are answers in their own right; a key asked in several branches with
 * different wording keeps the first wording met (student, mentor, adult).
 */
export function catalogEntries(def: SurveyDefinition): CatalogEntry[] {
  const out = new Map<string, CatalogEntry>()
  for (const role of ROLES) {
    for (const q of questionsFor(def, role)) {
      if (q.type === 'grid') {
        for (const row of q.rows ?? []) {
          if (!out.has(row.key)) {
            out.set(row.key, {
              question_key: row.key,
              label: `${q.label.replace(/…$/, '')} ${row.label.toLowerCase()}`.trim(),
              type: 'scale',
              options: q.options?.map((o) => ({ label: o.label, numeric: o.numeric })) ?? null,
            })
          }
        }
        continue
      }
      if (out.has(q.key)) continue
      out.set(q.key, {
        question_key: q.key,
        label: q.label,
        type: q.type,
        options: q.options?.map((o) => ({ key: o.key, label: o.label, numeric: o.numeric })) ?? (q.optionsSource ? { source: q.optionsSource } : null),
      })
    }
  }
  return [...out.values()]
}
