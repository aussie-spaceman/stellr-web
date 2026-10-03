import { describe, expect, it } from 'vitest'
import { computeStats, nps } from './analytics'
import { longCsv, wideCsv, type LongRow } from './export'

function row(response: string, key: string, v: Partial<LongRow>, base: Partial<LongRow> = {}): LongRow {
  return {
    response_id: response,
    question_key: key,
    value_text: null,
    value_numeric: null,
    value_options: null,
    event_slug: 'co-2026',
    event_year: 2026,
    respondent_role: 'student',
    source: 'app',
    submitted_at: '2026-10-11T00:00:00Z',
    submitted_from: 'email',
    is_minor_at_submit: true,
    adult_relationship: null,
    first_time: true,
    survey_key: 'post_event',
    survey_version: 1,
    participant_id: null,
    member_id: null,
    profile_gender: 'female',
    profile_grade: 'grade_10',
    school_name: 'X',
    school_state: 'CO',
    school_id: null,
    participant_ethnicity: null,
    ...base,
    ...v,
  }
}

describe('nps', () => {
  it('is % promoters minus % detractors', () => {
    expect(nps([10, 9, 8, 7, 6, 0])).toEqual({ score: 0, promoters: 2, passives: 2, detractors: 2, n: 6 })
    expect(nps([]).score).toBeNull()
  })
})

describe('computeStats', () => {
  const rows: LongRow[] = [
    row('a', 'stem_intent_before', { value_text: 'Not sure', value_numeric: 3 }),
    row('a', 'stem_intent_after', { value_text: 'Very likely', value_numeric: 5 }),
    row('a', 'first_stem_pro', { value_text: 'Yes' }),
    row('a', 'first_gen', { value_text: 'Yes' }),
    row('a', 'nps', { value_numeric: 10 }),
    row('a', 'interests', { value_options: ['int_mentoring', 'int_merch'] }),
    row('b', 'stem_intent_before', { value_text: 'Likely', value_numeric: 4 }, { submitted_from: 'dashboard', profile_gender: 'male' }),
    row('b', 'stem_intent_after', { value_text: 'Likely', value_numeric: 4 }, { submitted_from: 'dashboard', profile_gender: 'male' }),
    row('b', 'first_stem_pro', { value_text: 'Not sure' }, { submitted_from: 'dashboard', profile_gender: 'male' }),
    row('b', 'first_gen', { value_text: 'Prefer not to say' }, { submitted_from: 'dashboard', profile_gender: 'male' }),
    row('b', 'nps', { value_numeric: 6 }, { submitted_from: 'dashboard', profile_gender: 'male' }),
    row('m', 'hours_prep', { value_numeric: 4 }, { respondent_role: 'mentor', is_minor_at_submit: false }),
    row('m', 'hours_event', { value_numeric: 8 }, { respondent_role: 'mentor', is_minor_at_submit: false }),
    row('m', 'nps', { value_numeric: 9 }, { respondent_role: 'mentor' }),
    row('p', 'mentoring_price_band', { value_text: 'Under $25' }, { respondent_role: 'adult' }),
    row('L', 'legacy_2024.overall', { value_text: 'Great' }, { source: 'legacy_import' }),
  ]
  const s = computeStats(rows, [
    { event_slug: 'co-2026', respondent_role: 'student', invited: 4, submitted: 2 },
    { event_slug: 'co-2026', respondent_role: 'mentor', invited: 2, submitted: 1 },
  ])

  it('counts app responses only', () => {
    expect(s.responses.total).toBe(4)
    expect(s.responses.byRole).toEqual({ student: 2, mentor: 1, adult: 1 })
  })

  it('measures STEM intent change on paired answers', () => {
    expect(s.stemIntent).toEqual({ rose: { n: 1, of: 2, pct: 50 }, meanShift: 1, pairs: 2 })
  })

  it('counts first contact with a STEM professional over Yes/No answers', () => {
    expect(s.firstStemPro).toEqual({ n: 1, of: 1, pct: 100 })
  })

  it('reports NPS by role, first-gen excluding "prefer not", mentor hours and interests', () => {
    expect(s.nps.byRole.student.score).toBe(0)
    expect(s.nps.byRole.mentor.score).toBe(100)
    expect(s.firstGen.overall).toEqual({ n: 1, of: 1, pct: 100 })
    expect(s.firstGen.byGender.Female).toEqual({ n: 1, of: 1, pct: 100 })
    expect(s.mentorHours.byEvent['co-2026']).toEqual({ prep: 4, event: 8, total: 12, mentors: 1 })
    expect(s.interests.interests).toEqual({ int_mentoring: 1, int_merch: 1 })
    expect(s.priceBand).toEqual({ 'Under $25': 1 })
  })

  it('reports response rate and dashboard share (app adoption)', () => {
    expect(s.responseRate.overall).toEqual({ n: 3, of: 6, pct: 50 })
    expect(s.responses.viaDashboard).toEqual({ n: 1, of: 4, pct: 25 })
  })
})

describe('csv exports', () => {
  const rows = [
    row('a', 'overall_rating', { value_text: 'Excellent', value_numeric: 5 }),
    row('a', 'highlight', { value_text: '=HYPERLINK("x")' }),
    row('b', 'overall_rating', { value_text: 'Good', value_numeric: 3 }),
  ]
  it('long: one line per answer, formula-safe', () => {
    const csv = longCsv(rows).split('\n')
    expect(csv).toHaveLength(4)
    expect(csv[2]).toContain(`"'=HYPERLINK(""x"")"`)
  })
  it('wide: one line per response, scores beside labels', () => {
    const csv = wideCsv(rows).split('\n')
    expect(csv).toHaveLength(3)
    expect(csv[0]).toContain('overall_rating,overall_rating__score')
  })
})
