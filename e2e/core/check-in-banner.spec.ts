import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { supabaseFetch, supabaseSecretKey } from '../../lib/supabase-keys'
import { assertE2eSupabase } from '../../lib/testing/e2e-supabase-target'
import { checkInConfigured, createCheckInEvent, removeCheckInEvent } from '../fixtures/check-in'
import { freshClerkSession } from '../fixtures/fresh-session'
import { serverReadsCms } from '../fixtures/scholarship'
import { expect, test } from '../fixtures/test'
import { storageStatePath } from '../fixtures/users'

/**
 * The check-in banner's QR code (tracker check-in-banner.5): the fixed address
 * /check-in sends a phone on to the one in-person event whose check-in is open,
 * with a 307 so no phone caches last month's event (lib/check-in-banner.ts,
 * app/(stellr)/(flow)/check-in/page.tsx).
 *
 * In-person means a Sanity event that is not virtual. The CI e2e job has no
 * Sanity project, so there no event is in person and the banner always says
 * check-in isn't open; the redirect test runs wherever the server reads the CMS.
 */

const BANNER = '/check-in'
/** An in-person Sanity event on dev (the event pd-credentials uses too). */
const EVENT = 'nevada-space-design-challenge'

function devDb() {
  const url = assertE2eSupabase()
  return createClient(url, supabaseSecretKey() as string, { auth: { persistSession: false }, global: { fetch: supabaseFetch } })
}

test.describe('the banner, signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } })
  test.skip(!checkInConfigured(), 'needs the dev Supabase service key')

  let slug = ''
  test.beforeEach(async () => {
    slug = await createCheckInEvent()
  })
  test.afterEach(async () => {
    if (slug) await removeCheckInEvent(slug)
  })

  test('an event with no Sanity page never takes the banner, even with check-in open', async ({ page, request }) => {
    // Open, with a token, straight on the row (no admin call: that would close
    // the real events' check-in too).
    const token = randomBytes(16).toString('hex')
    const { error } = await devDb().from('event_settings').upsert({ event_slug: slug, check_in_open: true, check_in_token: token }, { onConflict: 'event_slug' })
    expect(error, error?.message).toBeNull()

    const res = await request.get(BANNER, { maxRedirects: 0 })
    expect(res.headers()['location'] ?? '', 'the banner went to the throwaway event').not.toContain(slug)

    if (!(await serverReadsCms(request))) {
      // Nothing is in person without the CMS: the page itself answers.
      expect(res.status()).toBe(200)
      await page.goto(BANNER)
      await expect(page).toHaveURL(new RegExp(`${BANNER}$`))
      await expect(page.getByRole('heading', { level: 1, name: 'Check-in isn’t open yet' })).toBeVisible()
      await expect(page.getByText('Head to the registration desk')).toBeVisible()
    } else {
      // With the CMS another (real) event may be open on dev; either way it is never this one.
      expect([200, 307]).toContain(res.status())
    }
  })
})

test.describe('the banner, with an in-person check-in open', () => {
  /** Rows the admin "open" changed, so the hook can put them back exactly. */
  let before: { open: boolean; token: string | null } | null | undefined
  let closedByTest: string[] = []

  test.beforeEach(async ({ request }) => {
    test.skip(!(await serverReadsCms(request)), 'the server reads no events from the CMS, so no event is in person (CI e2e has no Sanity project)')
    const { data, error } = await devDb().from('event_settings').select('check_in_open, check_in_token').eq('event_slug', EVENT).maybeSingle()
    expect(error, error?.message).toBeNull()
    before = data ? { open: data.check_in_open === true, token: (data.check_in_token as string | null) ?? null } : null
    closedByTest = []
  })

  test.afterEach(async () => {
    if (before === undefined) return // skipped before reading anything
    const db = devDb()
    // This event's row back as it was: closed again, or open with its own token.
    const restore = before
      ? db.from('event_settings').update({ check_in_open: before.open, check_in_token: before.token }).eq('event_slug', EVENT)
      : db.from('event_settings').update({ check_in_open: false }).eq('event_slug', EVENT)
    const { error } = await restore
    expect(error, error?.message).toBeNull()
    // Opening this one closed any other in-person check-in: reopen those.
    if (closedByTest.length) {
      const { error: reopenError } = await db.from('event_settings').update({ check_in_open: true }).in('event_slug', closedByTest)
      expect(reopenError, reopenError?.message).toBeNull()
    }
    before = undefined
  })

  test('a scan is a 307 to the open event’s check-in page, with its token', async ({ browser }) => {
    const admin = await browser.newContext({ storageState: storageStatePath('admin') })
    const adminPage = await admin.newPage()
    await adminPage.goto('/account')
    await freshClerkSession(adminPage)
    const opened = await admin.request.post(`/api/admin/events/${EVENT}/check-in`, { data: { action: 'open' } })
    expect(opened.status(), await opened.text()).toBe(200)
    closedByTest = ((await opened.json()).closed as { slug: string }[]).map((e) => e.slug)
    await admin.close()

    const { data: row, error } = await devDb().from('event_settings').select('check_in_open, check_in_token').eq('event_slug', EVENT).single()
    expect(error, error?.message).toBeNull()
    expect(row!.check_in_open).toBe(true)
    const token = row!.check_in_token as string
    expect(token).toMatch(/^[0-9a-f]{32}$/)

    const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    // Temporary on purpose: a phone caches a permanent redirect.
    const scan = await visitor.request.get(BANNER, { maxRedirects: 0 })
    expect(scan.status()).toBe(307)
    const target = new URL(scan.headers()['location'], 'http://banner.example.test')
    expect(target.pathname).toBe(`/check-in/${EVENT}`)
    expect(target.searchParams.get('t')).toBe(token)

    // Followed, it lands on the event's own check-in form.
    const page = await visitor.newPage()
    const landed = await page.goto(BANNER)
    expect(landed?.status()).toBe(200)
    const final = new URL(page.url())
    expect(final.pathname).toBe(`/check-in/${EVENT}`)
    expect(final.searchParams.get('t')).toBe(token)
    await expect(page.getByText('Event check-in', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).not.toBeEmpty()
    await visitor.close()
  })
})
