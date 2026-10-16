import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// One test per story in the static build's index (STORYBOOK_DIR, default
// storybook-static). A story about a deliberate failure state can opt out of
// axe with `tags: ['a11y-skip']`; one that cannot render outside the app at
// all opts out entirely with `tags: ['skip-test']` (say why in the story).
type Entry = { id: string; title: string; name: string; type: string; tags?: string[] }

const dir = process.env.STORYBOOK_DIR ?? 'storybook-static'
const index = join(dir, 'index.json')
const stories: Entry[] = existsSync(index)
  ? Object.values((JSON.parse(readFileSync(index, 'utf8')) as { entries: Record<string, Entry> }).entries).filter(
      (e) => e.type === 'story',
    )
  : []

test('the Storybook build has stories', () => {
  expect(stories.length, `no stories found in ${index} — run npm run build-storybook first`).toBeGreaterThan(0)
})

for (const story of stories.filter((s) => !s.tags?.includes('skip-test'))) {
  test(`${story.title} › ${story.name}`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    // a11y.manual: the addon would otherwise run axe in the same frame at the
    // same moment, and two runs collide ("Axe is already running").
    await page.goto(`/iframe.html?id=${story.id}&viewMode=story&globals=a11y.manual:!true`)
    // Rendered: the root has content, or a portal (a Dialog) is open.
    await expect(page.locator('#storybook-root > *, body > [role="dialog"], body div[role="dialog"]').first()).toBeVisible()

    expect(errors, 'page errors while rendering').toEqual([])

    if (story.tags?.includes('a11y-skip')) return
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
    const serious = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
    expect(serious, 'serious or critical accessibility issues').toEqual([])
  })
}
