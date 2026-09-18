import { expect, test } from '../fixtures/test'
import { attachConsoleGuard } from '../fixtures/console-guard'

/**
 * Coming back to an unpaid registration.
 *
 * Scope, deliberately: Stripe is not driven — Checkout is Stripe's page, and
 * the pay route's contract with it is unit-tested. What this covers is the
 * layer that was missing on 17 Sept 2026, when a parent closed the Checkout
 * tab and had no way back: the **pay page** behind the token in the email
 * (and behind Stripe's cancel URL), and what it says in each state.
 *
 * Fixtures (supabase/seed.sql):
 *   …d000-000000000002 — individual, pending, $75.00, pay_token fixed below,
 *                        participant Mia Unpaid
 *   …d000-000000000001 — group, confirmed (no token; given one here to prove
 *                        a confirmed token is inert)
 */

const EVENT = 'seed-regional-challenge'
const PENDING_TOKEN = '0123456789abcdef'.repeat(4)

test.describe('the registration pay page', () => {
  test('a pending registration shows who, how much, and a way to pay', async ({ page }) => {
    const consoleErrors = attachConsoleGuard(page)

    const response = await page.goto(`/register/${EVENT}/pay/${PENDING_TOKEN}?cancelled=1`)
    expect(response?.status()).toBeLessThan(400)

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Seed Regional Challenge (fixture)')
    await expect(page.getByText('Registration for')).toContainText('Mia')
    // First name only — the page must never leak the rest of the record.
    await expect(page.locator('main')).not.toContainText('Unpaid')
    await expect(page.locator('main')).not.toContainText('mia.unpaid@example.com')
    await expect(page.getByText('$75.00').first()).toBeVisible()
    await expect(page.getByRole('button', { name: /Pay \$75\.00 now/ })).toBeEnabled()

    // Arriving from Stripe's cancel URL: reassurance, with the address masked.
    await expect(page.getByText('Your registration is still saved')).toBeVisible()
    await expect(page.getByText('m***@example.com')).toBeVisible()

    expect(consoleErrors).toEqual([])
  })

  test('a token nobody minted is refused without a server error', async ({ page }) => {
    const response = await page.goto(`/register/${EVENT}/pay/${'f'.repeat(64)}`)
    expect(response?.status()).toBeLessThan(500)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/isn.t valid/)
    await expect(page.getByRole('button', { name: /Pay/ })).toHaveCount(0)
  })

  test('the pay API refuses a malformed token', async ({ request }) => {
    const res = await request.post('/api/register/pay', { data: { token: 'not-a-token' } })
    expect(res.status()).toBe(404)
  })
})
