import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CookieConsent } from '@/components/analytics/CookieConsent'
import { CONSENT_STORAGE_KEY } from '@/lib/consent'

/**
 * The behaviour under test is the part that is not obvious from reading the
 * component: accepting must both update Consent Mode *and* emit a dataLayer
 * event, because a Consent Mode update alone does not start a third-party tag
 * whose Page View trigger has already passed.
 */

function dataLayer(): any[] {
  return (window.dataLayer ?? []) as any[]
}

function consentCalls() {
  return dataLayer().filter((e) => Array.isArray(e) && e[0] === 'consent')
}

function events() {
  return dataLayer().filter((e) => e && !Array.isArray(e) && e.event)
}

describe('CookieConsent', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.dataLayer = []
    // No gtag shim in jsdom — applyConsent falls back to a raw dataLayer push.
    delete (window as any).gtag
  })

  afterEach(() => {
    window.localStorage.clear()
    window.dataLayer = []
  })

  it('shows when no decision has been stored', async () => {
    render(<CookieConsent />)
    expect(await screen.findByRole('region', { name: /cookie consent/i })).toBeTruthy()
  })

  it('stays hidden when a decision already exists', async () => {
    window.localStorage.setItem(
      CONSENT_STORAGE_KEY,
      JSON.stringify({ ads: true, decidedAt: '2026-08-12T00:00:00.000Z' }),
    )
    render(<CookieConsent />)
    await waitFor(() => expect(consentCalls().length).toBeGreaterThan(0))
    expect(screen.queryByRole('region', { name: /cookie consent/i })).toBeNull()
  })

  it('accepting grants ad_storage and emits consent_granted', async () => {
    const user = userEvent.setup()
    render(<CookieConsent />)

    await user.click(await screen.findByRole('button', { name: /accept all/i }))

    const update = consentCalls().find((c) => c[1] === 'update')
    expect(update?.[2]?.ad_storage).toBe('granted')
    expect(events().some((e) => e.event === 'consent_granted')).toBe(true)
  })

  it('emits consent_granted only after the consent update, never before', async () => {
    const user = userEvent.setup()
    render(<CookieConsent />)
    await user.click(await screen.findByRole('button', { name: /accept all/i }))

    const updateIdx = dataLayer().findIndex((e) => Array.isArray(e) && e[1] === 'update')
    const grantedIdx = dataLayer().findIndex((e) => e && !Array.isArray(e) && e.event === 'consent_granted')

    expect(updateIdx).toBeGreaterThanOrEqual(0)
    expect(grantedIdx).toBeGreaterThan(updateIdx)
  })

  it('declining denies ad_storage and emits no consent_granted', async () => {
    const user = userEvent.setup()
    render(<CookieConsent />)

    await user.click(await screen.findByRole('button', { name: /essential only/i }))

    const update = consentCalls().find((c) => c[1] === 'update')
    expect(update?.[2]?.ad_storage).toBe('denied')
    expect(events().some((e) => e.event === 'consent_granted')).toBe(false)
  })

  it('persists the decision so the banner does not reappear', async () => {
    const user = userEvent.setup()
    render(<CookieConsent />)
    await user.click(await screen.findByRole('button', { name: /accept all/i }))

    const stored = JSON.parse(window.localStorage.getItem(CONSENT_STORAGE_KEY)!)
    expect(stored.ads).toBe(true)
    expect(typeof stored.decidedAt).toBe('string')
  })

  it('declining is one click, not hidden behind a preferences screen', async () => {
    render(<CookieConsent />)
    const region = await screen.findByRole('region', { name: /cookie consent/i })
    const buttons = Array.from(region.querySelectorAll('button')).map((b) => b.textContent?.trim())
    expect(buttons).toHaveLength(2)
    expect(buttons.some((b) => /essential only/i.test(b ?? ''))).toBe(true)
  })
})
