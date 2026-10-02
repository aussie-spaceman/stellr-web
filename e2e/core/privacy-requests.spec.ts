import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '../fixtures/test'
import { attachConsoleGuard } from '../fixtures/console-guard'
import { storageStatePath } from '../fixtures/users'
import { esignConfigured, privacyConfirmPath, removePrivacyRequests } from '../fixtures/esign'

/**
 * A parent asks Stellr to delete their child's information: the public form,
 * the emailed confirmation link (minted here, as the email would carry it),
 * and the admin answering it. The request only reaches admins once confirmed.
 */

const EMAIL = `e2e-privacy+${Date.now().toString(36)}@example.test`

test.describe('privacy requests', () => {
  test.skip(!esignConfigured(), 'ESIGN_TOKEN_SECRET is not set')
  test.describe.configure({ mode: 'serial' })
  test.afterAll(async () => { await removePrivacyRequests(EMAIL) })

  test('a parent asks, confirms by the emailed link, and the request is open for admins', async ({ page }) => {
    const consoleErrors = attachConsoleGuard(page)
    const trackers: string[] = []
    page.on('request', (r) => { if (/googletagmanager|google-analytics|hs-scripts|_vercel\/insights/.test(r.url())) trackers.push(r.url()) })

    const res = await page.goto('/privacy/request')
    expect(res?.headers()['referrer-policy']).toBe('no-referrer')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Make a privacy request')

    // The child's name is required for a parent's request.
    await page.getByLabel('What would you like us to do?').selectOption('deletion')
    await page.getByLabel('Your full name').fill('Robin Parent')
    await page.getByLabel('Your email address').fill(EMAIL)
    await page.getByRole('button', { name: 'Send request' }).click()
    await expect(page.getByLabel('Your child’s full name')).toBeFocused()

    await page.getByLabel('Your child’s full name').fill('Ezra Parent')
    const { violations } = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    expect(violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
    await page.getByRole('button', { name: 'Send request' }).click()
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()

    await page.goto('about:blank')
    await page.goto(await privacyConfirmPath(EMAIL))
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Request confirmed')
    await expect.poll(() => new URL(page.url()).hash).toBe('')

    expect(trackers).toEqual([])
    expect(consoleErrors).toEqual([])
  })

  test.describe('the admin view', () => {
    test.use({ storageState: storageStatePath('admin') })

    test('shows the confirmed request with its due date, and closes it with a note', async ({ page }) => {
      await page.goto('/admin/privacy-requests')
      const request = page.getByRole('region', { name: 'Request from Robin Parent' })
      await expect(request).toContainText('Delete the information')
      await expect(request).toContainText('parent or guardian of Ezra Parent')
      await expect(request).toContainText('answer by')

      await request.getByLabel('What was done, or why not').fill('No records found for this address; replied to ask which event.')
      await request.getByRole('button', { name: 'Done' }).click()
      await expect(page.getByRole('region', { name: 'Request from Robin Parent' })).toContainText(/Completed .* by/)
    })
  })

  test('the admin route refuses everyone else', async ({ browser, baseURL }) => {
    const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] }, baseURL })
    const res = await anonymous.request.patch('/api/admin/privacy-requests/00000000-0000-4000-8000-000000000000', { data: { status: 'completed', note: 'x' } })
    expect([401, 403]).toContain(res.status())
    await anonymous.close()
  })
})
