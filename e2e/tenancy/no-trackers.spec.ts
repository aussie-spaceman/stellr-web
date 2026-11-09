import { chromium, expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { CONSENT_NEEDED_ATTR } from '../../lib/consent'
import { ROUTE_MANIFEST } from '../../lib/security/route-manifest'
import { tenantSurfaceDecision } from '../../lib/tenancy/tenant-surface'
import { FLAG_ON_PORT, mapLimit, rawGet } from '../fixtures/tenant-hosts'
import { OWNER_A, OWNER_B, type RecordOwner } from './harness-records'
import { ownRecordUrls } from './host-cases'
import { hydrated, open, violations } from './open-page'
import { pagePathForFile } from './page-routes'

/**
 * Check (d), S5 B10: a tenant page loads no tracker. In a real browser, on the production
 * build, built with a GTM container and a HubSpot portal set, so that each tag has what it
 * needs to load (harness-env.mjs). A page may try and be stopped by the policy, so a
 * violation counts as well as a request. The control is localhost on the same build, where
 * all of it does happen, in the same browser with the same wait.
 *
 * No third-party request leaves this machine: the browser answers each one with a refusal
 * and writes it down.
 *
 * The pages that need an event from the CMS (the register forms and /check-in/<slug>) 404
 * here, so their forms are not opened. That stays for a harness with a CMS fixture to do.
 */

const TAG_WAIT_MS = 2_500

const TRACKER_COOKIES = /^(_ga|_gid|_gcl|_fbp|hubspotutk|__hs|li_|AnalyticsSyncHistory)/

function tenantPages(o: RecordOwner): string[] {
  return [
    '/',
    '/sign',
    '/sign/copy',
    '/check-in',
    '/privacy',
    '/terms',
    '/register/harness-slug',
    ...ownRecordUrls(o),
    '/no-such-file.png',
  ]
}

// The third-party request a tenant page may make: Clerk, which is how a person signs in and
// is no tracker, on the pages that mount it. Anywhere else it fails the check, and so does
// any other host on these pages. The host is the harness key's instance, which does not exist.
const SIGN_IN_PAGES = ['/sign-in', '/sign-up']
const CLERK_HOST = 'tenant-harness.clerk.accounts.dev'
const mountsClerk = (path: string) => SIGN_IN_PAGES.includes(path) || path.startsWith('/register/')

interface Seen {
  thirdParty: string[]
  vercel: string[]
  consoleErrors: string[]
}

/** Writes down what the page asks for, and refuses anything that would leave the machine. */
async function watch(page: Page, host: string): Promise<Seen> {
  const seen: Seen = { thirdParty: [], vercel: [], consoleErrors: [] }
  await page.route(
    (url) => url.hostname !== host,
    (route) => {
      seen.thirdParty.push(route.request().url())
      return route.abort()
    },
  )
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/_vercel/')) seen.vercel.push(request.url())
  })
  page.on('console', (message) => {
    if (message.type() === 'error') seen.consoleErrors.push(message.text())
  })
  return seen
}

const HYDRATION = /hydrat|Minified React error #(418|419|421|422|423|425)/i
const hydrationErrors = (messages: string[]) => messages.filter((message) => HYDRATION.test(message))

const pageState = (page: Page) =>
  page.evaluate((attr) => {
    const w = window as unknown as Record<string, unknown>
    return {
      dataLayer: 'dataLayer' in w,
      gtag: 'gtag' in w,
      banner: document.querySelector('[data-cookie-banner]') !== null,
      consentAttr: document.documentElement.hasAttribute(attr),
    }
  }, CONSENT_NEEDED_ATTR)

let browser: Browser

test.beforeAll(async () => {
  try {
    browser = await chromium.launch()
  } catch (error) {
    throw new Error(`Check (d) needs a browser, and a skip here would prove nothing: ${(error as Error).message}`)
  }
})
test.afterAll(async () => {
  await browser?.close()
})

async function freshPage(): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext()
  return { context, page: await context.newPage() }
}

for (const o of [OWNER_A, OWNER_B]) {
  for (const path of [...tenantPages(o), ...SIGN_IN_PAGES]) {
    test(`${o.tenantSlug} ${path}: nothing loads, and it hydrates cleanly`, async () => {
      const { context, page } = await freshPage()
      const seen = await watch(page, o.host)
      const { errors } = await open(page, FLAG_ON_PORT, o.host, path)
      await hydrated(page)
      await page.waitForTimeout(TAG_WAIT_MS)

      const allowed = (url: string) => mountsClerk(path) && new URL(url).hostname === CLERK_HOST
      expect(seen.thirdParty.filter((url) => !allowed(url)), path).toEqual([])
      expect(seen.vercel, path).toEqual([])
      expect(await violations(page), path).toEqual([])
      expect(await pageState(page), path).toEqual({ dataLayer: false, gtag: false, banner: false, consentAttr: false })
      expect((await context.cookies()).filter((cookie) => TRACKER_COOKIES.test(cookie.name)), path).toEqual([])
      expect(hydrationErrors([...errors, ...seen.consoleErrors]), path).toEqual([])
      expect(errors, path).toEqual([])
      await context.close()
    })
  }
}

