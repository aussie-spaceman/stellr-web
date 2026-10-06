import { describe, expect, it } from 'vitest'
import { AffineDOMMatrix } from './dommatrix'

const parts = (m: AffineDOMMatrix) => [m.a, m.b, m.c, m.d, m.e, m.f]

describe('AffineDOMMatrix', () => {
  it('starts as the identity, or from six values', () => {
    expect(parts(new AffineDOMMatrix())).toEqual([1, 0, 0, 1, 0, 0])
    expect(new AffineDOMMatrix().isIdentity).toBe(true)
    expect(parts(new AffineDOMMatrix([2, 0, 0, 3, 4, 5]))).toEqual([2, 0, 0, 3, 4, 5])
  })

  it('scales then translates as pdf.js uses it (image-mask outline)', () => {
    const m = new AffineDOMMatrix().scaleSelf(1 / 10, -1 / 20).translateSelf(0, -20)
    expect(parts(m)).toEqual([0.1, 0, 0, -0.05, 0, 1])
  })

  it('multiplies on the right and pre-multiplies on the left', () => {
    const t = new AffineDOMMatrix([1, 0, 0, 1, 5, 7])
    const s = new AffineDOMMatrix([2, 0, 0, 2, 0, 0])
    expect(parts(t.multiply(s))).toEqual([2, 0, 0, 2, 5, 7])
    expect(parts(new AffineDOMMatrix([1, 0, 0, 1, 5, 7]).preMultiplySelf(s))).toEqual([2, 0, 0, 2, 10, 14])
  })

  it('inverts', () => {
    const m = new AffineDOMMatrix([2, 1, 1, 3, 4, 5])
    const back = m.multiply(m.inverse())
    parts(back).forEach((v, i) => expect(v).toBeCloseTo([1, 0, 0, 1, 0, 0][i]))
  })
})
