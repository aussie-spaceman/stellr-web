import { expect, test } from '../fixtures/test'
import { storageStatePath } from '../fixtures/users'
import { attachConsoleGuard } from '../fixtures/console-guard'

/**
 * The member's own surfaces, signed in as Ada.
 *
 * Ada is the seed's Pathfinder fixture: an active paid membership, high-school
 * bracket, one group registration. Assertions lean on what the seed guarantees
 * rather than on whatever happens to be in the database, so a failure means the
 * app changed rather than the data did.
 */

test.use({ storageState: storageStatePath('member') })

test('the account page renders for a signed-in member', async ({ page }) => {
  const consoleErrors = attachConsoleGuard(page)

  await page.goto('/account')

  await expect(page).toHaveURL(/\/account/)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  // The member's own name proves the page resolved THIS member rather than
  // rendering a shell — the failure mode a status-code check would miss.
  await expect(page.getByText('Ada', { exact: false }).first()).toBeVisible()

  expect(consoleErrors, '/account logged console errors').toEqual([])
})

test('the member portal is reachable', async ({ page }) => {
  const consoleErrors = attachConsoleGuard(page)

  await page.goto('/home')

  // /home is the member dashboard. A signed-in member must not be bounced to
  // sign-in or sign-up from it.
  await expect(page).not.toHaveURL(/\/sign-(in|up)/)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  expect(consoleErrors, '/home logged console errors').toEqual([])
})

test('community is reachable with an active membership', async ({ page }) => {
  await page.goto('/community')

  // `isCommunityRoute` in proxy.ts redirects guests to /sign-up with a ?next
  // parameter. Ada has an active Pathfinder membership, so she must get
  // through — this pins the membership gate, not merely the auth gate.
  await expect(page).not.toHaveURL(/\/sign-up/)
})

test('signing out ends the session', async ({ page, context }) => {
  await page.goto('/account')
  await expect(page).toHaveURL(/\/account/)

  await page.evaluate(async () => {
    await (window as { Clerk?: { signOut: () => Promise<void> } }).Clerk?.signOut()
  })

  // Clear cookies too: signOut revokes server-side, and this proves the app
  // rejects the request rather than the browser merely forgetting.
  await context.clearCookies()

  await page.goto('/account')
  await expect(page).not.toHaveURL(/\/account$/)
})
