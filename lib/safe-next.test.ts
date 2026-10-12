// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { safeNext } from './safe-next'

// deep review AUTH-7: the old `startsWith('/') && !startsWith('//')` check let
// `/\evil.com` and a leading-whitespace `/\t/evil.com` through — browsers
// normalise the backslash / strip the whitespace, yielding an external host.
describe('safeNext (open-redirect hardening)', () => {
  it('rejects a backslash-prefixed external redirect', () => {
    expect(safeNext('/\\evil.com')).toBeNull()
  })

  it('rejects a leading-whitespace path that normalises to protocol-relative', () => {
    expect(safeNext('/\t/evil.com')).toBeNull()
    expect(safeNext('/\n/evil.com')).toBeNull()
  })

  it('rejects protocol-relative and absolute external URLs', () => {
    expect(safeNext('//evil.com')).toBeNull()
    expect(safeNext('https://evil.com')).toBeNull()
    expect(safeNext('/\\/evil.com')).toBeNull()
  })

  it('rejects empty / nullish input', () => {
    expect(safeNext(undefined)).toBeNull()
    expect(safeNext(null)).toBeNull()
    expect(safeNext('')).toBeNull()
  })

  it('accepts genuine same-origin relative paths (with query)', () => {
    expect(safeNext('/join?tier=pathfinder')).toBe('/join?tier=pathfinder')
    expect(safeNext('/account/onboarding')).toBe('/account/onboarding')
    expect(safeNext('/home')).toBe('/home')
  })
})
