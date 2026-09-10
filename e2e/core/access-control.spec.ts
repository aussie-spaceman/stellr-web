import { expect, test } from '../fixtures/test'
import { FIXTURES, storageStatePath } from '../fixtures/users'

/**
 * Who may reach what.
 *
 * The most valuable specs in the suite, because this is the only layer that
 * enforces it: admin access is checked in server code, not by RLS
 * (GO-LIVE-CHECKLIST §2), so nothing but a test proves a gated route actually
 * rejects the wrong person. A rendering bug is visible; a missing authorisation
 * check is not.
 *
 * `app/(admin)/layout.tsx:14` redirects anyone without portal access to
 * /account, and admin status comes from Clerk's publicMetadata.role, NOT from
 * the member_roles table — a member row carrying 'staff' grants nothing. These
 * tests pin that behaviour so a future refactor cannot quietly widen it.
 */

test.describe('signed out', () => {
  // No storage state: these run as a stranger.
  test.use({ storageState: { cookies: [], origins: [] } })

  for (const path of ['/account', '/home', '/community', '/admin']) {
    test(`${path} is not reachable`, async ({ page }) => {
      await page.goto(path)

      // Anywhere but the destination. Clerk may serve its own hosted portal or
      // the app's /sign-in depending on configuration, so assert on what
      // matters — that we did not land on the protected page.
      await expect(page).not.toHaveURL(new RegExp(`${path}/?$`))
    })
  }
})

test.describe('signed in as a member', () => {
  test.use({ storageState: storageStatePath('member') })

  test('cannot reach the admin portal', async ({ page }) => {
    await page.goto('/admin')

    // Redirected to /account by the admin layout — not shown an empty admin
    // shell, and not a 403 page. The destination is the assertion because it is
    // what the layout actually does.
    await expect(page).toHaveURL(/\/account/)
  })

  test('cannot reach an admin sub-route either', async ({ page }) => {
    // The gate lives in the layout, so every child inherits it. Worth pinning
    // separately: a future route added outside that layout would slip through.
    await page.goto('/admin/members')
    await expect(page).not.toHaveURL(/\/admin\/members/)
  })

  test('can reach their own account', async ({ page }) => {
    await page.goto('/account')
    await expect(page).toHaveURL(/\/account/)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })
})

test.describe('signed in as an admin', () => {
  test.use({ storageState: storageStatePath('admin') })

  test('reaches the admin portal', async ({ page }) => {
    await page.goto('/admin')

    // If this fails with a redirect to /account, Alan's Clerk publicMetadata is
    // missing `{"role":"admin"}` — the seeded member_roles row does not grant
    // admin, and that distinction has already cost time once.
    await expect(page).toHaveURL(/\/admin/)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('can open the member the seed created', async ({ page }) => {
    // Deep-linking to a fixed UUID instead of searching the UI is the whole
    // point of the seed's hard-coded ids.
    await page.goto(`/admin/members/${FIXTURES.member.memberId}`)
    await expect(page).toHaveURL(new RegExp(FIXTURES.member.memberId))
    await expect(page.getByText('Ada', { exact: false }).first()).toBeVisible()
  })
})
