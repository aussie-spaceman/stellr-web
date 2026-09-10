import { expect, test } from '../fixtures/test'
import { attachConsoleGuard } from '../fixtures/console-guard'

/**
 * Every public page renders, with a heading and no console errors.
 *
 * Deliberately shallow and deliberately broad. The defects this repository's
 * handover docs record are mostly of this shape — a page that renders "Zero
 * locations across zero states" when Sanity is unreachable, a page never
 * checked below 1280px — rather than deep logic faults. A cheap check across
 * every route catches more of those than a thorough check of one.
 */
const PAGES = [
  ['/', 'home'],
  ['/about', 'about'],
  ['/why-stellr', 'why Stellr'],
  ['/competitions', 'competitions'],
  ['/events', 'events'],
  ['/membership', 'membership'],
  ['/educators', 'educators'],
  ['/students', 'students'],
  ['/mentors', 'mentors'],
  ['/academy', 'academy'],
  ['/curriculum', 'curriculum'],
  ['/network', 'network'],
  ['/news', 'news'],
  ['/contact', 'contact'],
  ['/donate', 'donate'],
  ['/scholarship', 'scholarship'],
  ['/host-an-event', 'host an event'],
  ['/volunteer', 'volunteer'],
  ['/privacy', 'privacy'],
  ['/terms', 'terms'],
] as const

for (const [path, name] of PAGES) {
  test(`${name} renders`, async ({ page }) => {
    const consoleErrors = attachConsoleGuard(page)

    const response = await page.goto(path)
    expect(response?.status(), `${path} should not error`).toBeLessThan(400)

    // Exactly one h1: the accessible outline, and a proxy for "the page rendered
    // its content rather than a fallback".
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    expect(consoleErrors, `${path} logged console errors`).toEqual([])
  })
}

test('the apex redirects to www', async ({ page }) => {
  // Only meaningful against a deployment; localhost has no apex.
  test.skip(!process.env.E2E_BASE_URL, 'needs a deployed target')
  await page.goto('/')
  expect(page.url()).not.toContain('://stellreducation.org')
})

test('a missing page returns 404 rather than a server error', async ({ page }) => {
  const response = await page.goto('/this-route-does-not-exist')
  expect(response?.status()).toBe(404)
})
