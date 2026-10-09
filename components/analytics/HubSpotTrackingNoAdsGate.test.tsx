import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { HubSpotTrackingNoAdsGate } from '@/components/analytics/HubSpotTrackingNoAdsGate'

// Deep review MP-3: HubSpot's tracking must be suppressed on no-ads paths
// (register, check-in, credentials, sign-up, member app, admin) even on a fresh
// browser that has no no-ads cookie yet — a child registering, or a guardian on
// the family credential link, must not be tracked.

let pathname = '/'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))

function child() {
  return (
    <HubSpotTrackingNoAdsGate>
      <div data-testid="hs">hubspot</div>
    </HubSpotTrackingNoAdsGate>
  )
}

beforeEach(() => {
  pathname = '/'
  // no no-ads cookie
  document.cookie = 'stellr_no_ads=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
})
afterEach(() => vi.clearAllMocks())

describe('HubSpotTrackingNoAdsGate', () => {
  it('renders HubSpot on an ordinary public page with no cookie', async () => {
    pathname = '/about'
    render(child())
    await waitFor(() => expect(screen.queryByTestId('hs')).toBeTruthy())
  })

  for (const p of ['/credentials/STL-2026-ABCD', '/register/nevada-2027/individual', '/check-in/nevada-2027', '/sign-up']) {
    it(`suppresses HubSpot on the no-ads path ${p} even without the cookie`, async () => {
      pathname = p
      render(child())
      // Give the mount effect a tick; it must stay hidden.
      await new Promise((r) => setTimeout(r, 0))
      expect(screen.queryByTestId('hs')).toBeNull()
    })
  }

  it('suppresses HubSpot when the no-ads cookie is present, even on a public page', async () => {
    pathname = '/about'
    document.cookie = 'stellr_no_ads=1; path=/'
    render(child())
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByTestId('hs')).toBeNull()
  })
})
