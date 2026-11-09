import { readFileSync } from 'node:fs'
import fontkit from '@pdf-lib/fontkit'
import { chromium, expect, test, type Browser } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { CANARY_HOST, FLAG_OFF_PORT, FLAG_ON_PORT, HARNESS_APP_HOST, rawGet } from '../fixtures/tenant-hosts'
import { hydrated, open, violations } from './open-page'

/**
 * S5, B6: the enforcing policy on a tenant host, on the production build. Raw HTTP first,
 * as the rest of the harness. Then a browser, because only a browser can say the policy
 * lets a page run and stops what it should.
 *
 * What the browser tests do not cover: clerk-js. The harness has no CMS, so no register
 * page renders past its 404, and its Clerk key belongs to no instance. The nonce on its
 * tag is held by test/csp-script-nonces.test.tsx and its hosts by test/tenant-csp.test.ts.
 * A real sign-in under this policy is still to be seen.
 */

const ENFORCING = 'content-security-policy'
const REPORT_ONLY = 'content-security-policy-report-only'

// Pages the tree answers, with a body and with its 404, and allowed paths with no page
// in it yet. A path off the allow-list is a plain-text 404 from the proxy, with no policy,
// unless it has a static file's extension or skips the proxy: see "a URL with no file".
const TENANT_PAGES = ['/', '/sign', '/sign/copy', '/check-in', '/register/harness-slug', '/survey/event/harness-slug', '/privacy', '/sign-in']

const nonceIn = (policy: string) => /'nonce-([^']+)'/.exec(policy)?.[1] ?? ''

