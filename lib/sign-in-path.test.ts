import { describe, it, expect } from 'vitest'
import { signInPath } from './sign-in-path'

describe('signInPath', () => {
  it('sends a guest to /sign-in, never /sign-up', () => {
    expect(signInPath()).toBe('/sign-in')
    expect(signInPath(null)).toBe('/sign-in')
  })

  it('keeps the return path, encoded', () => {
    expect(signInPath('/community/mentoring/discover')).toBe('/sign-in?next=%2Fcommunity%2Fmentoring%2Fdiscover')
    expect(signInPath('/join?tier=t1&interval=monthly')).toBe('/sign-in?next=%2Fjoin%3Ftier%3Dt1%26interval%3Dmonthly')
  })

  it('drops a return path that is not a same-origin relative path', () => {
    expect(signInPath('//evil.example')).toBe('/sign-in')
    expect(signInPath('/\\evil.example')).toBe('/sign-in')
    expect(signInPath('https://evil.example')).toBe('/sign-in')
  })
})
