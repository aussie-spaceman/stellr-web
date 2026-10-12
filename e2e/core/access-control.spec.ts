import fs from 'node:fs'
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

  test('cannot read admin page data via a direct RSC request', async ({ page }) => {
    // Deep review C-2: a redirect thrown in the (admin) layout does NOT stop the
    // page segment rendering, so requesting the RSC payload directly (the header
    // the router sends during in-app navigation) returned the full member list
    // to a member. The middleware now redirects before the render.
    //
    // The canary is OTHER people's emails. The viewer is redirected to their own
    // /account page, which legitimately contains their own address, so that is
    // not a leak. The admin members list, by contrast, contains every member —
    // so the admin's and teacher's addresses appearing is proof the list
    // rendered. Pre-fix this failed (both present); post-fix they are absent.
    const res = await page.request.get('/admin/members', { headers: { RSC: '1' } })
    const body = await res.text()
    expect(body, 'admin members list leaked to a member').not.toContain(FIXTURES.admin.email)
    expect(body, 'admin members list leaked to a member').not.toContain(FIXTURES.teacher.email)
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

// deep review TEST-8/TEST-2: the admin PAGE gate (the layout redirect above) is
// not the admin API gate. `proxy.ts` does not cover `/api/admin/*`, and the
// server uses the service-role key, so RLS never applies — a member session
// reaching an admin API must be refused by that route's own code, and only a
// test proves it. The existing specs only ever checked the pages.
test.describe('a member session is refused by the admin APIs', () => {
  test.use({ storageState: storageStatePath('member') })

  for (const path of ['/api/admin/members/export', '/api/admin/docusigns']) {
    test(`GET ${path} is 401/403, never 200`, async ({ page }) => {
      // Load a page first so the request carries a fresh Clerk session cookie.
      await page.goto('/account')
      const res = await page.request.get(path)
      expect([401, 403], `${path} returned ${res.status()}`).toContain(res.status())
    })
  }
})

// deep review TEST-8: an event manager is scoped to the events they are assigned
// to. Skipped until the fixture is provisioned (see e2e/fixtures/users.ts); when
// it is, this proves the "cannot see another event" boundary end-to-end.
const eventManagerReady =
  Boolean(process.env.E2E_EVENT_MANAGER_PASSWORD) && fs.existsSync(storageStatePath('event_manager'))

test.describe('signed in as an event manager', () => {
  test.skip(!eventManagerReady, 'event_manager fixture not provisioned (see e2e/fixtures/users.ts)')
  test.use({ storageState: eventManagerReady ? storageStatePath('event_manager') : undefined })

  test('reaches its assigned event but is refused another', async ({ page }) => {
    await page.goto('/account')
    // Assigned to seed-regional-challenge in the seed: that event's API answers.
    const assigned = await page.request.get('/api/admin/events/seed-regional-challenge/companies')
    expect([401, 403], 'assigned event was refused').not.toContain(assigned.status())
    // Any other event: refused, so one manager cannot read another's roster.
    const other = await page.request.get('/api/admin/events/seed-some-other-event/companies')
    expect([401, 403], 'an unassigned event was NOT refused').toContain(other.status())
  })
})
