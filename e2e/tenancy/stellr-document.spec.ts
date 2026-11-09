import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { CANARY_HOST, FLAG_OFF_PORT, FLAG_ON_PORT, HARNESS_APP_HOST, UNKNOWN_ZONE_HOST, mapLimit, rawGet } from '../fixtures/tenant-hosts'
import { addToCapture, compareStored, documentShape, emptyCapture, serialiseCapture, shortSha, type Capture } from './document-shape'
import { SAMPLED_PATHS, pageFiles, pagePathForFile } from './page-routes'

/**
 * B5c's gate on the root layout split (S5). flag-parity.spec.ts compares two servers
 * running one build, so it cannot see a tag this move drops. This compares two builds:
 *
 *   stellr-document-base.json  captured from a harness build of the merge base
 *   stellr-document-split.json a frozen copy of the head capture at the split
 *   stellr-document-head.json  captured from a harness build of this tree
 *
 * document-shape.test.ts holds base and split equal, once. This spec holds the head
 * capture to the build in front of it, so head cannot be left behind by a change to a
 * page's tags, status or headers. The body is compared only while the sources are the
 * ones captured: a later copy change is not this gate's business.
 *
 * A later PR that changes a page's tags regenerates head only, on this one build:
 *
 *   node e2e/tenancy/build-harness.mjs
 *   E2E_DOCUMENT_CAPTURE=head npx playwright test -c playwright.tenant-hosts.config.ts stellr-document
 *
 * While the split itself is still changing, take head that way, copy it over split, and
 * if dev moved past the merge base take base too: run the same with
 * E2E_DOCUMENT_CAPTURE=base in a checkout of the merge base, with e2e/tenancy,
 * e2e/fixtures/tenant-hosts.ts and playwright.tenant-hosts.config.ts copied in from this
 * branch, and bring the file back.
 *
 * A difference here is a live change to Stellr's pages. Regenerate only after reading
 * what changed and deciding it is meant.
 */

const CAPTURE_FILES = { base: 'e2e/tenancy/stellr-document-base.json', head: 'e2e/tenancy/stellr-document-head.json' }
const PATHS = [
  ...new Set([
    ...pageFiles().map(pagePathForFile),
    ...SAMPLED_PATHS,
    // Real records the build holds, with an og:image route of their own.
    '/lp/first-robotics-teachers',
    '/lp/homeschool-students',
    // What no page answers, and what serves the answer has to move with the root layout.
    '/no-such-page',
    '/no/such/nested/page',
    '/api/no-such-route',
  ]),
]
// One for each branch of the proxy. flag-parity.spec.ts holds every Stellr host to these.
const CAPTURED_HOSTS = ['www.stellreducation.org', HARNESS_APP_HOST]
const PASSES: { name: string; headers: Record<string, string> }[] = [
  { name: 'plain', headers: {} },
  { name: 'browser', headers: { Accept: 'text/html', 'Sec-Fetch-Dest': 'document' } },
]
const SOURCE_DIRS = ['app', 'components', 'lib', 'packages', 'styles']

/** Whether the tree is the one a capture was taken from. Tracked files only, as a checkout has no others. */
function sourcesSha(): string {
  const tracked = execFileSync('git', ['ls-files', '-z', '--', ...SOURCE_DIRS], { encoding: 'utf8', maxBuffer: 1 << 26 })
  const files = tracked.split('\0').filter((file) => file && !/\.(test|stories)\.tsx?$/.test(file))
  return shortSha(files.map((file) => shortSha(readFileSync(file))).sort().join('\n'))
}

async function captureNow(): Promise<Capture> {
  const mode = process.env.E2E_DOCUMENT_CAPTURE
  const commit = mode === 'base' ? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() : null
  const capture = emptyCapture(commit, sourcesSha())
  // Warm first, so a page that fills a cache on its first answer is read after it has.
  await mapLimit(PATHS, 8, (path) => rawGet(FLAG_OFF_PORT, 'localhost', path))
  for (const host of CAPTURED_HOSTS) {
    for (const pass of PASSES) {
      await mapLimit(PATHS, 8, async (path) => {
        const res = await rawGet(FLAG_OFF_PORT, host, path, pass.headers)
        addToCapture(capture, `${host} ${path} ${pass.name}`, documentShape(res, FLAG_OFF_PORT))
      })
    }
  }
  return capture
}

