import { describe, expect, it } from 'vitest'
import { CURRENT_SCHOOL_YEAR, eraCycle, eraForSchoolYear, storyYear } from './future-history'

describe('future history', () => {
  it('sets the 2027 series on Mars, in 2052', () => {
    expect(CURRENT_SCHOOL_YEAR).toBe(2027)
    expect(eraForSchoolYear(2027).id).toBe('mars')
    expect(storyYear(2027)).toBe(2052)
  })

  it('rotates cislunar → Mars → inner → outer, one school year each', () => {
    expect([2026, 2027, 2028, 2029, 2030].map((y) => eraForSchoolYear(y).id))
      .toEqual(['cislunar', 'mars', 'inner', 'outer', 'cislunar'])
  })

  it('sets each era further ahead: +20, +25, +30, +35', () => {
    expect([2026, 2027, 2028, 2029].map(storyYear)).toEqual([2046, 2052, 2058, 2064])
  })

  it('lists the cycle with the current era marked and the others at their next school year', () => {
    expect(eraCycle(2027).map(({ era, schoolYear, setIn, current }) => [era.id, schoolYear, setIn, current])).toEqual([
      ['cislunar', 2030, 2050, false],
      ['mars', 2027, 2052, true],
      ['inner', 2028, 2058, false],
      ['outer', 2029, 2064, false],
    ])
  })
})
