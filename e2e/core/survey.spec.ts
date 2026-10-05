import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, test } from '../fixtures/test'
import { attachConsoleGuard } from '../fixtures/console-guard'
import { storageStatePath } from '../fixtures/users'
import { createSurveyEvent, removeSurveyEvent, surveyConfigured, surveyPath } from '../fixtures/survey'

/**
 * Post-event survey (docs/PLAN-post-event-survey-2026-10-02.md, handover §10):
 *   1. a student by emailed link: answer, leave, come back to the same page, submit, read-only after
 *   2. a member from the dashboard: submit, then see it in "My surveys"
 *   3. an admin: preview who it reaches, send it live, watch the completion table fill
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
  })
})
