import { describe, expect, it } from 'vitest'
import raw from './definitions/post_event.v1.json'
import { catalogEntries, definitionSha256, normaliseDefinition, questionsFor, ROLES } from './definition'
import { evaluateShowIf, parseShowIf, visiblePages, visibleQuestions, type SurveyContext } from './branching'
import { flattenAnswers, missingRequired, sanitiseDraft } from './answers'

const def = normaliseDefinition(raw)

function ctx(over: Partial<SurveyContext> = {}): SurveyContext {
  return {
    role: 'student',
    first_time: false,
    is_minor: true,
    quote_eligible_by_agreement: true,
    adult_relationship: null,
    profile_missing: [],
    event_title: 'Colorado SDC',
    event_slug: 'colorado-sdc-2026',
    event_year: 2026,
    first_name: 'Jordan',
    ...over,
  }
}

describe('definition', () => {
  it('normalises every branch and resolves shared refs', () => {
    for (const role of ROLES) expect(def.branches[role].length).toBeGreaterThan(3)
    const mentorLog = questionsFor(def, 'mentor').find((q) => q.key === 'logistics')
    expect(mentorLog?.rows?.map((r) => r.key)).toContain('log_judging_tools')
    const studentLog = questionsFor(def, 'student').find((q) => q.key === 'logistics')
    expect(studentLog?.rows?.map((r) => r.key)).not.toContain('log_judging_tools')
  })

  it('every show_if parses', () => {
    for (const role of ROLES) for (const q of questionsFor(def, role)) if (q.showIf) expect(() => parseShowIf(q.showIf!)).not.toThrow()
  })

  it('scores scales high = positive, with N/A and extras unscored', () => {
    const overall = questionsFor(def, 'student').find((q) => q.key === 'overall_rating')!
    expect(overall.options!.map((o) => o.numeric)).toEqual([1, 2, 3, 4, 5])
    const ret = questionsFor(def, 'student').find((q) => q.key === 'return_intent')!
    expect(ret.options!.find((o) => o.key === 'Definitely')!.numeric).toBe(5)
    expect(ret.options!.find((o) => o.key === 'Definitely not')!.numeric).toBe(1)
    expect(ret.options!.find((o) => o.key.startsWith("I'm graduating"))!.numeric).toBeNull()
    const log = questionsFor(def, 'student').find((q) => q.key === 'logistics')!
    expect(log.options!.find((o) => o.key === 'Not applicable')!.numeric).toBeNull()
    expect(log.options!.find((o) => o.key === 'Excellent')!.numeric).toBe(4)
  })

  it('marks the highlight question quotable', () => {
    const h = questionsFor(def, 'student').find((q) => q.key === 'highlight')!
    expect(h.quotable).toBe(true)
    expect(h.labelTag).toBe('may be quoted')
  })

  it('hashes stably regardless of key order', () => {
    expect(definitionSha256({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(definitionSha256({ b: [1, { d: 3, c: 2 }], a: 1 }))
  })

  it('catalogs grid rows as their own keys, once each', () => {
    const keys = catalogEntries(def).map((e) => e.question_key)
    expect(keys).toContain('skill_teamwork')
    expect(keys).toContain('log_venue')
    expect(keys).not.toContain('skills')
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('branching', () => {
  it('shows "how did you hear" only to first-timers', () => {
    const keys = (c: SurveyContext) => visibleQuestions(def, c, {}).map((q) => q.key)
    expect(keys(ctx({ first_time: true }))).toContain('heard_about')
    expect(keys(ctx({ first_time: false }))).not.toContain('heard_about')
  })

  it('asks demographics only when missing from the profile', () => {
    const keys = visibleQuestions(def, ctx({ profile_missing: ['gender', 'school'] }), {}).map((q) => q.key)
    expect(keys).toContain('demo_gender')
    expect(keys).toContain('demo_school')
    expect(keys).not.toContain('demo_grade')
    expect(keys).not.toContain('demo_ethnicity')
  })

  it('minors under V2.3 get "Don\'t quote", adult students get the explicit question', () => {
    const minor = visibleQuestions(def, ctx(), {}).map((q) => q.key)
    expect(minor).toContain('no_quote_this_response')
    expect(minor).not.toContain('quote_consent')
    const adultStudent = visibleQuestions(def, ctx({ is_minor: false, quote_eligible_by_agreement: false }), {}).map((q) => q.key)
    expect(adultStudent).toContain('quote_consent')
    expect(adultStudent).not.toContain('no_quote_this_response')
    const optedOutMinor = visibleQuestions(def, ctx({ quote_eligible_by_agreement: false }), {}).map((q) => q.key)
    expect(optedOutMinor).not.toContain('no_quote_this_response')
    expect(optedOutMinor).not.toContain('quote_consent')
  })

  it('skips the relationship question when the invitation knows it', () => {
    const keys = (c: SurveyContext) => visibleQuestions(def, c, {}).map((q) => q.key)
    expect(keys(ctx({ role: 'adult', adult_relationship: 'teacher' }))).not.toContain('adult_relationship')
    expect(keys(ctx({ role: 'adult', adult_relationship: null }))).toContain('adult_relationship')
  })

  it('branches adult interests on relationship, and price band on mentoring interest', () => {
    const c = ctx({ role: 'adult', adult_relationship: null })
    const keys = (a: Record<string, unknown>) => visibleQuestions(def, c, a as never).map((q) => q.key)
    expect(keys({ adult_relationship: 'teacher' })).toContain('interests_teacher')
    expect(keys({ adult_relationship: 'teacher' })).not.toContain('interests_parent')
    expect(keys({ adult_relationship: 'other' })).toContain('interests_parent')
    expect(keys({ adult_relationship: 'parent', interests_parent: ['int_workshops'] })).not.toContain('mentoring_price_band')
    expect(keys({ adult_relationship: 'parent', interests_parent: ['int_mentoring'] })).toContain('mentoring_price_band')
    // A teacher known from the invitation sees the teacher list without being asked.
    expect(visibleQuestions(def, ctx({ role: 'adult', adult_relationship: 'teacher' }), {}).map((q) => q.key)).toContain('interests_teacher')
  })

  it('drops pages with nothing to show', () => {
    const pages = visiblePages(def, ctx({ first_time: false, profile_missing: [] }), {}).map((p) => p.id)
    // about_you still has first_gen
    expect(pages).toContain('about_you')
    expect(pages[0]).toBe('experience')
  })

  it('rejects anything outside the grammar', () => {
    expect(() => parseShowIf('process.exit(1)')).toThrow()
    expect(() => parseShowIf("a == b")).toThrow()
    expect(evaluateShowIf("x in ['a','b']", ctx(), { x: 'b' })).toBe(true)
    expect(evaluateShowIf('x != null', ctx(), { x: 'b' })).toBe(true)
  })
})

describe('answers', () => {
  const c = ctx()

  it('accepts well-formed drafts and drops empties', () => {
    const r = sanitiseDraft(def, c, {
      overall_rating: 'Excellent',
      nps: 9,
      skills: { skill_teamwork: 'A great deal' },
      interests: ['int_mentoring', 'int_merch'],
      highlight: '  Launching the rover  ',
      improve: '   ',
      no_quote_this_response: false,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.answers.highlight).toBe('Launching the rover')
      expect(r.answers).not.toHaveProperty('improve')
    }
  })

  it('rejects unknown keys, bad options, out-of-range numbers and exclusive combos', () => {
    const r = sanitiseDraft(def, c, {
      bogus: 1,
      overall_rating: 'Stellar',
      nps: 11,
      interests: ['int_none', 'int_merch'],
      highlight: 'x'.repeat(601),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['bogus', 'highlight', 'interests', 'nps', 'overall_rating'])
  })

  it('rejects a question from another branch', () => {
    const r = sanitiseDraft(def, c, { hours_prep: 3 })
    expect(r.ok).toBe(false)
  })

  it('requires the flagged minimum, respecting visibility', () => {
    expect(Object.keys(missingRequired(def, c, {})).sort()).toEqual(['nps', 'overall_rating', 'stem_intent_after', 'stem_intent_before'])
    const mentor = ctx({ role: 'mentor', is_minor: false, quote_eligible_by_agreement: false })
    expect(missingRequired(def, mentor, {})).toHaveProperty('quote_consent')
    // A teacher known from the invitation is never asked the required relationship question.
    expect(missingRequired(def, ctx({ role: 'adult', adult_relationship: 'teacher' }), {})).not.toHaveProperty('adult_relationship')
  })

  it('flattens grids to one row per item, scales with scores, drops hidden answers', () => {
    const adult = ctx({ role: 'adult', adult_relationship: null, is_minor: false })
    const f = flattenAnswers(def, adult, {
      adult_relationship: 'teacher',
      overall_rating: 'Very good',
      nps: 10,
      logistics: { log_venue: 'Excellent', log_food: 'Not applicable' },
      interests_parent: ['int_mentoring'], // hidden for a teacher
      mentoring_price_band: 'Under $25', // hidden
      quote_consent: 'anonymous',
    })
    const byKey = Object.fromEntries(f.rows.map((r) => [r.question_key, r]))
    expect(byKey.overall_rating.value_numeric).toBe(4)
    expect(byKey.nps.value_numeric).toBe(10)
    expect(byKey.log_venue).toMatchObject({ value_text: 'Excellent', value_numeric: 4 })
    expect(byKey.log_food).toMatchObject({ value_text: 'Not applicable', value_numeric: null })
    expect(byKey).not.toHaveProperty('interests_parent')
    expect(byKey).not.toHaveProperty('mentoring_price_band')
    expect(f.quoteConsent).toBe('anonymous')
  })

  it('records a known relationship as an answer', () => {
    const f = flattenAnswers(def, ctx({ role: 'adult', adult_relationship: 'parent', is_minor: false }), { overall_rating: 'Good', nps: 7, quote_consent: 'no' })
    expect(f.rows.find((r) => r.question_key === 'adult_relationship')?.value_text).toBe('parent')
  })

  it('derives the consent columns for a minor', () => {
    const f = flattenAnswers(def, c, { overall_rating: 'Good', nps: 7, no_quote_this_response: true, followup_consent: true })
    expect(f).toMatchObject({ quoteConsent: null, noQuote: true, followupConsent: true })
  })
})
