/**
 * Answers: cleaning an autosaved draft, checking a submission, and turning
 * the draft into survey_answers rows.
 *
 * Draft shapes, by question type:
 *   single / school_lookup / text_*  → string
 *   multi                            → string[] (option keys)
 *   nps / number                     → number
 *   grid                             → { rowKey: optionKey }
 *   boolean                          → boolean
 * Anything that does not fit is rejected, never coerced — the server is the
 * only writer and it validates against the published definition.
 */
import type { Option, OptionsSource, Question, SurveyDefinition } from './definition'
import { questionsFor, withRuntimeOptions } from './definition'
import type { AnswerValue, Answers, SurveyContext } from './branching'
import { visibleQuestions } from './branching'

export type RuntimeOptions = Partial<Record<OptionsSource, Option[]>>

/** Keys whose answers live on survey_responses columns as well as in answers. */
export const CONSENT_KEYS = ['quote_consent', 'no_quote_this_response', 'followup_consent'] as const

function optionKeys(q: Question): Set<string> {
  return new Set((q.options ?? []).map((o) => o.key))
}

/** Returns an error message, or null if the value fits the question. */
export function checkValue(q: Question, v: AnswerValue): string | null {
  if (v === null) return null
  switch (q.type) {
    case 'single':
      return typeof v === 'string' && optionKeys(q).has(v) ? null : 'Choose one of the options.'
    case 'multi': {
      if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) return 'Choose from the options.'
      const keys = optionKeys(q)
      if (!v.every((x) => keys.has(x))) return 'Choose from the options.'
      if (new Set(v).size !== v.length) return 'Choose each option once.'
      const exclusive = (q.options ?? []).filter((o) => o.exclusive).map((o) => o.key)
      if (v.length > 1 && v.some((x) => exclusive.includes(x))) return '“None of these” can’t be combined with other options.'
      return null
    }
    case 'nps':
      return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 10 ? null : 'Choose a number from 0 to 10.'
    case 'number': {
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'Enter a number.'
      if (q.min !== undefined && v < q.min) return `Enter ${q.min} or more.`
      if (q.max !== undefined && v > q.max) return `Enter ${q.max} or less.`
      return null
    }
    case 'grid': {
      if (typeof v !== 'object' || Array.isArray(v)) return 'Answer in the grid.'
      const rows = new Set((q.rows ?? []).map((r) => r.key))
      const keys = optionKeys(q)
      for (const [row, opt] of Object.entries(v)) {
        if (!rows.has(row) || typeof opt !== 'string' || !keys.has(opt)) return 'Answer in the grid.'
      }
      return null
    }
    case 'boolean':
      return typeof v === 'boolean' ? null : 'Tick or untick the box.'
    case 'text_short':
    case 'text_long':
    case 'school_lookup': {
      if (typeof v !== 'string') return 'Enter text.'
      const max = q.maxChars ?? 600
      return v.length > max ? `Keep this under ${max} characters.` : null
    }
  }
}

function cleanText(v: AnswerValue): AnswerValue {
  if (typeof v !== 'string') return v
  // Control characters out, Unicode normalised, whitespace trimmed.
  // eslint-disable-next-line no-control-regex
  const s = v.normalize('NFC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()
  return s === '' ? null : s
}

export type DraftResult = { ok: true; answers: Answers } | { ok: false; errors: Record<string, string> }

/**
 * Autosave: keep only keys this branch can ask (visibility is not enforced
 * here — a respondent may go back and change a branching answer), and reject
 * malformed values.
 */
export function sanitiseDraft(
  def: SurveyDefinition,
  ctx: SurveyContext,
  submitted: unknown,
  runtime: RuntimeOptions = {},
): DraftResult {
  if (!submitted || typeof submitted !== 'object' || Array.isArray(submitted)) {
    return { ok: false, errors: { _: 'Answers must be an object.' } }
  }
  const byKey = new Map(questionsFor(def, ctx.role).map((q) => [q.key, withRuntimeOptions(q, runtime)]))
  const answers: Answers = {}
  const errors: Record<string, string> = {}
  for (const [key, raw] of Object.entries(submitted as Record<string, AnswerValue>)) {
    const q = byKey.get(key)
    if (!q) {
      errors[key] = 'Not a question in this survey.'
      continue
    }
    const v = q.type.startsWith('text') || q.type === 'school_lookup' ? cleanText(raw) : raw
    if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) continue
    if (q.type === 'grid' && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue
    const err = checkValue(q, v)
    if (err) errors[key] = err
    else answers[key] = v
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, answers }
}

/** Required visible questions without an answer, keyed by question key. */
export function missingRequired(def: SurveyDefinition, ctx: SurveyContext, answers: Answers): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const q of visibleQuestions(def, ctx, answers)) {
    if (!q.required) continue
    const v = answers[q.key]
    const empty = v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
    if (empty) errors[q.key] = 'This question needs an answer.'
  }
  return errors
}

export interface AnswerRow {
  question_key: string
  value_text: string | null
  value_numeric: number | null
  value_options: string[] | null
}

export interface Flattened {
  rows: AnswerRow[]
  quoteConsent: 'named' | 'anonymous' | 'no' | null
  noQuote: boolean | null
  followupConsent: boolean | null
}

function optionRow(q: Question, key: string, answerKey = q.key): AnswerRow {
  const opt = q.options?.find((o) => o.key === key)
  return { question_key: answerKey, value_text: key, value_numeric: opt?.numeric ?? null, value_options: null }
}

/**
 * The rows written at submit. Only questions still visible count, so an answer
 * left behind on a branch the respondent backed out of is dropped. A relationship
 * known from the invitation is recorded as if answered.
 */
export function flattenAnswers(
  def: SurveyDefinition,
  ctx: SurveyContext,
  answers: Answers,
  runtime: RuntimeOptions = {},
): Flattened {
  const rows: AnswerRow[] = []
  const visible = visibleQuestions(def, ctx, answers).map((q) => withRuntimeOptions(q, runtime))
  for (const q of visible) {
    const v = answers[q.key]
    if (v === null || v === undefined) continue
    switch (q.type) {
      case 'single':
        rows.push(optionRow(q, v as string))
        break
      case 'multi':
        rows.push({ question_key: q.key, value_text: null, value_numeric: null, value_options: v as string[] })
        break
      case 'nps':
      case 'number':
        rows.push({ question_key: q.key, value_text: null, value_numeric: v as number, value_options: null })
        break
      case 'grid':
        for (const [row, opt] of Object.entries(v as Record<string, string>)) rows.push(optionRow(q, opt, row))
        break
      case 'boolean':
        rows.push({ question_key: q.key, value_text: v ? 'true' : 'false', value_numeric: v ? 1 : 0, value_options: null })
        break
      default:
        rows.push({ question_key: q.key, value_text: v as string, value_numeric: null, value_options: null })
    }
  }
  if (ctx.adult_relationship && ctx.role === 'adult' && !rows.some((r) => r.question_key === 'adult_relationship')) {
    rows.push({ question_key: 'adult_relationship', value_text: ctx.adult_relationship, value_numeric: null, value_options: null })
  }

  const has = (k: string) => visible.some((q) => q.key === k)
  const qc = answers.quote_consent
  return {
    rows,
    quoteConsent: has('quote_consent') && (qc === 'named' || qc === 'anonymous' || qc === 'no') ? qc : null,
    noQuote: has('no_quote_this_response') ? answers.no_quote_this_response === true : null,
    followupConsent: has('followup_consent') ? answers.followup_consent === true : null,
  }
}
