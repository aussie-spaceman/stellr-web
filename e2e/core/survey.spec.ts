import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/test'
import { attachConsoleGuard } from '../fixtures/console-guard'
import { storageStatePath } from '../fixtures/users'
import { createSurveyEvent, issueSurveyCredential, removeSurveyEvent, setCertificateGate, surveyConfigured, surveyPath } from '../fixtures/survey'

/**
 * Post-event survey (docs/PLAN-post-event-survey-2026-10-02.md, handover §10):
 *   1. a student by emailed link: answer, leave, come back to the same page, submit, read-only after
 *   2. a member from the dashboard: submit, then see it in "My surveys"
 *   3. an admin: preview who it reaches, send it live, watch the completion table fill
 *   4. the certificate gate (D1): held while the survey is open and unanswered, released on submit
 *   5. photo/media: the admin do-not-use list and the roster's media_ok column
 * Each test makes its own throwaway event (not in Sanity) and removes it after.
 * Opening sends no email from the fixture; the server's own sends go to the
 * dev safelist (or nowhere, with no Resend key).
 */

const ANSWERS = {
  overall_rating: 'Very good',
  nps: 8,
  stem_intent_before: 'Likely',
  stem_intent_after: 'Very likely',
  quote_consent: 'no',
}

/**
 * Load a page before calling admin APIs: Clerk refreshes its short-lived
 * session cookie on navigation, not on API calls, so a request made long
 * after sign-in (CI queues) arrives signed out.
 */
async function refreshSession(page: Page) {
  await page.goto('/admin/surveys')
  await expect(page.getByRole('heading', { name: 'Surveys', exact: true })).toBeVisible()
}

async function expectAccessible(page: Page, step: string) {
  // Let colour transitions (buttons, progress bar, save status) finish: axe
  // sampled a mid-transition colour once (2 Oct), never reproduced in 9 runs.
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(400)
  const { violations } = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(violations.map((v) => `${step}: ${v.id} ${v.help} — ${v.nodes.slice(0, 4).map((n) => `${n.target.join(' ')} ${n.any[0]?.message ?? ''}`).join(' | ')}`)).toEqual([])
}

