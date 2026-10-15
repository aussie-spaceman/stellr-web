import { describe, expect, it } from 'vitest'
import { hasSessionHint } from './session-hint'

describe('hasSessionHint', () => {
  it('is true when Clerk has recorded a sign-in time', () => {
    expect(hasSessionHint('a=1; __client_uat=1760500000')).toBe(true)
    expect(hasSessionHint('__client_uat_Xy12Ab=1760500000; b=2')).toBe(true)
  })

  it('is false when signed out or before Clerk has run', () => {
    expect(hasSessionHint('__client_uat=0')).toBe(false)
    expect(hasSessionHint('__client_uat_Xy12Ab=0; __client_uat=0')).toBe(false)
    expect(hasSessionHint('')).toBe(false)
    expect(hasSessionHint('other=1')).toBe(false)
  })
})
