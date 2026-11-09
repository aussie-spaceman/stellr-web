// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import nextConfig from '../next.config.mjs'
import { pageFiles } from '../e2e/tenancy/page-routes'
import { importClosure, readRepoFile } from './import-closure'

// S5 B5c: Stellr and the tenant tree have separate root layouts. A nested layout cannot
// take a head script or JSON-LD back out, so a tenant page is kept clear of them only
// by what sits above it. These tests read that chain from the tree. What it reaches a
// browser as is e2e/tenancy/stellr-document.spec.ts, on a real build.

const STELLR_ROOT = 'app/(stellr)/layout.tsx'
const TENANT_ROOT = 'app/%5Ft/[tenant]/layout.tsx'

/** Every layout above a file, outermost first, as Next would nest them. */
function layoutChain(file: string, exists: (rel: string) => boolean = (rel) => existsSync(rel)): string[] {
  const chain: string[] = []
  const parts = file.split('/').slice(0, -1)
  for (let depth = 1; depth <= parts.length; depth += 1) {
    const layout = `${parts.slice(0, depth).join('/')}/layout.tsx`
    if (exists(layout)) chain.push(layout)
  }
  return chain
}

/** What a chain renders: each layout's closure, so a layout that delegates still counts. */
function chainReaches(chain: string[]): Set<string> {
  return new Set(chain.flatMap((layout) => [...importClosure(layout, readRepoFile)]))
}

const CONSENT_MODE = 'components/analytics/ConsentMode.tsx'
const SITE_TRACKING = 'components/analytics/SiteTracking.tsx'
const JSON_LD = 'components/seo/JsonLd.tsx'
const STRUCTURED_DATA = 'lib/structured-data.ts'

const pages = pageFiles()
const stellrPages = pages.filter((file) => !file.startsWith('app/%5Ft/'))
const tenantPages = pages.filter((file) => file.startsWith('app/%5Ft/'))

