/**
 * Survey data out (handover A3): long format (one row per answer, from the
 * survey_answers_long view) or wide (one row per response), filtered by
 * survey, event or year. Admin only; every export is logged
 * (survey_access_log). No names or contact details: respondents are
 * identified by participant/member id for joining, nothing more.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { toCsv } from '@/lib/csv'

export interface ExportFilter {
  eventSlug?: string | null
  year?: number | null
  surveyKey?: string | null
}

export interface LongRow {
  response_id: string
  question_key: string
  value_text: string | null
  value_numeric: number | null
  value_options: string[] | null
  event_slug: string | null
  event_year: number | null
  respondent_role: string | null
  source: string
  submitted_at: string
  submitted_from: string | null
  is_minor_at_submit: boolean | null
  adult_relationship: string | null
  first_time: boolean | null
  survey_key: string
  survey_version: number
  participant_id: string | null
  member_id: string | null
  profile_gender: string | null
  profile_grade: string | null
  school_name: string | null
  school_state: string | null
  school_id: string | null
  participant_ethnicity: string[] | null
}

export async function loadLongRows(db: SupabaseClient, f: ExportFilter): Promise<LongRow[]> {
  const out: LongRow[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    let q = db.from('survey_answers_long').select('*').order('response_id').order('question_key').range(from, from + PAGE - 1)
    if (f.eventSlug) q = q.eq('event_slug', f.eventSlug)
    if (f.year) q = q.eq('event_year', f.year)
    if (f.surveyKey) q = q.eq('survey_key', f.surveyKey)
    const { data, error } = await q
    if (error) throw new Error(`Reading survey answers failed: ${error.message}`)
    out.push(...((data ?? []) as LongRow[]))
    if (!data || data.length < PAGE) break
  }
  return out
}

const RESPONSE_COLUMNS = [
  'response_id',
  'survey_key',
  'survey_version',
  'source',
  'event_slug',
  'event_year',
  'respondent_role',
  'adult_relationship',
  'first_time',
  'is_minor_at_submit',
  'submitted_at',
  'submitted_from',
  'participant_id',
  'member_id',
  'school_id',
  'school_name',
  'school_state',
  'profile_gender',
  'profile_grade',
  'participant_ethnicity',
] as const

const cellOf = (v: unknown) => (Array.isArray(v) ? v.join('; ') : (v as string | number | boolean | null))

export function answerValue(r: Pick<LongRow, 'value_text' | 'value_numeric' | 'value_options'>): string | number | null {
  if (r.value_options) return r.value_options.join('; ')
  if (r.value_text !== null && r.value_numeric !== null && r.value_text !== String(r.value_numeric)) return r.value_text
  return r.value_numeric ?? r.value_text
}

export function longCsv(rows: LongRow[]): string {
  const header = [...RESPONSE_COLUMNS, 'question_key', 'value_text', 'value_numeric', 'value_options']
  return toCsv([
    header,
    ...rows.map((r) => [
      ...RESPONSE_COLUMNS.map((c) => cellOf(r[c])),
      r.question_key,
      r.value_text,
      r.value_numeric,
      r.value_options?.join('; ') ?? null,
    ]),
  ])
}

/**
 * One row per response; a column per question key (sorted), holding the label
 * for choices with the score alongside in a `<key>__score` column where one exists.
 */
export function wideCsv(rows: LongRow[]): string {
  const byResponse = new Map<string, LongRow[]>()
  for (const r of rows) {
    const list = byResponse.get(r.response_id)
    if (list) list.push(r)
    else byResponse.set(r.response_id, [r])
  }
  const keys = [...new Set(rows.map((r) => r.question_key))].sort()
  const scored = new Set(rows.filter((r) => r.value_numeric !== null && r.value_text !== null && r.value_text !== String(r.value_numeric)).map((r) => r.question_key))
  const cols = keys.flatMap((k) => (scored.has(k) ? [k, `${k}__score`] : [k]))
  const out: (string | number | boolean | null)[][] = [[...RESPONSE_COLUMNS, ...cols]]
  for (const [, answers] of byResponse) {
    const first = answers[0]
    const map = new Map(answers.map((a) => [a.question_key, a]))
    out.push([
      ...RESPONSE_COLUMNS.map((c) => cellOf(first[c])),
      ...keys.flatMap((k) => {
        const a = map.get(k)
        const v = a ? (a.value_options ? a.value_options.join('; ') : a.value_text ?? a.value_numeric) : null
        return scored.has(k) ? [v, a?.value_numeric ?? null] : [v]
      }),
    ])
  }
  return toCsv(out)
}

export function exportFilename(kind: 'long' | 'wide' | 'testimonials', f: ExportFilter): string {
  const parts = ['stellr-survey', kind, f.surveyKey, f.eventSlug, f.year ? String(f.year) : null, new Date().toISOString().slice(0, 10)]
  return `${parts.filter(Boolean).join('-')}.csv`
}
