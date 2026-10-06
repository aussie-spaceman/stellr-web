import { describe, expect, it } from 'vitest'
import raw from './definitions/post_event.v1.json'
import { normaliseDefinition, ROLES } from './definition'
import { answerFormat, branchCounts, describeShowIf, pageTitle } from './describe'

const def = normaliseDefinition(raw)
const all = ROLES.flatMap((r) => def.branches[r].flatMap((p) => p.questions))

describe('question viewer descriptions', () => {
  it('describes every show_if in v1 in plain English', () => {
    const conditional = all.filter((q) => q.showIf)
    expect(conditional.length).toBeGreaterThan(0)
    for (const q of conditional) {
      const text = describeShowIf(q.showIf!, def)
      expect(text).toMatch(/^Shown only if /)
      // No raw operators or snake_case paths leak through.
      expect(text).not.toMatch(/==|!=| in \[| includes |[a-z]+_[a-z]+/)
    }
  })

  it('phrases context facts and profile gaps', () => {
    expect(describeShowIf('first_time == true', def)).toBe('Shown only if it is their first Stellr event')
    expect(describeShowIf('is_minor == false', def)).toBe('Shown only if they are not a minor')
    expect(describeShowIf('profile.gender is null', def)).toBe('Shown only if their profile has no gender on file')
  })

  it('falls back to the expression rather than throwing', () => {
    expect(describeShowIf('this is not valid', def)).toBe('Shown only if this is not valid')
  })

  it('titles every v1 page without underscores', () => {
    for (const r of ROLES) for (const p of def.branches[r]) expect(pageTitle(p.id)).not.toMatch(/_/)
  })

  it('formats NPS and text limits', () => {
    const nps = all.find((q) => q.type === 'nps')!
    expect(answerFormat(nps)).toMatch(/^0 .*to 10/)
    const text = all.find((q) => q.type === 'text_long')!
    expect(answerFormat(text)).toMatch(/^Up to \d+ characters$/)
  })

  it('counts each branch', () => {
    for (const r of ROLES) {
      const c = branchCounts(def, r)
      expect(c.questions).toBeGreaterThan(0)
      expect(c.required).toBeLessThanOrEqual(c.questions)
    }
  })
})