const captureMode = process.env.E2E_DOCUMENT_CAPTURE as keyof typeof CAPTURE_FILES | undefined

if (captureMode) {
  test(`capture Stellr's documents as ${captureMode}`, async () => {
    expect(Object.keys(CAPTURE_FILES)).toContain(captureMode)
    const capture = await captureNow()
    writeFileSync(CAPTURE_FILES[captureMode], serialiseCapture(capture))
    console.log(`${Object.keys(capture.entries).length} answers, ${Object.keys(capture.tagSets).length} sets of tags`)
  })
} else {
  test('this build still answers as its capture says', async () => {
    expect(existsSync(CAPTURE_FILES.head), 'No head capture: see the top of this file').toBe(true)
    const stored = JSON.parse(readFileSync(CAPTURE_FILES.head, 'utf8')) as Capture
    const live = await captureNow()
    const compareBody = stored.sourcesSha === live.sourcesSha
    console.log(compareBody ? 'Sources as captured: bodies compared' : 'Sources moved on since the capture: bodies not compared')
    const keys = Object.keys(stored.entries).filter((key) => key in live.entries)
    expect(keys.length).toBeGreaterThan(600)
    const differing = keys.flatMap((key) =>
      compareStored(stored, live, key, { body: compareBody }).map((difference) => `${key}: ${difference}`),
    )
    expect(differing).toEqual([])
    // A path the capture has and this tree does not: a page went away.
    expect(Object.keys(stored.entries).filter((key) => !(key in live.entries))).toEqual([])
  })
}

// These hold with routing on, on a host the map gives to a tenant. The chain itself is
// test/root-layout-split.test.ts, and this is what that chain reaches a browser as.
const TENANT_PATHS = ['/', '/sign', '/check-in', '/sign/copy']

