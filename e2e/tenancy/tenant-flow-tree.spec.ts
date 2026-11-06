import { expect, test } from '@playwright/test'
import { CANARY_HOST, FLAG_OFF_PORT, FLAG_ON_PORT, rawGet } from '../fixtures/tenant-hosts'

/**
 * S5 B5b: the tenant page tree on the production build. The harness has one tenant
 * and no records, so this proves the rewrite reaches a real page and that a page with
 * no record of the tenant's answers 404. Which tenant a real record belongs to is in
 * test/tenant-tree-page-records.test.ts, and B10(c) covers both directions over HTTP.
 */

const TOKEN = 'a'.repeat(43)

test('a tenant page with no record of its own renders on a tenant host', async () => {
  const sign = await rawGet(FLAG_ON_PORT, CANARY_HOST, '/sign')
  expect(sign.status).toBe(200)
  // The tenant layout, not Stellr's flow chrome.
  expect(sign.body).toContain('min-h-screen bg-surface font-sans text-ink')
  expect(sign.body).not.toContain('id="main"')
})

test('the banner address says not open when the tenant has nothing open', async () => {
  const banner = await rawGet(FLAG_ON_PORT, CANARY_HOST, '/check-in')
  expect(banner.status).toBe(200)
  expect(banner.body).toContain('Check-in isn’t open yet')
})

for (const path of [
  '/register/harness-slug',
  '/register/harness-slug/individual',
  '/register/harness-slug/group',
  '/register/harness-slug/confirmation',
  '/register/harness-slug/join/harness-token',
  '/register/harness-slug/pay/harness-token',
  '/register/harness-slug/pay-seat/harness-token',
  '/check-in/harness-slug',
  '/check-in/harness-slug/code',
  `/survey/${TOKEN}`,
  `/survey/${TOKEN}/stop-reminders`,
  '/survey/event/harness-slug',
  `/team-profile/${TOKEN}`,
]) {
  test(`${path} answers 404 for a record the tenant doesn't have`, async () => {
    expect((await rawGet(FLAG_ON_PORT, CANARY_HOST, path)).status).toBe(404)
  })
}

test('the tree is not reachable by its own URL, flag off or on', async () => {
  for (const port of [FLAG_OFF_PORT, FLAG_ON_PORT]) {
    for (const path of ['/_t/canary-academy/sign', '/%5Ft/canary-academy/sign', '/_t/canary-academy/check-in']) {
      expect((await rawGet(port, 'localhost', path)).status, `${port} ${path}`).toBe(404)
      expect((await rawGet(port, CANARY_HOST, path)).status, `${port} ${path} on the tenant host`).toBe(404)
    }
  }
})
