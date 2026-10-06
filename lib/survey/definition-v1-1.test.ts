import { describe, expect, it } from 'vitest'
import v1raw from './definitions/post_event.v1.json'
import v11raw from './definitions/post_event.v1.1.json'
import { catalogEntries, normaliseDefinition, questionsFor, ROLES, versionName } from './definition'
import { parseShowIf } from './branching'

// post_event v1.1 (David, 6 Oct 2026): Finals wording, an N/A on adults'
// registration ease, and an explicit quote question for mentors and adults.
// Everything else must match v1 so answers compare across versions.
const v1 = normaliseDefinition(v1raw)
const v11 = normaliseDefinition(v11raw)
const find = (role: (typeof ROLES)[number], key: string) => questionsFor(v11, role).find((q) => q.key === key)

describe('post_event v1.1', () => {
  it('is stored as version 2 and named v1.1', () => {
    expect(v11.key).toBe('post_event')
    expect(v11.version).toBe(2)
    expect(versionName(v11.version, v11.versionLabel)).toBe('v1.1')
    expect(versionName(v1.version, v1.versionLabel)).toBe('v1')
  })

  it('keeps every v1 answer key, so answers compare across versions', () => {
    const keys11 = new Set(catalogEntries(v11).map((e) => e.question_key))
    for (const e of catalogEntries(v1)) expect(keys11.has(e.question_key)).toBe(true)
    expect([...keys11].filter((k) => !catalogEntries(v1).some((e) => e.question_key === k))).toEqual(['testimonial'])
  })

  it('renames the Finals option for students, parents and teachers without changing its key', () => {
    const finals = [find('student', 'interests'), find('adult', 'interests_parent'), find('adult', 'interests_teacher')]
    for (const q of finals) {
      const opt = q?.options?.find((o) => o.key === 'int_houston_2027')
      expect(opt?.label).toBe('Attending the Finals event next summer')
    }
    expect(JSON.stringify(v11raw)).not.toMatch(/Houston/)
  })

  it('gives adults an unscored Not applicable on registration ease', () => {
    const q = find('adult', 'registration_ease')!
    expect(q.options?.at(-1)).toEqual({ key: 'Not applicable', label: 'Not applicable', numeric: null })
    expect(q.options?.slice(0, -1)).toEqual(questionsFor(v1, 'adult').find((x) => x.key === 'registration_ease')!.options)
    expect(q.required).toBe(false)
  })

  it('asks mentors and adults for a quote explicitly, and not students', () => {
    for (const role of ['mentor', 'adult'] as const) {
      const consent = v11.branches[role].find((p) => p.id === 'consent')!
      expect(consent.questions.map((q) => q.key)).toEqual(['testimonial', 'quote_consent'])
      const t = consent.questions[0]
      expect(t).toMatchObject({ type: 'text_long', required: false, quotable: true, labelTag: 'may be quoted' })
    }
    expect(find('student', 'testimonial')).toBeUndefined()
  })

  it('changes nothing else', () => {
    const strip = (def: typeof v1) =>
      Object.fromEntries(
        ROLES.map((r) => [
          r,
          def.branches[r].map((p) => ({
            id: p.id,
            questions: p.questions
              .filter((q) => q.key !== 'testimonial')
              .map((q) => ({
                ...q,
                options: q.options?.filter((o) => o.key !== 'Not applicable' || q.key !== 'registration_ease').map((o) => (o.key === 'int_houston_2027' ? { ...o, label: '' } : o)),
              })),
          })),
        ]),
      )
    expect(strip(v11)).toEqual(strip(v1))
    expect(v11.intro).toEqual(v1.intro)
  })

  it('parses every show_if', () => {
    for (const r of ROLES) for (const q of questionsFor(v11, r)) if (q.showIf) expect(() => parseShowIf(q.showIf!)).not.toThrow()
  })
})
