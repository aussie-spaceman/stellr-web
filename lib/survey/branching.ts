/**
 * Which pages and questions a respondent sees.
 *
 * `show_if` is a deliberately tiny language — one comparison per expression,
 * no code evaluation — covering what the definitions use:
 *   path == literal      path != literal
 *   path is null         path is empty
 *   path in ['a','b']    path includes 'a'
 * A path names a context fact (first_time, is_minor, quote_eligible_by_agreement,
 * profile.gender, …) or an earlier answer (adult_relationship, interests_parent).
 * Anything else throws, and a test parses every expression in every definition.
 */
import type { Page, Question, RespondentRole, SurveyDefinition } from './definition'

export type AdultRelationship = 'parent' | 'teacher'
export const PROFILE_FIELDS = ['gender', 'ethnicity', 'grade', 'school'] as const
export type ProfileField = (typeof PROFILE_FIELDS)[number]

/** Facts fixed when a response begins; stored on survey_responses.context. */
export interface SurveyContext {
  role: RespondentRole
  first_time: boolean
  is_minor: boolean
  /** A minor whose agreement and opt-outs allow quoting (V2.3 §1.7/§2). */
  quote_eligible_by_agreement: boolean
  /** Known from the invitation (teacher/parent records); null = ask. */
  adult_relationship: AdultRelationship | null
  /** Profile fields with nothing on file — only these demographics are asked. */
  profile_missing: ProfileField[]
  event_title: string
  event_slug: string
  event_year: number | null
  first_name: string | null
}

export type AnswerValue = string | number | boolean | string[] | Record<string, string> | null
export type Answers = Record<string, AnswerValue>

type Literal = string | number | boolean | null
type Expr =
  | { op: '==' | '!='; path: string; value: Literal }
  | { op: 'is null' | 'is empty'; path: string }
  | { op: 'in'; path: string; values: Literal[] }
  | { op: 'includes'; path: string; value: Literal }

const PATH = String.raw`([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?)`

function parseLiteral(raw: string): Literal {
  const s = raw.trim()
  if (s === 'true') return true
  if (s === 'false') return false
  if (s === 'null') return null
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  const m = /^'([^']*)'$/.exec(s)
  if (m) return m[1]
  throw new Error(`show_if: bad literal ${raw}`)
}

const cache = new Map<string, Expr>()

export function parseShowIf(expr: string): Expr {
  const hit = cache.get(expr)
  if (hit) return hit
  const s = expr.trim()
  let m: RegExpExecArray | null
  let out: Expr
  if ((m = new RegExp(`^${PATH}\\s+is\\s+(null|empty)$`).exec(s))) {
    out = { op: m[2] === 'null' ? 'is null' : 'is empty', path: m[1] }
  } else if ((m = new RegExp(`^${PATH}\\s*(==|!=)\\s*(.+)$`).exec(s))) {
    out = { op: m[2] as '==' | '!=', path: m[1], value: parseLiteral(m[3]) }
  } else if ((m = new RegExp(`^${PATH}\\s+in\\s+\\[(.*)\\]$`).exec(s))) {
    const values = m[2].trim() ? m[2].split(',').map(parseLiteral) : []
    out = { op: 'in', path: m[1], values }
  } else if ((m = new RegExp(`^${PATH}\\s+includes\\s+(.+)$`).exec(s))) {
    out = { op: 'includes', path: m[1], value: parseLiteral(m[2]) }
  } else {
    throw new Error(`show_if: cannot parse "${expr}"`)
  }
  cache.set(expr, out)
  return out
}

function resolve(path: string, ctx: SurveyContext, answers: Answers): unknown {
  if (path.startsWith('profile.')) {
    const field = path.slice('profile.'.length) as ProfileField
    if (!(PROFILE_FIELDS as readonly string[]).includes(field)) throw new Error(`show_if: unknown profile field ${field}`)
    // Only "is it missing" is ever needed; the value itself never leaves the profile.
    return ctx.profile_missing.includes(field) ? null : 'on_file'
  }
  // Known from the invitation, else whatever the respondent answered.
  if (path === 'adult_relationship') return ctx.adult_relationship ?? answers.adult_relationship ?? null
  if (path in ctx && path !== 'profile_missing') return (ctx as unknown as Record<string, unknown>)[path]
  return answers[path] ?? null
}

export function evaluateShowIf(expr: string, ctx: SurveyContext, answers: Answers): boolean {
  const e = parseShowIf(expr)
  const v = resolve(e.path, ctx, answers)
  switch (e.op) {
    case '==':
      return v === e.value
    case '!=':
      return v !== e.value
    case 'is null':
      return v === null || v === undefined
    case 'is empty':
      return v === null || v === undefined || (Array.isArray(v) && v.length === 0) || v === ''
    case 'in':
      return e.values.includes(v as Literal)
    case 'includes':
      return Array.isArray(v) && v.includes(e.value as string)
  }
}

export function isQuestionVisible(q: Question, ctx: SurveyContext, answers: Answers): boolean {
  // The invitation already says how this adult was involved.
  if (q.skipIfKnownFrom && q.key === 'adult_relationship' && ctx.adult_relationship) return false
  return q.showIf ? evaluateShowIf(q.showIf, ctx, answers) : true
}

export interface VisiblePage {
  id: string
  questions: Question[]
}

/**
 * Pages in order with only their visible questions; empty pages are dropped.
 * Evaluated in order, and only answers to questions that are themselves
 * visible count — so an answer left on a branch the respondent backed out of
 * cannot reveal that branch's follow-ups (interests_parent → price band).
 */
export function visiblePages(def: SurveyDefinition, ctx: SurveyContext, answers: Answers): VisiblePage[] {
  const live: Answers = {}
  const pages: VisiblePage[] = []
  for (const p of def.branches[ctx.role] as Page[]) {
    const questions: Question[] = []
    for (const q of p.questions) {
      if (!isQuestionVisible(q, ctx, live)) continue
      questions.push(q)
      if (q.key in answers) live[q.key] = answers[q.key]
    }
    if (questions.length) pages.push({ id: p.id, questions })
  }
  return pages
}

export function visibleQuestions(def: SurveyDefinition, ctx: SurveyContext, answers: Answers): Question[] {
  return visiblePages(def, ctx, answers).flatMap((p) => p.questions)
}

/** Interpolate {event_title} and friends into intro copy. */
export function fillTemplate(text: string, ctx: Pick<SurveyContext, 'event_title' | 'first_name'>): string {
  return text.replace(/\{(event_title|first_name)\}/g, (_, k: 'event_title' | 'first_name') => ctx[k] ?? '')
}