test.describe('Post-event survey', () => {
  test.skip(!surveyConfigured(), 'SURVEY_TOKEN_SECRET is not set, so survey links cannot be made')
  // Each test builds an event through tsx and walks several pages; the first
  // compile of each route on a local dev server is slow.
  test.slow()

  test.describe('by emailed link (signed out)', () => {
    test.use({ storageState: { cookies: [], origins: [] } })
    let slug = ''
    test.beforeEach(() => {
      slug = createSurveyEvent(true).slug
    })
    test.afterEach(() => {
      if (slug) removeSurveyEvent(slug)
    })

    test('save, leave, resume, submit, then read-only', async ({ page }) => {
      const consoleErrors = attachConsoleGuard(page)
      const path = surveyPath(slug, 'Sam')
      await page.goto(path)
      await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible()
      await expectAccessible(page, 'intro')
      await page.getByRole('button', { name: 'Start', exact: true }).click()

      // Required questions are enforced before moving on.
      await page.getByRole('button', { name: 'Next', exact: true }).click()
      await expect(page.getByText('Please answer the questions marked required.')).toBeVisible()

      await page.getByText('Very good', { exact: true }).click()
      await page.locator('label').filter({ hasText: /^8$/ }).click()
      await page.getByRole('button', { name: 'Next', exact: true }).click()
      await expect(page.getByText('Page 2 of')).toBeVisible()
      await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
      await expectAccessible(page, 'page 2')

      // Leave and come back by the same link: resumes on the saved page.
      await page.goto(path)
      await page.getByRole('button', { name: 'Continue where you left off' }).click()
      await expect(page.getByText('Page 2 of')).toBeVisible()

      // Finish through the same API the page uses, then submit.
      const api = path.replace('/survey/', '/api/survey/')
      const res = await page.request.post(`${api}/submit`, { data: { answers: ANSWERS } })
      expect(res.status()).toBe(200)

      // Submitted: the link now only says thanks, and nothing can be changed.
      await page.goto(path)
      await expect(page.getByText('Already submitted')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Start', exact: true })).toHaveCount(0)
      const again = await page.request.patch(api, { data: { answers: { overall_rating: 'Poor' } } })
      expect(again.status()).toBe(409)

      expect(consoleErrors).toEqual([])
    })

    test('a stop-reminders link works without signing in', async ({ page }) => {
      const path = surveyPath(slug, 'Sam')
      await page.goto(`${path}/stop-reminders`)
      await page.getByRole('button', { name: 'Stop reminders' }).click()
      await expect(page.getByText('You won’t get more reminders about this survey.')).toBeVisible()
    })
  })

  test.describe('from the member dashboard', () => {
    test.use({ storageState: storageStatePath('member') })
    let slug = ''
    test.beforeEach(() => {
      slug = createSurveyEvent(true).slug
    })
    test.afterEach(() => {
      if (slug) removeSurveyEvent(slug)
    })

    test('submit, then see it read-only in My surveys', async ({ page }) => {
      await page.goto('/home')
      const card = page.getByRole('region', { name: /event survey/i })
      const title = `E2E Survey ${slug.slice(-8)}`
      await expect(card.getByText(title)).toBeVisible()
      await card.getByRole('listitem').filter({ hasText: title }).getByRole('link').click()
      await expect(page).toHaveURL(/\/community\/surveys\/open\//)
      await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible()

      const invitationId = page.url().split('/open/')[1].split('?')[0]
      const res = await page.request.post(`/api/members/surveys/${invitationId}/submit`, {
        data: { answers: { overall_rating: 'Excellent', nps: 10, stem_intent_before: 'Not sure', stem_intent_after: 'Likely', highlight: 'Testing the rover' } },
      })
      expect(res.status()).toBe(200)

      await page.goto('/community/surveys')
      await page.getByRole('listitem').filter({ hasText: title }).getByRole('link', { name: /View answers/ }).click()
      await expect(page.getByText('Testing the rover')).toBeVisible()
      await expect(page.getByText('Submitted answers can’t be changed.')).toBeVisible()
    })

    test('certificate gate: held until the survey is in, then downloads', async ({ page }) => {
      const number = issueSurveyCredential(slug)
      const pdf = `/api/credentials/${number}/pdf`

      // Gate off (the default): the certificate downloads.
      expect((await page.request.get(pdf, { headers: { accept: 'application/json' } })).status()).toBe(200)

      setCertificateGate(slug, true)
      const held = await page.request.get(pdf, { headers: { accept: 'application/json' } })
      expect(held.status()).toBe(403)
      const { surveyUrl } = await held.json()
      expect(surveyUrl).toMatch(/^\/community\/surveys\/open\/[0-9a-f-]{36}$/)

      // A browser following the download link lands on Credentials with the reason and the survey link.
      await page.goto(pdf)
      await expect(page).toHaveURL(new RegExp(`/community/credentials\\?survey_first=${number}`))
      await expect(page.getByText(/certificate is ready once your survey is in/)).toBeVisible()
      await expect(page.getByRole('link', { name: 'Open the survey' })).toHaveAttribute('href', surveyUrl)
      await expect(page.getByRole('link', { name: 'Finish the survey to download the certificate' })).toHaveAttribute('href', surveyUrl)

      const invitationId = surveyUrl.split('/open/')[1]
      const res = await page.request.post(`/api/members/surveys/${invitationId}/submit`, {
        data: { answers: { overall_rating: 'Good', nps: 7, stem_intent_before: 'Likely', stem_intent_after: 'Likely' } },
      })
      expect(res.status()).toBe(200)

      const released = await page.request.get(pdf, { headers: { accept: 'application/json' } })
      expect(released.status()).toBe(200)
      expect(released.headers()['content-type']).toBe('application/pdf')
    })
  })

  test.describe('admin', () => {
    test.use({ storageState: storageStatePath('admin') })
    let slug = ''
    test.beforeEach(() => {
      slug = createSurveyEvent(false).slug
    })
    test.afterEach(() => {
      if (slug) removeSurveyEvent(slug)
    })

    test('preview counts, send live, completion table updates', async ({ page }) => {
      // Load a page first: Clerk refreshes its short-lived session cookie on
      // navigation, not on API calls, so a request straight after a long
      // queue (CI) arrives signed out.
      await page.goto('/admin/surveys')
      await expect(page.getByRole('heading', { name: 'Surveys', exact: true })).toBeVisible()

      const api = `/api/admin/events/${slug}/survey`
      const getView = async () => {
        const res = await page.request.get(api)
        const body = await res.json().catch(() => ({}))
        expect(res.status(), JSON.stringify(body)).toBe(200)
        return body
      }
      const before = await getView()
      expect(before.status).toBe('scheduled')
      expect(before.preview.byRole.student).toBe(2)
      expect(before.preview.awaitingConsent).toEqual([])
      expect(before.totals.invited).toBe(0)

      const sent = await page.request.post(api, { data: { action: 'send_now' } })
      expect(sent.status(), await sent.text()).toBe(200)

      const after = await getView()
      expect(after.status).toBe('open')
      expect(after.distribution.opens_at_source).toBe('manual')
      expect(after.totals.invited).toBe(2)
      expect(after.rows.map((r: { name: string }) => r.name).sort()).toEqual(['Ada Student', 'Sam Tester'])

      // A later go-live than the event date is refused.
      const later = await page.request.post(api, { data: { action: 'set_go_live', at: '2099-01-01T00:00:00Z' } })
      expect(later.status()).toBe(409) // already open

      await page.goto('/admin/surveys')
      await expect(page.getByRole('link', { name: `E2E Survey ${slug.slice(-8)}` })).toBeVisible()
    })

    test('certificate gate switch is admins’ and is recorded', async ({ page }) => {
      await refreshSession(page)
      const api = `/api/admin/events/${slug}/survey`
      expect((await (await page.request.get(api)).json()).distribution.gate_certificate).toBe(false)
      expect((await page.request.post(api, { data: { action: 'gate_certificate', on: true } })).status()).toBe(200)
      expect((await (await page.request.get(api)).json()).distribution.gate_certificate).toBe(true)
      expect((await page.request.post(api, { data: { action: 'gate_certificate', on: false } })).status()).toBe(200)
      expect((await (await page.request.get(api)).json()).distribution.gate_certificate).toBe(false)
    })

    test('photo/media: roster media_ok column and the do-not-use list', async ({ page }) => {
      // Ada is 16 at a CO school with no opt-out ticked: off until she opts in.
      // Sam is an adult: yes.
      await refreshSession(page)
      const csv = await (await page.request.get(`/api/admin/events/${slug}/export`)).text()
      const [header, ...lines] = csv.split('\n')
      const cols = header.split(',')
      const at = cols.indexOf('media_ok')
      expect(at).toBeGreaterThan(-1)
      const mediaOf = (first: string) => lines.find((l) => l.includes(`,${first},`))?.split(',')[at]
      expect(mediaOf('Ada')).toBe('no')
      expect(mediaOf('Sam')).toBe('yes')

      await page.goto(`/admin/media?event=${slug}`)
      await expect(page.getByRole('heading', { name: 'Media do-not-use' })).toBeVisible()
      const ada = page.getByRole('row').filter({ hasText: 'Ada Student' })
      await expect(ada).toContainText('Do not use')
      await expect(ada).toContainText('NY/CO, 13–17')
      await expect(page.getByRole('row').filter({ hasText: 'Sam Tester' })).toHaveCount(0)

      const list = await page.request.get(`/api/admin/media/do-not-use?event=${slug}`)
      expect(list.status()).toBe(200)
      expect(await list.text()).toMatch(/^media_ok,Reason,First Name/)
    })
  })
})
