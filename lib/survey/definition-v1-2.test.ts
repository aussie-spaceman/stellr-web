import { describe, expect, it } from 'vitest'
import v11raw from './definitions/post_event.v1.1.json'
import v12raw from './definitions/post_event.v1.2.json'
import { catalogEntries, normaliseDefinition, questionsFor, ROLES } from './definition'

// post_event v1.2 (14 Oct 2026): one wording change — the summer progression
// option — and nothing else, so answers compare across v1, v1.1 and v1.2.
// v1.1 is published and frozen; this is the new version to publish after it.
const v11 = normaliseDefinition(v11raw)
const v12 = normaliseDefinition(v12raw)
const find = (role: (typeof ROLES)[number], key: string) => questionsFor(v12, role).find((q) => q.key === key)

describe('post_event v1.2', () => {
  it('is the next version after v1.1', () => {
    expect(v12raw.version).toBe(v11raw.version + 1)
    expect(v12raw.version_label).toBe('1.2')
  })

  it('relabels the summer progression option without changing its key', () => {
    const questions = [find('student', 'interests'), find('adult', 'interests_parent'), find('adult', 'interests_teacher')]
    for (const q of questions) {
      const opt = q?.options?.find((o) => o.key === 'int_houston_2027')
      expect(opt?.label).toBe('Attending the International Summer Camp next summer')
    }
  })

  it('keeps every v1.1 question and option key', () => {
    expect(catalogEntries(v12).map((e) => e.question_key)).toEqual(catalogEntries(v11).map((e) => e.question_key))
    for (const role of ROLES) {
      const keys = (d: typeof v11) => questionsFor(d, role).map((q) => [q.key, (q.options ?? []).map((o) => o.key)])
      expect(keys(v12)).toEqual(keys(v11))
    }
  })
})