test('a tenant page carries nothing of Stellr in its document', async () => {
  for (const path of TENANT_PATHS) {
    const { status, body } = await rawGet(FLAG_ON_PORT, CANARY_HOST, path)
    expect(status, path).toBe(200)
    const head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(body)?.[1] ?? ''
    expect(head, path).not.toBe('')
    expect(body, path).not.toContain('application/ld+json')
    expect(body, path).not.toContain('harness-google-verification')
    expect(body, path).not.toContain('harness-bing-verification')
    expect(body, path).not.toContain('dataLayer')
    expect(head, path).not.toContain('Stellr')
    expect(head, path).not.toContain('og:')
    expect(head, path).not.toContain('twitter:')
    expect(head, path).toContain('name="robots" content="noindex, nofollow"')
    // The layout adds no inline script for a policy to block.
    expect([...head.matchAll(/<script\b([^>]*)>/gi)].filter(([, attrs]) => !/\bsrc="/.test(attrs)), path).toEqual([])
  }
})

// Three ways past the tenant tree's own catch-all: a static extension the proxy passes on,
// the /_next prefix and the two bypass routes, which skip the proxy. No file and no page
// answers any of these, so without next.config.mjs's fallback rewrite Next would draw
// app/global-not-found.tsx, which is Stellr's whole document.
const TENANT_HOST_MISSES = [
  '/no-such-file.png',
  '/about.png',
  '/images/no-such.png',
  '/no-such-file.html',
  '/_next/no-such-file',
  '/_next/static/no-such-file.js',
  '/api/csp-report/nope',
  '/api/img/nope',
]

test('a tenant host answers a URL with no page or file without any of Stellr’s document', async () => {
  // Both servers: the rewrite is in the build, so it does not wait for the routing flag.
  for (const port of [FLAG_ON_PORT, FLAG_OFF_PORT]) {
    for (const host of [CANARY_HOST, UNKNOWN_ZONE_HOST]) {
      for (const path of TENANT_HOST_MISSES) {
        const where = `${port} ${host} ${path}`
        const { status, body } = await rawGet(port, host, path)
        expect(status, where).toBe(404)
        expect(body, where).not.toContain('application/ld+json')
        expect(body, where).not.toContain('harness-google-verification')
        expect(body, where).not.toContain('harness-bing-verification')
        expect(body, where).not.toContain('dataLayer')
        expect(body, where).not.toContain('data-consent-needed')
        expect(body, where).not.toContain('Stellr Education')
        expect(body, where).not.toContain('Skip to content')
      }
    }
  }
})

// The control for the test above: the rewrite is keyed on the host, so these must not move.
test('a Stellr host still answers those URLs with its own 404, and a tenant host still gets real files', async () => {
  for (const host of ['localhost', 'www.stellreducation.org', HARNESS_APP_HOST]) {
    for (const path of ['/no-such-file.png', '/images/no-such.png', '/api/csp-report/nope']) {
      const { status, body } = await rawGet(FLAG_ON_PORT, host, path)
      expect(status, `${host} ${path}`).toBe(404)
      expect(body, `${host} ${path}`).toContain('dataLayer')
      expect(body, `${host} ${path}`).toContain('Stellr Education')
    }
  }
  for (const path of ['/images/og-default.jpg', '/favicon.ico']) {
    expect((await rawGet(FLAG_ON_PORT, CANARY_HOST, path)).status, path).toBe(200)
  }
})

// A named exception, not a pass: these files sit above both root layouts, so a tenant
// document links Stellr's icons and manifest, and `not.toContain('Stellr')` above cannot
// see that through their URLs. docs/TENANCY-S5.md keeps it as a decision for tenant
// branding. When that lands, this list goes empty.
test('a tenant page links only the icons and manifest named here from above its root', async () => {
  const { body } = await rawGet(FLAG_ON_PORT, CANARY_HOST, '/')
  const head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(body)?.[1] ?? ''
  const rels = [...head.matchAll(/<link\b[^>]*\brel="([^"]+)"/gi)].map((match) => match[1])
  const fromAbove = rels.filter((rel) => !['preload', 'stylesheet', 'preconnect', 'dns-prefetch'].includes(rel))
  expect([...new Set(fromAbove)].sort()).toEqual(['apple-touch-icon', 'icon', 'manifest'])
  const manifest = await rawGet(FLAG_ON_PORT, CANARY_HOST, '/manifest.webmanifest')
  expect(manifest.status).toBe(200)
  expect(manifest.body).toContain('Stellr Education')
})

// Without this, a capture of pages that lost the tags would hold itself equal.
test('a Stellr page carries the tags the split moved', async () => {
  const pages: [string, string][] = [
    ['localhost', '/about'],
    ['www.stellreducation.org', '/about'],
    ['www.stellreducation.org', '/sign'],
    ['localhost', '/no-such-page'],
    [HARNESS_APP_HOST, '/sign-in'],
  ]
  for (const [host, path] of pages) {
    const { body } = await rawGet(FLAG_OFF_PORT, host, path)
    const where = `${host} ${path}`
    expect(body, where).toContain('application/ld+json')
    expect(body, where).toContain('harness-google-verification')
    expect(body, where).toContain('harness-bing-verification')
    expect(body, where).toContain('dataLayer')
    expect(body, where).toContain('property="og:site_name" content="Stellr Education"')
  }
})

test('a share card keeps answering at the name it had before the move', async () => {
  const pairs = [
    ['/lp/first-robotics-teachers/opengraph-image-k8l0a9', '/lp/first-robotics-teachers/opengraph-image-1ypvlb'],
    ['/credentials/harness-number/opengraph-image-14f88v', '/credentials/harness-number/opengraph-image-bboc2v'],
  ]
  for (const [before, after] of pairs) {
    const [old, current] = await Promise.all([rawGet(FLAG_OFF_PORT, 'localhost', before), rawGet(FLAG_OFF_PORT, 'localhost', after)])
    expect(current.status, after).not.toBe(404)
    expect(old.status, before).toBe(current.status)
    expect(old.headers['content-type'], before).toBe(current.headers['content-type'])
  }
})
