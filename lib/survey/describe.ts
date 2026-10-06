/**
 * Plain-English descriptions of a survey definition for the admin question
 * viewer (/admin/surveys/questions): what each page is, how a question is
 * answered, and when it is shown. Read-only; nothing here changes what
 * respondents see.
 */
import { parseShowIf } from './branching'
import { ROLES, type Question, type QuestionType, type SurveyDefinition } from './definition'

const PAGE_TITLES: Record<string, string> = {
  experience: 'Your experience',
  stem_intent: 'STEM plans',
  skills: 'Skills',
  logistics: 'Logistics',
  about_you: 'About you',
  whats_next: 'What’s next',
  your_words: 'In your own words',
  your_time: 'Your time',
  web: 'Website',
  consent: 'Quoting and follow-up',
}

export function pageTitle(id: string): string {
  if (PAGE_TITLES[id]) return PAGE_TITLES[id]
  const words = id.replace(/_/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export const TYPE_LABELS: Record<QuestionType, string> = {
  single: 'Choose one',
  multi: 'Choose any',
  nps: '0–10 rating',
  grid: 'Rating grid',
  number: 'Number',
  text_short: 'Short text',
  text_long: 'Long text',
  boolean: 'Yes / no',
  school_lookup: 'School search',
}

const SOURCE_LABELS: Record<string, string> = {
  gender: 'the gender options on member profiles',
  ethnicity: 'the ethnicity list on member profiles',
  grade: 'the grade options on member profiles',
}

/** How the question is answered, beyond its option list. */
export function answerFormat(q: Question): string | null {
  switch (q.type) {
    case 'nps':
      return q.npsLabels ? `0 (${q.npsLabels.min}) to 10 (${q.npsLabels.max})` : '0 to 10'
    case 'number': {
      const range = q.min !== undefined && q.max !== undefined ? `${q.min}–${q.max}` : q.min !== undefined ? `${q.min} or more` : null
      return [range, q.unit].filter(Boolean).join(' ') || null
    }
    case 'text_short':
    case 'text_long':
    case 'school_lookup':
      return q.maxChars ? `Up to ${q.maxChars} characters` : null
    default:
      return q.optionsSource ? `Options from ${SOURCE_LABELS[q.optionsSource] ?? q.optionsSource}` : null
  }
}

/** Context facts the definitions branch on, phrased as the condition. */
const FACTS: Record<string, (v: unknown) => string | null> = {
  first_time: (v) => (v === true ? 'it is their first Stellr event' : v === false ? 'they have been to a Stellr event before' : null),
  is_minor: (v) => (v === true ? 'they are a minor' : v === false ? 'they are not a minor' : null),
  quote_eligible_by_agreement: (v) => (v === true ? 'they are a minor whose agreement allows quoting' : v === false ? 'their agreement does not allow quoting' : null),
}

const PROFILE_LABELS: Record<string, string> = { gender: 'gender', ethnicity: 'ethnicity', grade: 'grade', school: 'school' }

function findQuestion(def: SurveyDefinition, key: string): Question | null {
  for (const role of ROLES) for (const p of def.branches[role]) for (const q of p.questions) if (q.key === key) return q
  return null
}

function quoteOption(q: Question | null, value: unknown): string {
  const opt = q?.options?.find((o) => o.key === value)
  return `“${opt?.label ?? String(value)}”`
}

function orList(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`
}

/**
 * "Shown only if …" for a show_if expression. Falls back to the raw
 * expression (never throws) so a new construct still shows something.
 */
export function describeShowIf(expr: string, def: SurveyDefinition): string {
  let e: ReturnType<typeof parseShowIf>
  try {
    e = parseShowIf(expr)
  } catch {
    return `Shown only if ${expr}`
  }

  if (e.path.startsWith('profile.')) {
    const field = PROFILE_LABELS[e.path.slice('profile.'.length)] ?? e.path
    if (e.op === 'is null' || e.op === 'is empty') return `Shown only if their profile has no ${field} on file`
  }

  const fact = FACTS[e.path]
  if (fact && (e.op === '==' || e.op === '!=')) {
    const phrase = fact(e.op === '==' ? e.value : e.value === true ? false : e.value === false ? true : undefined)
    if (phrase) return `Shown only if ${phrase}`
  }

  const q = findQuestion(def, e.path)
  if (q) {
    const label = `“${q.label}”`
    switch (e.op) {
      case '==':
        return `Shown only if the answer to ${label} is ${quoteOption(q, e.value)}`
      case '!=':
        return `Shown only if the answer to ${label} is not ${quoteOption(q, e.value)}`
      case 'in':
        return `Shown only if the answer to ${label} is ${orList(e.values.map((v) => quoteOption(q, v)))}`
      case 'includes':
        return `Shown only if they chose ${quoteOption(q, e.value)} for ${label}`
      case 'is null':
      case 'is empty':
        return `Shown only if ${label} was left blank`
    }
  }
  return `Shown only if ${expr}`
}

/** "Already known" notes: questions skipped when the invitation carries the answer. */
export function skipNote(q: Question): string | null {
  if (!q.skipIfKnownFrom) return null
  return 'Skipped when the invitation already says how this person was involved (teacher or parent records); the known answer is recorded instead.'
}

export interface QuestionCounts {
  pages: number
  questions: number
  required: number
  conditional: number
}

export function branchCounts(def: SurveyDefinition, role: (typeof ROLES)[number]): QuestionCounts {
  const pages = def.branches[role]
  const qs = pages.flatMap((p) => p.questions)
  return { pages: pages.length, questions: qs.length, required: qs.filter((q) => q.required).length, conditional: qs.filter((q) => q.showIf).length }
}
