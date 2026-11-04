import { describe, it, expect } from 'vitest'
import { authPath } from './auth-path'

describe('authPath', () => {
  it('defaults to sign-in, whose card links on to sign-up', () => {
    expect(authPath()).toBe('/sign-in')
    expect(authPath(null)).toBe('/sign-in')
    expect(authPath(undefined, 'sign-in')).toBe('/sign-in')
  })

  it('sends a guest to sign-up for pages meant for new members', () => {
    expect(authPath(null, 'sign-up')).toBe('/sign-up')
    expect(authPath('/join?tier=catalyst', 'sign-up')).toBe('/sign-up?next=%2Fjoin%3Ftier%3Dcatalyst')
  })

  it('keeps the return path, encoded', () => {
    expect(authPath('/community/mentoring/discover')).toBe('/sign-in?next=%2Fcommunity%2Fmentoring%2Fdiscover')
    expect(authPath('/join?tier=t1&interval=monthly', 'sign-up')).toBe(
      '/sign-up?next=%2Fjoin%3Ftier%3Dt1%26interval%3Dmonthly',
    )
  })

  it('drops a return path that is not a same-origin relative path', () => {
    for (const mode of ['sign-in', 'sign-up'] as const) {
      expect(authPath('//evil.example', mode)).toBe(`/${mode}`)
      expect(authPath('/\\evil.example', mode)).toBe(`/${mode}`)
      expect(authPath('https://evil.example', mode)).toBe(`/${mode}`)
    }
  })
})
