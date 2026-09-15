import { clerk } from '@clerk/testing/playwright'
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

  // Sign out through Clerk's testing helper, which waits for the Clerk client
  // to load and for the sign-out to complete.
  //
  // WHY (15 Sept 2026): this test used to call `window.Clerk?.signOut()` from
  // page.evaluate. On a page served from storageState the HTML arrives before
  // Clerk's script does, so that optional chain was sometimes a silent no-op —
  // nothing was signed out. Clearing cookies did not save it: on a Clerk
  // development instance the client keeps its dev-browser token in
  // localStorage and the middleware handshake re-mints the cookies, so the
  // next /account rendered fully signed in as Ada. That is what the failure
  // snapshot on #81 showed. The flake was never revocation timing; the
  // assertion was waiting for a sign-out that had not happened.
  await clerk.signOut({ page })

  // Belt to braces: the request must be rejected because the SESSION is gone,
  // not because the browser happened to forget it.
  await context.clearCookies()

  // proxy.ts protects /account(.*) with auth.protect(), which sends a guest to
  // sign-in. Assert that destination positively — a negative on a fixed window
  // is how the earlier version passed while proving nothing.
  await page.goto('/account')
  await expect(page).toHaveURL(/\/sign-in/, { timeout: 15_000 })
})
