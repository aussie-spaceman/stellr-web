import type { APIRequestContext } from '@playwright/test'
import { expect, test } from '../fixtures/test'
import { storageStatePath } from '../fixtures/users'
import { attachConsoleGuard } from '../fixtures/console-guard'

/**
 * Credentials: the wallet, the public page and the LinkedIn share flow.
 *
 * Two seeded credentials (supabase/seed.sql "Credentials"):
 *   STL-2026-E2EGRACE — Grace, adult. Can make it public; LinkedIn buttons show.
 *   STL-2026-E2EADA01 — Ada, 16, consent form 1-of-2 signed. Stays private
 *                       with the "needs a signed consent form" explanation.
 *
 * The one test that publishes Grace's credential resets it to private before
 * and after itself, through the owner's own API, so a failure part-way through
 * cannot leave it public. That happened on 24 Sept: the post-click assertion
 * timed out, the in-test cleanup never ran, the dev database kept
 * visibility='public', and every retry and later run failed at the first
 * "Make public". A hook runs whether or not the test passed.
 */

const GRACE = '/credentials/STL-2026-E2EGRACE'
const ADA = '/credentials/STL-2026-E2EADA01'

// The click POSTs, then router.refresh() re-renders the server page before the
// label changes. On a cold CI server that round trip has run past the default
// 5s expect timeout. Longer wait, same assertion.
const AFTER_TOGGLE = { timeout: 20_000 }

async function makeGracePrivate(request: APIRequestContext) {
  const res = await request.post('/api/credentials/STL-2026-E2EGRACE/visibility', {
    data: { visibility: 'private' },
  })
  expect(res.status(), `resetting Grace's credential to private: ${await res.text()}`).toBe(200)
}

test.describe('as Grace (adult)', () => {
  test.use({ storageState: storageStatePath('teacher') })

  test('the wallet lists her credential and links to its page', async ({ page }) => {
    const consoleErrors = attachConsoleGuard(page)
    await page.goto('/community/credentials')
    await expect(page.getByRole('heading', { level: 1, name: 'Credentials' })).toBeVisible()
    const row = page.getByRole('link', { name: /Running a Space Design Competition/ })
    await expect(row).toBeVisible()
    await row.click()
    await expect(page).toHaveURL(new RegExp(GRACE))
    expect(consoleErrors, 'wallet logged console errors').toEqual([])
  })

  // Scoped to this test alone: the suite is fullyParallel, and a reset hook on
  // the wallet test could flip the credential back mid-way through this one.
  test.describe('publishing', () => {
    test.beforeEach(async ({ request }) => makeGracePrivate(request))
    test.afterEach(async ({ request }) => makeGracePrivate(request))

    test('she can make it public, gets LinkedIn links, and can make it private again', async ({ page }) => {
      await page.goto(GRACE)
      await expect(page.getByRole('heading', { level: 1 })).toContainText('Running a Space Design Competition')

      // Owner sees the action bar; a private page shows no share row yet.
      const makePublic = page.getByRole('button', { name: 'Make public' })
      await expect(makePublic).toBeVisible()
      await expect(page.getByRole('link', { name: 'Add to LinkedIn profile' })).toHaveCount(0)

      await makePublic.click()
      await expect(page.getByRole('button', { name: 'Make private' })).toBeVisible(AFTER_TOGGLE)

      // The two LinkedIn links carry what the profile form needs.
      const add = page.getByRole('link', { name: 'Add to LinkedIn profile' })
      await expect(add).toBeVisible()
      const href = await add.getAttribute('href')
      expect(href).toContain('linkedin.com/profile/add?')
      expect(href).toContain('startTask=CERTIFICATION_NAME')
      expect(href).toContain('certId=STL-2026-E2EGRACE')
      expect(href).toContain(encodeURIComponent('/credentials/STL-2026-E2EGRACE'))
      expect(href).toMatch(/organization(Id|Name)=/)

      const share = page.getByRole('link', { name: 'Share on LinkedIn' })
      expect(await share.getAttribute('href')).toContain('linkedin.com/sharing/share-offsite/?url=')

      // The hand-typed details, for when prefill does not fire.
      await page.getByRole('button', { name: /Show the details to type/ }).click()
      await expect(page.getByText('STL-2026-E2EGRACE', { exact: true }).first()).toBeVisible()

      // Making it private again works from the page too. (afterEach resets it
      // regardless, so a failure here cannot leave it public.)
      await page.getByRole('button', { name: 'Make private' }).click()
      await expect(page.getByRole('button', { name: 'Make public' })).toBeVisible(AFTER_TOGGLE)
    })
  })
})

test.describe('as Ada (minor, consent outstanding)', () => {
  test.use({ storageState: storageStatePath('member') })

  test('her page explains why it cannot be public and offers no LinkedIn links', async ({ page }) => {
    const consoleErrors = attachConsoleGuard(page)
    await page.goto(ADA)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Seed Regional Challenge')
    await expect(page.getByText(/Sharing needs a signed Stellr consent form/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Make public' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Add to LinkedIn profile' })).toHaveCount(0)
    expect(consoleErrors, 'credential page logged console errors').toEqual([])
  })

  test('the server refuses to publish it even if asked directly', async ({ request }) => {
    const res = await request.post('/api/credentials/STL-2026-E2EADA01/visibility', {
      data: { visibility: 'public' },
    })
    expect(res.status()).toBe(403)
  })

  test("she cannot change someone else's credential", async ({ request }) => {
    const res = await request.post('/api/credentials/STL-2026-E2EGRACE/visibility', {
      data: { visibility: 'public' },
    })
    expect(res.status()).toBe(404)
  })
})

test.describe('as a verifier (signed out)', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('a private credential shows the private state, not the holder', async ({ page }) => {
    // Ada's, not Grace's: the suite is fullyParallel and Grace's owner test
    // has hers public for a moment. Ada's cannot be published at all.
    await page.goto(ADA)
    await expect(page.getByRole('heading', { level: 1, name: 'This credential is private' })).toBeVisible()
    await expect(page.getByText('Ada Student')).toHaveCount(0)
  })

  test('an unknown number is a 404, and junk never reaches the database', async ({ request }) => {
    expect((await request.get('/credentials/STL-2026-NOPE0000')).status()).toBe(404)
    expect((await request.get('/credentials/not-a-number')).status()).toBe(404)
  })

  test('the share card and badge render as PNG', async ({ request }) => {
    const badge = await request.get(`${GRACE}/badge`)
    expect(badge.status()).toBe(200)
    expect(badge.headers()['content-type']).toContain('image/png')

    const html = await (await request.get(GRACE)).text()
    const og = html.match(/property="og:image" content="([^"]+)"/)?.[1]?.replace(/&amp;/g, '&')
    expect(og, 'page declares an og:image').toBeTruthy()
    const card = await request.get(og!)
    expect(card.status()).toBe(200)
    expect(card.headers()['content-type']).toContain('image/png')
  })
})
