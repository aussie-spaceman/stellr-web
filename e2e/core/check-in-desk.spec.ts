import { expect, test } from '../fixtures/test'
import { storageStatePath } from '../fixtures/users'
import { CHECK_IN_GROUP, checkInConfigured, createCheckInEvent, removeCheckInEvent } from '../fixtures/check-in'

/**
 * The registration desk (Oct 2026): a school group checked in as a unit, with
 * whoever isn't on the bus left out, and the people list holding its order when
 * someone checks in (CO feedback: rows jumped under the admin's finger). Closes
 * tracker row event-check-in-v2.6 (no e2e covered the desk).
 *
 * Each test gets its own throwaway event (e2e/fixtures/check-in.ts), so the
 * suite's parallel workers never share a roster.
 */

test.use({ storageState: storageStatePath('admin') })
test.skip(!checkInConfigured(), 'needs the dev Supabase service key')

let slug = ''
test.beforeEach(async () => {
  slug = await createCheckInEvent()
})
test.afterEach(async () => {
  if (slug) await removeCheckInEvent(slug)
})

async function openDesk(page: import('@playwright/test').Page) {
  // Desktop width: the console opens beside the admin chrome, not in desk mode.
  await page.goto(`/admin/competitions/${slug}/check-in`)
  await expect(page.getByRole('main').getByRole('heading', { name: 'Check-in', level: 1 })).toBeVisible()
  await expect(page.getByRole('main').getByLabel(/of 5 arrived/)).toBeVisible({ timeout: 20_000 })
}

test('checks in a school group, leaving out whoever isn’t here, and undoes it', async ({ page }) => {
  await openDesk(page)
  const main = page.getByRole('main')
  await main.getByRole('tab', { name: /^Groups/ }).click()

  const row = main.getByRole('listitem').filter({ hasText: CHECK_IN_GROUP })
  await expect(row.getByRole('img', { name: '0 of 4 here' })).toBeVisible()
  await row.getByRole('button', { name: 'Check in group' }).click()

  const sheet = page.getByRole('dialog', { name: CHECK_IN_GROUP })
  await expect(sheet.getByRole('button', { name: 'Check in 4' })).toBeVisible()
  // A flag shows on the student with a medical note; it doesn't stop anything.
  await expect(sheet.getByRole('listitem').filter({ hasText: 'Ben Bravo' }).getByText('Medical', { exact: true })).toBeVisible()
  await sheet.getByRole('checkbox', { name: /Cal Charlie/ }).uncheck()
  await sheet.getByRole('button', { name: 'Check in 3' }).click()
  await expect(sheet).toBeHidden()

  await expect(row.getByRole('img', { name: '3 of 4 here' })).toBeVisible()
  await expect(main.getByLabel('3 of 5 arrived')).toBeVisible()

  // It's on the server, not just the screen.
  await page.reload()
  await expect(main.getByLabel('3 of 5 arrived')).toBeVisible({ timeout: 20_000 })
  await main.getByRole('tab', { name: 'People' }).click()
  await expect(main.getByRole('listitem').filter({ hasText: 'Cal Charlie' }).getByRole('button', { name: 'Check in' })).toBeVisible()

  // Undo straight after a group check-in puts the whole group back.
  await main.getByRole('tab', { name: /^Groups/ }).click()
  await row.getByRole('button', { name: 'Check in group' }).click()
  await sheet.getByRole('button', { name: 'Check in 1' }).click()
  await expect(row.getByRole('img', { name: '4 of 4 here' })).toBeVisible()
  await main.getByRole('status').filter({ hasText: `Checked in 1 from ${CHECK_IN_GROUP}` }).getByRole('button', { name: 'Undo' }).click()
  await expect(row.getByRole('img', { name: '3 of 4 here' })).toBeVisible()
})

test('the people list keeps its order when someone checks in, and search finds a school', async ({ page }) => {
  await openDesk(page)
  const main = page.getByRole('main')
  await main.getByRole('tab', { name: 'People' }).click()

  const names = () => main.locator('li p.text-base').allInnerTexts()
  await expect(main.getByRole('listitem').filter({ hasText: 'Ana Alpha' })).toBeVisible()
  const before = await names()
  expect(before).toEqual(['Ana Alpha', 'Ben Bravo', 'Cal Charlie', 'Dee Delta', 'Grace Hopper'])

  await main.getByRole('listitem').filter({ hasText: 'Dee Delta' }).getByRole('button', { name: 'Check in' }).click()
  await expect(main.getByLabel('1 of 5 arrived')).toBeVisible()
  expect(await names()).toEqual(before)

  await main.getByRole('searchbox').fill('westside')
  await expect.poll(names).toEqual(['Dee Delta'])
  await main.getByRole('searchbox').fill('hopper')
  // The teacher's name finds their whole group.
  await expect.poll(names).toEqual(['Ana Alpha', 'Ben Bravo', 'Cal Charlie', 'Grace Hopper'])
})
