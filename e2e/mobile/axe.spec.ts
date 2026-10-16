import { test, expect } from '../fixtures/test'
import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * WCAG 2.2 AA at phone width (mobile review G1). Every serious or critical
 * axe finding on the public smoke routes is counted per rule and compared
 * with e2e/mobile/axe-baseline.json: a page may only get better. When a fix
 * lowers a count, lower the baseline in the same change (the failure message
 * prints the current numbers).
 *
 * Runs in the mobile-chrome project only: axe's result doesn't depend on the
 * engine, and three runs would triple the time.
 */
const ROUTES = [
  '/', '/about', '/why-stellr', '/competitions', '/events', '/membership', '/educators', '/students',
  '/mentors', '/academy', '/curriculum', '/network', '/news', '/contact', '/donate', '/scholarship',
  '/host-an-event', '/volunteer', '/privacy', '/terms',
]

type Baseline = Record<string, Record<string, number>>
const baseline: Baseline = JSON.parse(readFileSync(join(__dirname, 'axe-baseline.json'), 'utf8'))

test.describe('axe at phone width', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  for (const path of ROUTES) {
    test(`${path} gets no worse`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'mobile-chrome', 'axe runs once, in mobile-chrome')
      // A returning visitor: the cookie banner is answered (it is checked on its own below).
      await page.addInitScript(() => {
        try {
          localStorage.setItem('stellr_consent_v1', JSON.stringify({ ads: false, decidedAt: '2026-10-01T00:00:00Z' }))
        } catch {}
      })
      await page.goto(path)
      await page.waitForLoadState('load')

      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
      const now: Record<string, number> = {}
      for (const v of violations) if (v.impact === 'serious' || v.impact === 'critical') now[v.id] = v.nodes.length

      const allowed = baseline[path] ?? {}
      const worse = Object.entries(now)
        .filter(([rule, n]) => n > (allowed[rule] ?? 0))
        .map(([rule, n]) => {
          const v = violations.find((x) => x.id === rule)!
          return `${rule}: ${n} (baseline ${allowed[rule] ?? 0}) — ${v.help}: ${v.nodes.slice(0, 3).map((node) => node.target.join(' ')).join(' | ')}`
        })
      expect(worse, `${path} has new accessibility issues. Current counts: ${JSON.stringify(now)}`).toEqual([])
    })
  }

  test('the first-visit cookie banner passes on its own', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chrome', 'axe runs once, in mobile-chrome')
    await page.goto('/about')
    const banner = page.getByRole('region', { name: 'Cookie consent' })
    await expect(banner).toBeVisible()
    const { violations } = await new AxeBuilder({ page })
      .include('[data-cookie-banner]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
    expect(violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
  })
})
