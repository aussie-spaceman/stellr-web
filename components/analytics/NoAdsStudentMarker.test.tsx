import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NoAdsStudentMarker } from './NoAdsStudentMarker'

function visit(hostname: string) {
  vi.stubGlobal('location', new URL(`https://${hostname}/`))
}

let cookieWrites: string[] = []

beforeEach(() => {
  cookieWrites = []
  vi.spyOn(document, 'cookie', 'set').mockImplementation((value) => {
    cookieWrites.push(value)
  })
  window.dataLayer = []
  const w = window as unknown as { __stellrNoAds?: boolean; _hsq?: unknown[] }
  delete w.__stellrNoAds
  delete w._hsq
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('NoAdsStudentMarker', () => {
  it('shares the cookie across www and app from a Stellr host', () => {
    visit('app.stellreducation.org')
    render(<NoAdsStudentMarker />)
    expect(cookieWrites).toHaveLength(1)
    expect(cookieWrites[0]).toContain('stellr_no_ads=1')
    expect(cookieWrites[0]).toContain('domain=.stellreducation.org')
    expect((window as unknown as { __stellrNoAds?: boolean }).__stellrNoAds).toBe(true)
    expect(window.dataLayer).toEqual([{ stellr_no_ads: true }])
  })

  it('writes a host-only cookie in local development', () => {
    visit('localhost')
    render(<NoAdsStudentMarker />)
    expect(cookieWrites).toHaveLength(1)
    expect(cookieWrites[0]).not.toContain('domain=')
  })

  for (const hostname of ['x.events.stellreducation.org', 'canary-academy.localhost', 'events.school.example']) {
    it(`does nothing on the tenant host ${hostname}`, () => {
      visit(hostname)
      render(<NoAdsStudentMarker />)
      expect(cookieWrites).toEqual([])
      expect(window.dataLayer).toEqual([])
      expect((window as unknown as { __stellrNoAds?: boolean }).__stellrNoAds).toBeUndefined()
    })
  }
})
