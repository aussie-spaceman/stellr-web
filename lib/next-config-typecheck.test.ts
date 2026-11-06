import { describe, it, expect } from 'vitest'
import { typescriptConfig } from '../next.config.mjs'

// CI's e2e and Lighthouse builds skip the type check that verify already ran on
// the same code. A deployment must never skip it.
describe('typescriptConfig', () => {
  it('type-checks by default', () => {
    expect(typescriptConfig({}).ignoreBuildErrors).toBe(false)
  })

  it('skips only for the exact opt-in value', () => {
    expect(typescriptConfig({ SKIP_BUILD_TYPECHECK: '1' }).ignoreBuildErrors).toBe(true)
    expect(typescriptConfig({ SKIP_BUILD_TYPECHECK: 'true' }).ignoreBuildErrors).toBe(false)
    expect(typescriptConfig({ SKIP_BUILD_TYPECHECK: '0' }).ignoreBuildErrors).toBe(false)
  })

  it('always type-checks on Vercel, even if the variable is set there', () => {
    expect(typescriptConfig({ SKIP_BUILD_TYPECHECK: '1', VERCEL: '1' }).ignoreBuildErrors).toBe(false)
  })
})
