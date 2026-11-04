import { describe, it, expect } from 'vitest'
import { UNSECTIONED, buildLayout, canStep, layoutMoves, moveLesson, stepLesson } from './training-curriculum'

const layout = () => ({ a: ['1', '2', '3'], b: ['4'], c: [] as string[], [UNSECTIONED]: [] as string[] })
const KEYS = ['a', 'b', 'c']

describe('buildLayout', () => {
  it('sorts by display order and groups by section', () => {
    const l = buildLayout(
      [
        { id: 'x', section_id: 'a', display_order: 2 },
        { id: 'y', section_id: 'a', display_order: 1 },
        { id: 'z', section_id: null, display_order: 0 },
      ],
      ['a', 'b'],
    )
    expect(l).toEqual({ a: ['y', 'x'], b: [], [UNSECTIONED]: ['z'] })
  })

  it('keeps a lesson whose section no longer exists visible, unsectioned', () => {
    const l = buildLayout([{ id: 'x', section_id: 'gone', display_order: 0 }], ['a'])
    expect(l[UNSECTIONED]).toEqual(['x'])
  })
})

describe('moveLesson', () => {
  it('reorders within a section, reading the index with the lesson lifted out', () => {
    expect(moveLesson(layout(), '1', 'a', 2).a).toEqual(['2', '3', '1'])
    expect(moveLesson(layout(), '3', 'a', 0).a).toEqual(['3', '1', '2'])
  })

  it('moves across sections, including into an empty one', () => {
    const next = moveLesson(layout(), '2', 'b', 0)
    expect(next.a).toEqual(['1', '3'])
    expect(next.b).toEqual(['2', '4'])
    expect(moveLesson(layout(), '4', 'c', 0).c).toEqual(['4'])
  })

  it('returns the same object when nothing moves, so nothing is saved', () => {
    const l = layout()
    expect(moveLesson(l, '2', 'a', 1)).toBe(l)
    expect(moveLesson(l, 'nope', 'a', 0)).toBe(l)
    expect(moveLesson(l, '1', 'nope', 0)).toBe(l)
  })

  it('clamps an index past the end', () => {
    expect(moveLesson(layout(), '1', 'b', 99).b).toEqual(['4', '1'])
  })
})

describe('stepLesson (the non-drag way to move)', () => {
  it('moves one place within a section', () => {
    expect(stepLesson(layout(), '2', -1, KEYS).a).toEqual(['2', '1', '3'])
  })

  it('crosses into the neighbouring section at an edge', () => {
    expect(stepLesson(layout(), '3', 1, KEYS).b).toEqual(['3', '4'])
    expect(stepLesson(layout(), '4', -1, KEYS).a).toEqual(['1', '2', '3', '4'])
  })

  it('stops at the very top and bottom of the course', () => {
    expect(canStep(layout(), '1', -1, KEYS)).toBe(false)
    const l = { a: ['1'], b: [], c: ['2'], [UNSECTIONED]: [] }
    expect(canStep(l, '2', 1, KEYS)).toBe(false)
    expect(canStep(l, '2', -1, KEYS)).toBe(true)
  })
})

describe('layoutMoves', () => {
  it('sends only what changed, and normalises duplicate orders', () => {
    const saved = new Map([
      ['1', { sectionId: 'a', displayOrder: 0 }],
      ['2', { sectionId: 'a', displayOrder: 0 }], // two lessons once shared an order
      ['3', { sectionId: 'b', displayOrder: 0 }],
    ])
    expect(layoutMoves({ a: ['1', '2'], b: ['3'], [UNSECTIONED]: [] }, saved)).toEqual([{ id: '2', sectionId: 'a', displayOrder: 1 }])
  })

  it('writes a null section for unsectioned lessons', () => {
    const saved = new Map([['1', { sectionId: 'a', displayOrder: 0 }]])
    expect(layoutMoves({ a: [], [UNSECTIONED]: ['1'] }, saved)).toEqual([{ id: '1', sectionId: null, displayOrder: 0 }])
  })
})