// A plain-text 404 from the proxy has no script to run. The raw answer is the proof, and
// a sample goes through the browser so "no script" is not only read from the markup.
test('every page the allow-list denies answers 404 with no tag in it', async () => {
  const denied = Object.keys(ROUTE_MANIFEST).filter((file) => file.endsWith('/page.tsx') && tenantSurfaceDecision(file) !== 'allow')
  expect(denied.length).toBeGreaterThan(100)
  const answers = await mapLimit(denied, 8, async (file) => {
    const path = pagePathForFile(file)
    const res = await rawGet(FLAG_ON_PORT, OWNER_A.host, path)
    const tags = ['dataLayer', 'googletagmanager', 'hs-scripts', '_vercel', 'data-cookie-banner', 'GTM-HARNESS'].filter((text) => res.body.includes(text))
    return { path, status: res.status, tags }
  })
  // `/` is denied by the manifest's entry and answered by the tenant's own home page, which
  // is checked above with the others.
  expect(answers.filter((a) => (a.path === '/' ? a.status !== 200 : a.status !== 404) || a.tags.length > 0)).toEqual([])
})

test('a denied page opens in a browser with nothing loading', async () => {
  for (const path of ['/about', '/admin', '/community', '/home', '/events']) {
    const { context, page } = await freshPage()
    const seen = await watch(page, OWNER_A.host)
    await open(page, FLAG_ON_PORT, OWNER_A.host, path)
    await page.waitForTimeout(500)
    expect(seen.thirdParty, path).toEqual([])
    expect(seen.vercel, path).toEqual([])
    expect((await pageState(page)).dataLayer, path).toBe(false)
    await context.close()
  }
})

test.describe('the control: localhost, on the same build, in the same browser', () => {
  test('a Stellr page does all of it, so a count of 0 above means something', async () => {
    const { context, page } = await freshPage()
    const seen = await watch(page, 'localhost')
    await open(page, FLAG_ON_PORT, 'localhost', '/about')
    await hydrated(page)
    await page.waitForTimeout(TAG_WAIT_MS)

    const hosts = seen.thirdParty.map((url) => new URL(url).hostname)
    expect(hosts, 'Google Tag Manager').toContain('www.googletagmanager.com')
    expect(hosts, 'HubSpot').toContain('js.hs-scripts.com')
    expect(seen.vercel.some((url) => url.includes('/_vercel/insights/')), 'Vercel Analytics').toBe(true)
    expect(seen.vercel.some((url) => url.includes('/_vercel/speed-insights/')), 'Speed Insights').toBe(true)
    expect(await pageState(page)).toMatchObject({ dataLayer: true, gtag: true, banner: true })
    await expect(page.locator('[data-cookie-banner]')).toBeVisible()
    await context.close()
  })

  // Without this, a policy that stopped a tag would look the same as no tag at all.
  test('a tag forced onto a tenant page shows as a violation, and onto a Stellr page as a request', async () => {
    const TAG = '<img src="https://www.google-analytics.com/g/collect?v=2">'

    const tenant = await freshPage()
    const tenantSeen = await watch(tenant.page, OWNER_A.host)
    await open(tenant.page, FLAG_ON_PORT, OWNER_A.host, '/', TAG)
    await hydrated(tenant.page)
    expect(tenantSeen.thirdParty).toEqual([])
    expect((await violations(tenant.page)).map((v) => v.directive)).toContain('img-src')
    await tenant.context.close()

    const stellr = await freshPage()
    const stellrSeen = await watch(stellr.page, 'localhost')
    await open(stellr.page, FLAG_ON_PORT, 'localhost', '/about', TAG)
    await hydrated(stellr.page)
    expect(stellrSeen.thirdParty.map((url) => new URL(url).hostname)).toContain('www.google-analytics.com')
    await stellr.context.close()
  })

  test('a page that no longer matches its server’s answer shows as a hydration error', async () => {
    const { context, page } = await freshPage()
    const seen = await watch(page, OWNER_A.host)
    const { errors } = await open(page, FLAG_ON_PORT, OWNER_A.host, '/', '', (html) => html.replace('Follow the link you were sent', 'Changed after the server sent it'))
    await hydrated(page)
    await page.waitForTimeout(500)
    expect(hydrationErrors([...errors, ...seen.consoleErrors]).length).toBeGreaterThan(0)
    await context.close()
  })

  test('a real tracker cookie would be caught by name', () => {
    for (const name of ['_ga', '_ga_ABC', '_gcl_au', 'hubspotutk', '__hstc', '_fbp']) expect(name).toMatch(TRACKER_COOKIES)
    expect('__session').not.toMatch(TRACKER_COOKIES)
  })
})
