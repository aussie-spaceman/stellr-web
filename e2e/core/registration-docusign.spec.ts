import { expect, test } from '../fixtures/test'
import { storageStatePath } from '../fixtures/users'
import { attachConsoleGuard } from '../fixtures/console-guard'

/**
 * Consent forms — who the app says still has to sign.
 *
 * Scope, deliberately: this does NOT drive DocuSign. Signing happens on
 * DocuSign's own pages, and a test that automates a third party's UI tests the
 * third party. What it covers is the layer that was wrong — the **status cell**
 * on `/admin/docusigns`, which is where a part-signed envelope either tells the
 * truth or does not.
 *
 * The defect it guards (`docs/REC-docusign-remediation-2026-09-04.md`): an
 * envelope-level status could not express "partially signed", so a family with
 * one of two signatures in was described by the guardian's state alone. Grace
 * had signed; Ada had not; the app implied there was nothing outstanding.
 *
 * Fixture: `fixture-envelope-partially-signed`, 1 of 2.
 *   Grace Teacher (guardian) — completed, and the named SIGNER on the row
 *   Ada Student   (minor)    — delivered, i.e. the one still outstanding
 *
 * Note which column matters. `Ada Student` is the PARTICIPANT and renders on
 * every row regardless of signing state — asserting merely that it appears
 * passes just as happily when the envelope is complete, when it is untouched,
 * and when the two roles are swapped. Every assertion below therefore targets
 * the STATUS cell, the only place the part-signed distinction is expressed.
 */

const ENVELOPE_ROW = 'Ada Student'
const OUTSTANDING = 'Ada Student'
const ALREADY_SIGNED = 'Grace Teacher'

/** The status cell of the fixture's row — column index 4, headed STATUS. */
const statusCell = (page: import('@playwright/test').Page) =>
  page.locator('tbody tr', { hasText: ENVELOPE_ROW }).first().locator('td').nth(4)

test.describe('the admin consent-forms view', () => {
  test.use({ storageState: storageStatePath('admin') })

  test('says the envelope is part-signed, with the count', async ({ page }) => {
    const consoleErrors = attachConsoleGuard(page)

    await page.goto('/admin/docusigns')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    // The whole point of the remediation: a state between sent and complete.
    await expect(statusCell(page)).toContainText(/partially complete/i)
    await expect(statusCell(page)).toContainText(/1 of 2/i)

    expect(consoleErrors, '/admin/docusigns logged console errors').toEqual([])
  })

  test('names the minor as outstanding, not the guardian who signed', async ({ page }) => {
    await page.goto('/admin/docusigns')
    const status = statusCell(page)

    // This is the regression. Before the fix the row spoke for the guardian.
    await expect(status).toContainText(new RegExp(`awaiting\\s+${OUTSTANDING}`, 'i'))
    await expect(status).not.toContainText(new RegExp(`awaiting\\s+${ALREADY_SIGNED}`, 'i'))
  })

  test('does not present a part-signed envelope as finished', async ({ page }) => {
    await page.goto('/admin/docusigns')

    // Careful with the word: the cell legitimately reads "Partially Complete",
    // so a bare /complete/ match would be satisfied by the very state this is
    // meant to reject. Only a status that *starts* by claiming completion is
    // the failure, and "awaiting" must still be present.
    await expect(statusCell(page)).not.toContainText(/^\s*completed\b/i)
    await expect(statusCell(page)).toContainText(/awaiting/i)
  })

  test('counts it as outstanding in the summary and filters', async ({ page }) => {
    await page.goto('/admin/docusigns')
    const body = await page.locator('body').innerText()

    // The counters are derived separately from the row, so they can disagree
    // with it — an envelope shown as awaiting while "Signed" counts it done.
    expect(body, 'the completed filter must not claim this envelope').toMatch(/Completed \(0\)/i)
    expect(body, 'it should sit under Delivered').toMatch(/Delivered \(1\)/i)
  })
})

test.describe('the member view of their own agreements', () => {
  test.use({ storageState: storageStatePath('member') })

  test('Ada can load her account without errors', async ({ page }) => {
    const consoleErrors = attachConsoleGuard(page)

    // Scope note: this is a smoke-level check. The account page does not
    // currently surface the outstanding envelope, so there is nothing here to
    // assert about signing state — claiming otherwise would be the same
    // mistake as asserting on the participant column.
    await page.goto('/account')
    await expect(page).toHaveURL(/\/account/)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    expect(consoleErrors, '/account logged console errors').toEqual([])
  })
})

test.describe('the public registration entry point', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('an unknown event slug 404s rather than erroring', async ({ page }) => {
    // The seed's slug deliberately matches no Sanity document, so this pins
    // that a registration URL for a non-existent event fails cleanly instead
    // of throwing — the kind of route a stale link produces.
    const response = await page.goto('/register/seed-regional-challenge')
    expect(response?.status(), 'a missing event should 404, not 500').toBe(404)
  })
})

test.describe('the envelope fixture itself', () => {
  test.use({ storageState: storageStatePath('admin') })

  test('is still the part-signed case', async ({ page }) => {
    // Guards the fixture, not the app. If someone "tidies" the seed so both
    // recipients are signed, every assertion above would pass against a case
    // that cannot exhibit the bug — coverage lost with the suite still green.
    await page.goto('/admin/docusigns')
    const status = await statusCell(page).innerText()

    expect(status, 'the fixture must remain 1-of-2 signed').toMatch(/1 of 2/i)
    expect(status, 'and must still have an outstanding signer').toMatch(/awaiting/i)
  })
})
