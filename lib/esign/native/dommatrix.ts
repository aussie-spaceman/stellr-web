// A 2D DOMMatrix for Node, installed before pdf.js loads (lib/esign/native/pdf-text.ts).
//
// pdf.js builds a DOMMatrix at module load (`const SCALE_MATRIX = new
// DOMMatrix()`) and polyfills it from the optional native @napi-rs/canvas
// package. That package is not in the Vercel function bundle, so on production
// the import itself threw "DOMMatrix is not defined" and every template check
// failed (6 Oct 2026). Text extraction never draws, so only the affine 2D
// subset pdf.js touches is implemented; bundling the 25 MB canvas binary for it
// would cost function storage for nothing.

type Init = ArrayLike<number> | undefined

export class AffineDOMMatrix {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0

  constructor(init?: Init) {
    if (init && init.length >= 6) {
      ;[this.a, this.b, this.c, this.d, this.e, this.f] = Array.from(init).slice(0, 6)
    }
  }

  get is2D(): boolean { return true }
  get isIdentity(): boolean {
    return this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0
  }

  /** this = this × m */
  multiplySelf(m: Partial<AffineDOMMatrix>): this {
    const { a = 1, b = 0, c = 0, d = 1, e = 0, f = 0 } = m
    const [A, B, C, D, E, F] = [this.a, this.b, this.c, this.d, this.e, this.f]
    this.a = A * a + C * b
    this.b = B * a + D * b
    this.c = A * c + C * d
    this.d = B * c + D * d
    this.e = A * e + C * f + E
    this.f = B * e + D * f + F
    return this
  }

  /** this = m × this */
  preMultiplySelf(m: Partial<AffineDOMMatrix>): this {
    const product = new AffineDOMMatrix([m.a ?? 1, m.b ?? 0, m.c ?? 0, m.d ?? 1, m.e ?? 0, m.f ?? 0]).multiplySelf(this)
    ;[this.a, this.b, this.c, this.d, this.e, this.f] = [product.a, product.b, product.c, product.d, product.e, product.f]
    return this
  }

  translateSelf(tx = 0, ty = 0): this {
    return this.multiplySelf({ a: 1, b: 0, c: 0, d: 1, e: tx, f: ty })
  }

  scaleSelf(sx = 1, sy = sx): this {
    return this.multiplySelf({ a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 })
  }

  invertSelf(): this {
    const det = this.a * this.d - this.b * this.c
    if (!det) {
      ;[this.a, this.b, this.c, this.d, this.e, this.f] = [NaN, NaN, NaN, NaN, NaN, NaN]
      return this
    }
    const [A, B, C, D, E, F] = [this.a, this.b, this.c, this.d, this.e, this.f]
    this.a = D / det
    this.b = -B / det
    this.c = -C / det
    this.d = A / det
    this.e = (C * F - D * E) / det
    this.f = (B * E - A * F) / det
    return this
  }

  multiply(m: Partial<AffineDOMMatrix>) { return this.clone().multiplySelf(m) }
  translate(tx?: number, ty?: number) { return this.clone().translateSelf(tx, ty) }
  scale(sx?: number, sy?: number) { return this.clone().scaleSelf(sx, sy) }
  inverse() { return this.clone().invertSelf() }

  private clone(): AffineDOMMatrix {
    return new AffineDOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f])
  }
}

/** Installs AffineDOMMatrix as globalThis.DOMMatrix when the runtime has none. */
export function ensureDOMMatrix(): void {
  const g = globalThis as { DOMMatrix?: unknown }
  if (!g.DOMMatrix) g.DOMMatrix = AffineDOMMatrix
}
