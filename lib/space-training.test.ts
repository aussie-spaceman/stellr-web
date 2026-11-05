import { describe, it, expect } from 'vitest'
import { coursesForSpace } from './space-training'

const summary = { id: 'm1', title: 'Linked', description: null, itemCount: 4, completedCount: 1 }
const assignment = {
  moduleId: 'm2',
  title: 'Mentoring',
  description: null,
  itemCount: 6,
  completedCount: 0,
  objectRef: 'nevada',
  eventSlug: 'nevada',
  objectLabel: 'Nevada',
  requirement: 'optional',
  dueAt: null,
}
const link = { training_module_id: 'm1', is_mandatory: false, bracket_requirements: null }
const base = { links: [], summaries: [], assigned: [], refs: ['nevada'], bracket: null }

describe('coursesForSpace', () => {
  it('shows a course assigned to the event the Space belongs to', () => {
    const [card] = coursesForSpace({ ...base, assigned: [assignment] })
    expect(card).toMatchObject({ id: 'm2', total: 6, done: 0, mandatory: false, assignedVia: 'Nevada' })
  })

  it('leaves out a course assigned to some other event', () => {
    expect(coursesForSpace({ ...base, assigned: [{ ...assignment, objectRef: 'colorado', eventSlug: 'colorado' }] })).toEqual([])
  })

  it('matches a legacy assignment keyed by the event id through its slug', () => {
    const cards = coursesForSpace({ ...base, assigned: [{ ...assignment, objectRef: 'sanity-id', eventSlug: 'nevada' }] })
    expect(cards.map((c) => c.id)).toEqual(['m2'])
  })

  it('matches a container assignment, which has no event slug', () => {
    const cards = coursesForSpace({ ...base, refs: ['cohort-1'], assigned: [{ ...assignment, objectRef: 'cohort-1', eventSlug: null }] })
    expect(cards.map((c) => c.id)).toEqual(['m2'])
  })

  it('lists directly linked courses first', () => {
    const cards = coursesForSpace({ ...base, links: [link], summaries: [summary], assigned: [assignment] })
    expect(cards.map((c) => c.id)).toEqual(['m1', 'm2'])
    expect(cards[0].assignedVia).toBeNull()
  })

  it('leaves out a linked course that is not published', () => {
    expect(coursesForSpace({ ...base, links: [link] })).toEqual([])
  })

  it('shows a course reached both ways once, and mandatory if either says so', () => {
    const cards = coursesForSpace({
      ...base,
      links: [link],
      summaries: [summary],
      assigned: [{ ...assignment, moduleId: 'm1', requirement: 'mandatory', dueAt: '2026-11-06' }],
    })
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ mandatory: true, dueAt: '2026-11-06' })
  })

  it('shows no deadline on an optional assignment', () => {
    const [card] = coursesForSpace({ ...base, assigned: [{ ...assignment, dueAt: '2026-11-06' }] })
    expect(card.dueAt).toBeNull()
  })

  it('applies the member bracket to a directly linked course', () => {
    const [card] = coursesForSpace({
      ...base,
      bracket: 'adult',
      summaries: [summary],
      links: [{ ...link, bracket_requirements: { adult: { mandatory: true, due_at: '2026-12-01' } } }],
    })
    expect(card).toMatchObject({ mandatory: true, dueAt: '2026-12-01' })
  })
})
