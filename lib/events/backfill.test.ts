// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { planMirrorBackfill } from './backfill'
import { toEventRow, type SanityEventDoc } from './sync'

const NOW = new Date('2026-11-04T12:00:00Z')
const doc = (id: string, slug: string, extra: Partial<SanityEventDoc> = {}): SanityEventDoc => ({
  _id: id,
  _updatedAt: '2026-11-01T00:00:00Z',
  title: slug,
  slug,
  date: '2026-11-06',
  state: 'NV',
  ...extra,
})

describe('planMirrorBackfill', () => {
  it('inserts new events, updates changed ones and leaves identical ones alone', () => {
    const a = doc('a', 'event-a')
    const b = doc('b', 'event-b')
    const c = doc('c', 'event-c')
    const existingB = { ...toEventRow(b, undefined, NOW)!, title: 'Old title' }
    // Postgres hands timestamps back in its own format; the same instant is not a change.
    const existingC = { ...toEventRow(c, undefined, NOW)!, starts_at: '2026-11-06 08:00:00+00' }
    const plan = planMirrorBackfill([a, b, c], [existingB, existingC], undefined, NOW)
    expect(plan.insert.map((r) => r.slug)).toEqual(['event-a'])
    expect(plan.update.map((r) => r.slug)).toEqual(['event-b'])
    expect(plan.unchanged).toEqual(['event-c'])
    expect(plan.invalid).toEqual([])
    expect(plan.conflicts).toEqual([])
  })

  it('treats a renamed slug as an update of the same event', () => {
    const existing = toEventRow(doc('a', 'old-slug'), undefined, NOW)!
    const plan = planMirrorBackfill([doc('a', 'new-slug')], [existing], undefined, NOW)
    expect(plan.update.map((r) => r.slug)).toEqual(['new-slug'])
  })

  it('reports drafts and slugless documents as invalid', () => {
    const plan = planMirrorBackfill([doc('drafts.a', 'x'), doc('b', '', { slug: null })], [], undefined, NOW)
    expect(plan.invalid).toEqual(['drafts.a', 'b'])
    expect(plan.insert).toEqual([])
  })

  it('holds back every event that shares a slug, in the batch or with the mirror', () => {
    const plan = planMirrorBackfill(
      [doc('a', 'dup'), doc('b', 'dup'), doc('c', 'taken'), doc('d', 'fine')],
      [{ sanity_id: 'z', slug: 'taken' }],
      undefined,
      NOW,
    )
    expect(plan.conflicts).toEqual([
      { slug: 'dup', sanityIds: ['a', 'b'] },
      { slug: 'taken', sanityIds: ['c', 'z'] },
    ])
    expect(plan.insert.map((r) => r.slug)).toEqual(['fine'])
  })
})
