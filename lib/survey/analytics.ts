/**
 * Headline numbers for fundraising (handover §8), computed from long-format
 * answers (survey_answers_long) plus invitation counts. Pure, so the same
 * rows always give the same numbers and the maths is tested.
 *
 * Title I needs NCES data joined to schools — a follow-up, not computed here.
 */
import type { LongRow } from './export'

export interface InvitationCount {
  event_slug: string
  respondent_role: string
  invited: number
  submitted: number
}

export interface Pct {
  n: number
  of: number
  pct: number | null
}

const pct = (n: number, of: number): Pct => ({ n, of, pct: of ? Math.round((n / of) * 1000) / 10 : null })

export interface Nps {
  score: number | null
  promoters: number
  passives: number
  detractors: number
  n: number
}

export function nps(scores: number[]): Nps {
  const promoters = scores.filter((s) => s >= 9).length
  const detractors = scores.filter((s) => s <= 6).length
  const n = scores.length
  return { score: n ? Math.round(((promoters - detractors) / n) * 100) : null, promoters, passives: n - promoters - detractors, detractors, n }
}

export interface SurveyStats {
  responses: { total: number; byRole: Record<string, number>; viaDashboard: Pct }
  responseRate: { overall: Pct; byEventRole: { event_slug: string; role: string; rate: Pct }[] }
  stemIntent: { rose: Pct; meanShift: number | null; pairs: number }
  firstStemPro: Pct
  nps: { byRole: Record<string, Nps>; byEvent: Record<string, Nps> }
  firstGen: { overall: Pct; byGender: Record<string, Pct>; byEthnicity: Record<string, Pct> }
  mentorHours: { byEvent: Record<string, { prep: number; event: number; total: number; mentors: number }> }
  interests: Record<string, Record<string, number>>
  priceBand: Record<string, number>
}

type ByResponse = Map<string, { first: LongRow; answers: Map<string, LongRow> }>

function group(rows: LongRow[]): ByResponse {
  const out: ByResponse = new Map()
  for (const r of rows) {
    let g = out.get(r.response_id)
    if (!g) {
      g = { first: r, answers: new Map() }
      out.set(r.response_id, g)
    }
    g.answers.set(r.question_key, r)
  }
  return out
}

const GENDER_LABEL: Record<string, string> = { male: 'Male', female: 'Female', other: 'Another gender', prefer_not_to_say: 'Prefer not to say' }

export function computeStats(rows: LongRow[], invitations: InvitationCount[] = []): SurveyStats {
  const responses = group(rows.filter((r) => r.source === 'app'))
  const all = [...responses.values()]

  const byRole: Record<string, number> = {}
  let viaDashboard = 0
  for (const r of all) {
    const role = r.first.respondent_role ?? 'unknown'
    byRole[role] = (byRole[role] ?? 0) + 1
    if (r.first.submitted_from === 'dashboard') viaDashboard++
  }

  // STEM intent: paired before/after on the 1–5 likelihood scale.
  let rose = 0
  let pairs = 0
  let shift = 0
  let firstPro = 0
  let firstProOf = 0
  const npsRole: Record<string, number[]> = {}
  const npsEvent: Record<string, number[]> = {}
  let fg = 0
  let fgOf = 0
  const fgGender: Record<string, [number, number]> = {}
  const fgEth: Record<string, [number, number]> = {}
  const hours: SurveyStats['mentorHours']['byEvent'] = {}
  const interests: Record<string, Record<string, number>> = {}
  const priceBand: Record<string, number> = {}

  for (const { first, answers } of all) {
    const role = first.respondent_role ?? 'unknown'
    const event = first.event_slug ?? 'unknown'
    const get = (k: string) => answers.get(k)

    const npsRow = get('nps')
    if (npsRow?.value_numeric !== null && npsRow?.value_numeric !== undefined) {
      ;(npsRole[role] ??= []).push(Number(npsRow.value_numeric))
      ;(npsEvent[event] ??= []).push(Number(npsRow.value_numeric))
    }

    if (role === 'student') {
      const b = get('stem_intent_before')?.value_numeric
      const a = get('stem_intent_after')?.value_numeric
      if (b != null && a != null) {
        pairs++
        shift += Number(a) - Number(b)
        if (Number(a) > Number(b)) rose++
      }
      const p = get('first_stem_pro')?.value_text
      if (p === 'Yes' || p === 'No') {
        firstProOf++
        if (p === 'Yes') firstPro++
      }
      const g = get('first_gen')?.value_text
      if (g === 'Yes' || g === 'No' || g === 'Not sure') {
        fgOf++
        const yes = g === 'Yes' ? 1 : 0
        fg += yes
        const genderKey = get('demo_gender')?.value_text || first.profile_gender || 'Not recorded'
        const gl = GENDER_LABEL[genderKey] ?? genderKey
        const gs = (fgGender[gl] ??= [0, 0])
        gs[0] += yes
        gs[1]++
        const eth = get('demo_ethnicity')?.value_options ?? first.participant_ethnicity ?? []
        for (const e of eth.length ? eth : ['Not recorded']) {
          const es = (fgEth[e] ??= [0, 0])
          es[0] += yes
          es[1]++
        }
      }
    }

    if (role === 'mentor') {
      const prep = Number(get('hours_prep')?.value_numeric ?? 0)
      const ev = Number(get('hours_event')?.value_numeric ?? 0)
      const h = (hours[event] ??= { prep: 0, event: 0, total: 0, mentors: 0 })
      h.prep += prep
      h.event += ev
      h.total += prep + ev
      if (get('hours_prep') || get('hours_event')) h.mentors++
    }

    for (const key of ['interests', 'interests_parent', 'interests_teacher', 'employer_support']) {
      for (const opt of get(key)?.value_options ?? []) {
        const bucket = (interests[key] ??= {})
        bucket[opt] = (bucket[opt] ?? 0) + 1
      }
    }
    const rm = get('recurring_mentoring')?.value_text
    if (rm) {
      const bucket = (interests.recurring_mentoring ??= {})
      bucket[rm] = (bucket[rm] ?? 0) + 1
    }
    const band = get('mentoring_price_band')?.value_text
    if (band) priceBand[band] = (priceBand[band] ?? 0) + 1
  }

  const invited = invitations.reduce((s, i) => s + i.invited, 0)
  const submitted = invitations.reduce((s, i) => s + i.submitted, 0)

  return {
    responses: { total: all.length, byRole, viaDashboard: pct(viaDashboard, all.length) },
    responseRate: {
      overall: pct(submitted, invited),
      byEventRole: invitations.map((i) => ({ event_slug: i.event_slug, role: i.respondent_role, rate: pct(i.submitted, i.invited) })),
    },
    stemIntent: { rose: pct(rose, pairs), meanShift: pairs ? Math.round((shift / pairs) * 100) / 100 : null, pairs },
    firstStemPro: pct(firstPro, firstProOf),
    nps: {
      byRole: Object.fromEntries(Object.entries(npsRole).map(([k, v]) => [k, nps(v)])),
      byEvent: Object.fromEntries(Object.entries(npsEvent).map(([k, v]) => [k, nps(v)])),
    },
    firstGen: {
      overall: pct(fg, fgOf),
      byGender: Object.fromEntries(Object.entries(fgGender).map(([k, [n, of]]) => [k, pct(n, of)])),
      byEthnicity: Object.fromEntries(Object.entries(fgEth).map(([k, [n, of]]) => [k, pct(n, of)])),
    },
    mentorHours: { byEvent: hours },
    interests,
    priceBand,
  }
}