test.describe('the header', () => {
  for (const path of TENANT_PAGES) {
    test(`${path} enforces one policy, and every script carries its nonce`, async () => {
      const { headers, body } = await rawGet(FLAG_ON_PORT, CANARY_HOST, path)
      const policy = headers[ENFORCING]
      // One string: Node joins a repeated header with a comma or gives an array.
      expect(typeof policy, path).toBe('string')
      expect(policy as string, path).toMatch(/^script-src 'nonce-[^']+' 'strict-dynamic'/)
      expect(policy as string, path).not.toContain(', ')
      expect(headers[REPORT_ONLY], path).toBeUndefined()
      const nonce = nonceIn(policy as string)
      const scripts = [...body.matchAll(/<script\b([^>]*)>/gi)].map((match) => match[1])
      expect(scripts.length, path).toBeGreaterThan(0)
      expect(scripts.filter((attrs) => !attrs.includes(`nonce="${nonce}"`)), path).toEqual([])
      // A cached copy would carry an old nonce, so nothing on the page would run.
      expect(String(headers['cache-control']), path).toContain('no-store')
    })
  }

  test('two requests get two nonces, in the header and the page', async () => {
    const [a, b] = [await rawGet(FLAG_ON_PORT, CANARY_HOST, '/'), await rawGet(FLAG_ON_PORT, CANARY_HOST, '/')]
    const [one, two] = [nonceIn(String(a.headers[ENFORCING])), nonceIn(String(b.headers[ENFORCING]))]
    expect(one).not.toBe(two)
    expect(a.body).toContain(`nonce="${one}"`)
    expect(a.body).not.toContain(two)
  })

  // next.config.mjs sets an enforcing header on these paths, and the proxy's replaces it,
  // so the proxy's has to hold what that one did.
  test('a private link keeps its private-link rules', async () => {
    const page = await rawGet(FLAG_ON_PORT, CANARY_HOST, '/sign')
    const policy = String(page.headers[ENFORCING])
    expect(policy).toContain("frame-ancestors 'none'")
    expect(policy).toContain("object-src 'none'")
    expect(policy).toContain("form-action 'self'")
    expect(page.headers['x-frame-options']).toBe('DENY')
    expect(page.headers['referrer-policy']).toBe('no-referrer')
    expect(String(page.headers['cache-control'])).toContain('no-store')
  })

  test('an API keeps next.config.mjs’s header, and a PDF keeps its viewer', async () => {
    const context = await rawGet(FLAG_ON_PORT, CANARY_HOST, '/api/sign/context')
    expect(context.headers[ENFORCING]).toBe("frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'")
    const pdf = await rawGet(FLAG_ON_PORT, CANARY_HOST, '/api/sign/document')
    expect(pdf.headers[ENFORCING]).toBe("frame-ancestors 'self'")
  })

  // next.config.mjs's fallback rewrite draws the tree's 404 for these, not the proxy.
  test('a URL with no file gets the 404 under a policy, by whichever way it came', async () => {
    for (const path of ['/no-such-file.png', '/about.png', '/images/no-such.png', '/no-such-file.html', '/no-such-file.js']) {
      const { status, headers, body } = await rawGet(FLAG_ON_PORT, CANARY_HOST, path)
      expect(status, path).toBe(404)
      const policy = String(headers[ENFORCING])
      expect(policy, path).toMatch(/^script-src 'nonce-[^']+' 'strict-dynamic'/)
      const nonce = nonceIn(policy)
      const scripts = [...body.matchAll(/<script\b([^>]*)>/gi)].map((match) => match[1])
      expect(scripts.length, path).toBeGreaterThan(0)
      expect(scripts.filter((attrs) => !attrs.includes(`nonce="${nonce}"`)), path).toEqual([])
      expect(String(headers['cache-control']), path).toContain('no-store')
    }
    // These skip the proxy, so no nonce can reach their scripts and the policy names none.
    for (const path of ['/_next/no-such-file', '/_next/static/no-such-file.js', '/api/csp-report/nope', '/api/img/nope']) {
      const { status, headers } = await rawGet(FLAG_ON_PORT, CANARY_HOST, path)
      expect(status, path).toBe(404)
      expect(headers[ENFORCING], path).toBe("frame-ancestors 'none'; base-uri 'none'; object-src 'none'")
    }
    // Stellr's own hosts never get that header.
    for (const path of ['/_next/no-such-file', '/api/img/nope', '/no-such-file.png']) {
      expect((await rawGet(FLAG_ON_PORT, 'www.stellreducation.org', path)).headers[ENFORCING], path).toBeUndefined()
    }
  })

  test('a real file keeps answering under the policy', async () => {
    for (const path of ['/images/og-default.jpg', '/favicon.ico', '/vendor/zxing_reader.wasm', '/manifest.webmanifest']) {
      const { status, headers } = await rawGet(FLAG_ON_PORT, CANARY_HOST, path)
      expect(status, path).toBe(200)
      expect(String(headers[ENFORCING]), path).toMatch(/^script-src 'nonce-/)
    }
  })

  // The opt-out page draws request values into HTML, so a missed escape would run here.
  test('the opt-out page, the one API with HTML, enforces a policy with no script', async () => {
    const { status, headers, body } = await rawGet(FLAG_ON_PORT, CANARY_HOST, '/api/email/unsubscribe?token=harness')
    expect(status).toBe(200)
    expect(String(headers['content-type'])).toContain('text/html')
    expect(body).toContain('<form method="POST">')
    expect(String(headers[ENFORCING])).toMatch(/^default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'/)
    expect((await rawGet(FLAG_ON_PORT, 'www.stellreducation.org', '/api/email/unsubscribe?token=harness')).headers[ENFORCING]).toBeUndefined()
  })

  // The control, on the same build: without routing the same host and path are Stellr's.
  test('with routing off, the same URL has only Stellr’s headers', async () => {
    const { headers } = await rawGet(FLAG_OFF_PORT, CANARY_HOST, '/sign')
    expect(headers[ENFORCING]).toBe("frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'")
    expect(String(headers[REPORT_ONLY])).toContain('googletagmanager')
  })

  test('a Stellr host with routing on keeps Report-Only and its own private-link header', async () => {
    for (const host of ['localhost', 'stellr.localhost', 'www.stellreducation.org', HARNESS_APP_HOST]) {
      const about = await rawGet(FLAG_ON_PORT, host, '/grant')
      expect(about.headers[ENFORCING], host).toBeUndefined()
      expect(String(about.headers[REPORT_ONLY]), host).toContain("script-src 'self' 'unsafe-inline'")
      const sign = await rawGet(FLAG_ON_PORT, host, '/sign')
      expect(sign.headers[ENFORCING], host).toBe("frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'")
      expect(String(sign.headers[REPORT_ONLY]), host).toContain("'nonce-")
    }
  })
})

test.describe('in a browser', () => {
  let browser: Browser | null = null

  // A browser that will not start fails these, unless the run says it has none. CI's
  // tenant-host-routing job installs one, and harness.test.ts holds it to not saying so.
  test.beforeAll(async () => {
    try {
      browser = await chromium.launch()
    } catch (error) {
      if (!process.env.E2E_TENANT_HOST_NO_BROWSER) throw error
    }
  })
  test.afterAll(async () => {
    await browser?.close()
  })
  test.beforeEach(() => {
    test.skip(!browser, 'E2E_TENANT_HOST_NO_BROWSER is set and no browser started')
  })

  for (const path of TENANT_PAGES) {
    test(`${path} hydrates with no violation`, async () => {
      const page = await (browser as Browser).newPage()
      const { errors } = await open(page, FLAG_ON_PORT, CANARY_HOST, path)
      await hydrated(page)
      expect(await violations(page), path).toEqual([])
      expect(errors, path).toEqual([])
      await page.close()
    })
  }

  for (const path of ['/no-such-file.png', '/no-such-file.html', '/_next/no-such-file', '/api/img/nope']) {
    test(`the 404 at ${path} hydrates with no violation`, async () => {
      const page = await (browser as Browser).newPage()
      const { errors } = await open(page, FLAG_ON_PORT, CANARY_HOST, path)
      await hydrated(page)
      expect(await violations(page), path).toEqual([])
      expect(errors, path).toEqual([])
      await page.close()
    })
  }

  test('the opt-out page draws under its policy, and a script in its markup does not run', async () => {
    const page = await (browser as Browser).newPage()
    const path = '/api/email/unsubscribe?token=harness'
    await open(page, FLAG_ON_PORT, CANARY_HOST, path, '<script>window.__ran = true</script>')
    await expect(page.getByRole('button', { name: 'Unsubscribe' })).toBeVisible()
    // Its inline styles apply: the button is the page's own colour, not the browser's grey.
    const background = await page.getByRole('button', { name: 'Unsubscribe' }).evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(background).toBe('rgb(30, 58, 95)')
    expect(await page.evaluate(() => window.__ran ?? false)).toBe(false)
    // Only the injected script. This API's Report-Only policy reports the same one.
    const enforced = (await violations(page)).filter((v) => v.disposition === 'enforce')
    expect(enforced.map((v) => v.directive)).toEqual(['script-src-elem'])
    await page.close()
  })

  // The control. Without it, a page that hydrated would pass with no policy at all.
  //
  // A script the page itself inserts is not on this list. 'strict-dynamic' trusts what a
  // running script adds, including inline text in Chromium, which is why the tree's own
  // imports are held by test/tenant-csp.test.ts. What the policy stops is markup that
  // reaches the document some other way, and what an untrusted line tries next.
  const INJECTED = '<script>window.__ran = true</script><img src="/x" onerror="window.__ran = true">'

  test('the policy stops injected markup, beacons, frames and eval', async () => {
    const page = await (browser as Browser).newPage()
    await open(page, FLAG_ON_PORT, CANARY_HOST, '/sign', INJECTED)
    await hydrated(page)
    const outcome = await page.evaluate(async () => {
      const handler = document.createElement('div')
      handler.setAttribute('onclick', 'window.__ran = true')
      document.body.appendChild(handler)
      handler.click()

      new Image().src = 'https://www.google-analytics.com/g/collect?v=2'
      const frame = document.createElement('iframe')
      frame.src = 'https://www.example.com/'
      document.body.appendChild(frame)
      const called = await fetch('https://www.google-analytics.com/g/collect').then(
        () => 'sent',
        () => 'refused',
      )
      // Off this evaluate's own stack: a browser lets its debugger past the policy.
      await new Promise((resolve) => setTimeout(resolve, 200))
      const evaluated = (() => {
        try {
          return (0, eval)('1 + 1')
        } catch {
          return 'refused'
        }
      })()
      return { ran: window.__ran ?? false, called, evaluated }
    })
    expect(outcome).toEqual({ ran: false, called: 'refused', evaluated: 'refused' })
    const seen = await violations(page)
    expect(seen.every((v) => v.disposition === 'enforce')).toBe(true)
    expect([...new Set(seen.map((v) => v.directive))].sort()).toEqual(['connect-src', 'frame-src', 'img-src', 'script-src', 'script-src-attr', 'script-src-elem'])
    await page.close()
  })

  // The other half of the control: the same injected markup under Stellr's policy.
  test('a Stellr host only reports that markup, and it runs', async () => {
    const page = await (browser as Browser).newPage()
    await open(page, FLAG_ON_PORT, 'localhost', '/sign', INJECTED)
    await hydrated(page)
    expect(await page.evaluate(() => window.__ran ?? false)).toBe(true)
    const seen = await violations(page)
    expect(seen.filter((v) => v.directive === 'script-src-elem').map((v) => v.disposition)).toContain('report')
    await page.close()
  })

  // What a tenant page needs most. The signing app's own bundle, under the real header:
  // only the JSON it asks for and the document are stood in for, because the harness has
  // no envelope. The PDF embeds a font so that pdf.js loads one, as a real agreement does.
  test('the signing page draws its document and shows its text version, with no violation', async () => {
    const pdf = await PDFDocument.create()
    pdf.registerFontkit(fontkit)
    const font = await pdf.embedFont(readFileSync('public/fonts/esign/OpenSans-Regular.ttf'), { subset: true })
    pdf.addPage().drawText('Harness agreement', { x: 50, y: 700, size: 24, font })
    const document = Buffer.from(await pdf.save())

    const page = await (browser as Browser).newPage()
    const json = (body: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    await page.route('**/api/sign/context', (route) =>
      route.fulfill(
        json({
          state: 'ready',
          view: {
            documentTitle: 'Harness agreement',
            eventTitle: null,
            roleLabel: 'Participant',
            signerName: 'Harness signer',
            disclosureVersion: 'v1',
            consented: true,
            attestation: null,
            fields: [],
            textHtml: '<!doctype html><style>p { color: #333 }</style><p>Text version</p><script>parent.__ran = true</script>',
          },
        }),
      ),
    )
    await page.route('**/api/sign/viewed', (route) => route.fulfill(json({})))
    await page.route('**/api/sign/document', (route) =>
      route.fulfill({ status: 200, contentType: 'application/pdf', body: document }),
    )

    const { errors } = await open(page, FLAG_ON_PORT, CANARY_HOST, '/sign')
    const drawn = page.locator('canvas[role="img"][aria-label="Page 1 of 1"]')
    await expect(drawn).toBeVisible({ timeout: 30_000 })

    // Not a blank canvas: a font pdf.js could not load draws nothing.
    const inked = await drawn.evaluate((canvas: HTMLCanvasElement) => {
      const { data } = (canvas.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, canvas.width, canvas.height)
      for (let i = 0; i < data.length; i += 4) if (data[i] < 128) return true
      return false
    })
    expect(inked).toBe(true)

    await page.getByRole('button', { name: 'Show the text version' }).click()
    const frame = page.frameLocator('iframe[title="Text version of the document"]')
    await expect(frame.locator('p')).toHaveText('Text version')

    expect(await page.evaluate(() => window.__ran ?? false)).toBe(false)
    // The sandboxed frame's own script is stopped by its sandbox. That reports nothing here.
    expect(await violations(page)).toEqual([])
    expect(errors).toEqual([])
    await page.close()
  })
})