/** The elements a layout renders by name, with comments out of the way. */
function rendered(rel: string): string {
  return readFileSync(rel, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

describe('the layout chain above a page', () => {
  it('has no shared root: a layout at app/ would sit above both trees', () => {
    expect(existsSync('app/layout.tsx')).toBe(false)
    expect(existsSync('app/template.tsx')).toBe(false)
    // Next would treat a not-found here as the root's, and there is no root to put it under.
    expect(existsSync('app/not-found.tsx')).toBe(false)
  })

  it('finds pages in both trees', () => {
    expect(stellrPages.length).toBeGreaterThan(150)
    expect(tenantPages.length).toBeGreaterThan(10)
  })

  it("starts at Stellr's root layout for every Stellr page, so moving between them stays a client navigation", () => {
    expect(stellrPages.filter((file) => layoutChain(file)[0] !== STELLR_ROOT)).toEqual([])
  })

  it("starts at the tenant root layout for every tenant page", () => {
    expect(tenantPages.filter((file) => layoutChain(file)[0] !== TENANT_ROOT)).toEqual([])
  })

  it('has one root each: no layout below a root renders its own document', () => {
    const layouts = (dir: string): string[] =>
      readdirSync(dir, { recursive: true, encoding: 'utf8' })
        .map((rel) => path.posix.join(dir, rel.split(path.sep).join('/')))
        .filter((rel) => rel.endsWith('/layout.tsx'))
    const nested = [...layouts('app/(stellr)'), ...layouts('app/%5Ft')].filter((rel) => rel !== STELLR_ROOT && rel !== TENANT_ROOT)
    expect(nested.length).toBeGreaterThan(3)
    expect(nested.filter((rel) => /<html\b|<body\b/.test(rendered(rel)))).toEqual([])
  })
})

describe("Stellr's root layout", () => {
  const reaches = chainReaches(layoutChain('app/(stellr)/(public)/about/page.tsx'))
  const document = rendered('app/(stellr)/document.tsx')

  it('reaches ConsentMode, SiteTracking and the JSON-LD', () => {
    for (const file of [CONSENT_MODE, SITE_TRACKING, JSON_LD, STRUCTURED_DATA]) expect(reaches.has(file), file).toBe(true)
  })

  it('renders them, with ConsentMode ahead of anything that could load a tag', () => {
    expect(document).toMatch(/<head>\s*(\{[\s\S]*?\}\s*)?<ConsentMode \/>\s*<JsonLd data=\{siteSchema\} \/>\s*<\/head>/)
    expect(document).toMatch(/<body>[\s\S]*<SiteTracking \/>[\s\S]*<\/body>/)
  })

  it('carries the metadata, including both verification tags', () => {
    expect(rendered(STELLR_ROOT)).toMatch(/export const metadata = stellrMetadata/)
    expect(rendered(STELLR_ROOT)).toMatch(/export const viewport = stellrViewport/)
    expect(document).toContain('NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION')
    expect(document).toContain('NEXT_PUBLIC_BING_SITE_VERIFICATION')
    expect(document).toContain("siteName: 'Stellr Education'")
  })

  it('reads nothing from the request, so Stellr pages stay prerendered', () => {
    expect(document).not.toMatch(/next\/headers|\bheaders\(\)|\bcookies\(\)/)
    expect(rendered(STELLR_ROOT)).not.toMatch(/next\/headers|\bheaders\(\)|\bcookies\(\)/)
  })

  it('is what a URL no page answers gets too', () => {
    const notFound = rendered('app/global-not-found.tsx')
    expect(notFound).toContain('<StellrDocument>')
    expect(notFound).toMatch(/\.\.\.stellrMetadata/)
    expect(notFound).toContain('export const viewport = stellrViewport')
  })

  // These also show on a real build, in a CI job that blocks nothing until the owner
  // says otherwise, so the ones a source read can see fail here too.
  it('keeps the title template and the browser colour', () => {
    expect(document).toContain("template: '%s | Stellr Education'")
    expect(document).toContain("default: 'Stellr Education — Real-World STEM Competitions'")
    expect(document).toContain('themeColor: tokens.color.midnight')
    expect(document).toContain("viewportFit: 'cover'")
  })
})

describe('what next.config.mjs does for the split', () => {
  const rewrites = () => nextConfig.rewrites!() as unknown as Promise<{
    afterFiles: { source: string; destination: string }[]
    fallback: { source: string; destination: string; missing: { type: string; value: string }[] }[]
  }>

  it('turns on the root that a URL no page answers needs', () => {
    expect((nextConfig.experimental as { globalNotFound?: boolean }).globalNotFound).toBe(true)
  })

  it('keeps both old share card names answering, in the shape the new name has', async () => {
    const { afterFiles } = await rewrites()
    expect(afterFiles).toContainEqual({ source: '/lp/:slug/opengraph-image-k8l0a9', destination: '/lp/:slug/opengraph-image-1ypvlb' })
    expect(afterFiles).toContainEqual({
      source: '/credentials/:number/opengraph-image-14f88v',
      destination: '/credentials/:number/opengraph-image-bboc2v',
    })
  })

  it('sends a miss on a host that is not Stellr’s to the tenant catch-all, and only there', async () => {
    const { fallback } = await rewrites()
    expect(fallback).toHaveLength(1)
    expect(fallback[0].source).toBe('/:path*')
    expect(fallback[0].missing).toHaveLength(1)
    expect(fallback[0].missing[0].type).toBe('host')
    // No parameter in the destination, so a path can never pick a real tenant page.
    expect(fallback[0].destination).toBe('/_t/no-tenant/no-page')
    expect(existsSync('app/%5Ft/[tenant]/[...rest]/page.tsx')).toBe(true)
    expect(existsSync('app/%5Ft/[tenant]/no-page')).toBe(false)
  })
})

describe('the tenant root layout', () => {
  const reaches = chainReaches(layoutChain(tenantPages[0]))

  it('holds neither ConsentMode nor SiteTracking anywhere in its parent chain', () => {
    expect(layoutChain(TENANT_ROOT)).toEqual([TENANT_ROOT])
    expect(reaches.has(CONSENT_MODE)).toBe(false)
    expect(reaches.has(SITE_TRACKING)).toBe(false)
  })

  it('holds no JSON-LD, and nothing else of Stellr document', () => {
    expect(reaches.has(JSON_LD)).toBe(false)
    expect(reaches.has(STRUCTURED_DATA)).toBe(false)
    expect(reaches.has('app/(stellr)/document.tsx')).toBe(false)
  })

  it('reaches no analytics at all', () => {
    expect([...reaches].filter((file) => file.startsWith('components/analytics/') || file === 'lib/analytics.ts' || file === 'lib/gtm.ts')).toEqual([])
  })

  it("renders its own document, with no script of its own and no Stellr wording", () => {
    const layout = rendered(TENANT_ROOT)
    expect(layout).toMatch(/<html\b/)
    expect(layout).toMatch(/<body\b/)
    expect(layout).not.toMatch(/<script\b|next\/script|dangerouslySetInnerHTML/)
    expect(layout).not.toMatch(/stellr/i)
    expect(layout).not.toMatch(/verification|openGraph|twitter/)
  })

  it('stops search engines indexing a tenant page', () => {
    expect(rendered(TENANT_ROOT)).toContain('robots: { index: false, follow: false }')
  })
})

describe('the check itself', () => {
  it('walks a chain from the outermost layout in', () => {
    const present = new Set(['app/layout.tsx', 'app/(a)/layout.tsx', 'app/(a)/b/layout.tsx'])
    expect(layoutChain('app/(a)/b/c/page.tsx', (rel) => present.has(rel))).toEqual(['app/layout.tsx', 'app/(a)/layout.tsx', 'app/(a)/b/layout.tsx'])
  })

  it('would see a root layout above the tenant tree', () => {
    const present = new Set(['app/layout.tsx', TENANT_ROOT])
    expect(layoutChain(`app/%5Ft/[tenant]/page.tsx`, (rel) => present.has(rel))[0]).toBe('app/layout.tsx')
  })

  it('fires on the real tracking mount, through the layout that delegates to it', () => {
    expect(chainReaches([STELLR_ROOT]).has(SITE_TRACKING)).toBe(true)
  })
})
