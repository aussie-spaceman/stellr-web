import { expect, test } from '../fixtures/test'
import { horizontalOverflow, sitemapPaths } from '../fixtures/layout'
import { storageStatePath } from '../fixtures/users'

/**
 * No page scrolls sideways on a phone.
 *
 * Runs in the mobile projects (320px Chromium, Pixel 7, iPhone WebKit; see
 * playwright.config.ts). Every page in the sitemap, the single-task flow pages
 * that aren't in it, and the main member and admin screens. A failure names
 * the elements that reach past the screen's edge.
 */

// Single-task pages and app screens the sitemap doesn't list.
const FLOW_PATHS = ['/check-in', '/sign-in', '/this-page-does-not-exist']
const MEMBER_PATHS = [
  '/home',
  '/account',
  '/community',
  '/community/events',
  '/community/credentials',
  '/community/members',
  '/community/mentoring',
  '/community/resources',
  '/community/training',
  '/community/coaching',
  '/community/search',
]
const ADMIN_PATHS = [
  '/admin',
  '/admin/members',
  '/admin/members/00000000-0000-4000-a000-000000000001',
  '/admin/competitions',
  '/admin/competitions/check-in-banner',
  '/admin/academy/coaching',
  '/admin/academy/coaching/calendar',
  '/admin/academy/mentoring',
  '/admin/academy/mentoring/calendar',
  '/admin/email',
  '/admin/surveys',
]

async function expectNoSidewaysScroll(page: import('@playwright/test').Page, path: string) {
  await page.goto(path)
  await page.waitForLoadState('load')
  const { overflowPx, offenders } = await horizontalOverflow(page)
  expect(overflowPx, `${path} is ${overflowPx}px wider than the screen. Reaching past the edge: ${offenders.join(', ')}`).toBe(0)
}

test.describe('public pages', () => {
  test('every sitemap page fits the screen', async ({ page }) => {
    test.setTimeout(240_000)
    const paths = [...new Set([...(await sitemapPaths(page)), ...FLOW_PATHS])]
    expect(paths.length, 'sitemap should list the public pages').toBeGreaterThan(20)
    const failures: string[] = []
    for (const path of paths) {
      await page.goto(path)
      await page.waitForLoadState('load')
      const { overflowPx, offenders } = await horizontalOverflow(page)
      if (overflowPx > 0) failures.push(`${path} +${overflowPx}px: ${offenders.join(', ')}`)
    }
    expect(failures, `Pages wider than the screen:\n${failures.join('\n')}`).toEqual([])
  })
})

test.describe('member app', () => {
  test.use({ storageState: storageStatePath('member') })
  for (const path of MEMBER_PATHS) {
    test(`${path} fits the screen`, async ({ page }) => {
      await expectNoSidewaysScroll(page, path)
    })
  }
})

test.describe('admin portal', () => {
  test.use({ storageState: storageStatePath('admin') })
  for (const path of ADMIN_PATHS) {
    test(`${path} fits the screen`, async ({ page }) => {
      await expectNoSidewaysScroll(page, path)
    })
  }
})
