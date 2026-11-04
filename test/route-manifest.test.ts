// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ROUTE_CLASSES, ROUTE_MANIFEST, type RouteClass } from '@/lib/security/route-manifest'
import {
  BASE_GUARDS,
  CLASS_REQUIREMENTS,
  DELEGATE_GUARDS,
  GUARD_EXCEPTIONS,
  satisfies,
  type GuardKind,
} from '@/lib/security/route-guards'
import {
  HTTP_METHODS,
  analyzeDefaultExport,
  analyzeNamedExport,
  analyzeRoute,
  exportedNames,
  type HandlerFacts,
} from '@/lib/security/route-ast'

// S2 (multi-tenant plan): the route manifest and the AST guard check.
//   1. Every route handler and page under app/ is classified, and every entry
//      names a real file (the 100% classification gate).
//   2. Every handler calls the guard its class needs, found by parsing it with
//      the TypeScript compiler (lib/security/route-ast.ts), not by regex.
//   3. The exceptions list is pinned by count and cannot go stale.
// docs/SECURITY-route-manifest.md says how to classify a new route.
//
// This sits beside test/route-guards.test.ts and test/admin-page-guards.test.ts
// (the earlier regex sweeps), which stay as a second net.

// The number of grandfathered handlers in GUARD_EXCEPTIONS. Changing it is a
// deliberate act: an exception added without moving this number fails here.
const EXPECTED_EXCEPTIONS = 18

// Floors, so a broken walker or an emptied manifest cannot pass. The real
// numbers on 4 Nov 2026: 309 route files, 158 pages, 420 route handlers.
const MIN_ROUTE_FILES = 300
const MIN_PAGES = 150
const MIN_HANDLERS = 400

function isRouteFile(p: string) {
  return /(^|\/)route\.(ts|tsx|js|jsx)$/.test(p)
}
function isPageFile(p: string) {
  return /(^|\/)page\.(ts|tsx|js|jsx|md|mdx)$/.test(p)
}

const appFiles = (readdirSync('app', { recursive: true }) as string[])
  .map((p) => `app/${p.replace(/\\/g, '/')}`)
const ROUTE_FILES = appFiles.filter(isRouteFile).sort()
const PAGE_FILES = appFiles.filter(isPageFile).sort()

const src = (f: string) => readFileSync(f, 'utf8')

interface Checked {
  key: string
  file: string
  cls: RouteClass
  facts: HandlerFacts
}

// Every handler the guard check looks at, computed once.
const ROUTE_HANDLERS: Checked[] = ROUTE_FILES.filter((f) => f in ROUTE_MANIFEST).flatMap((file) =>
  analyzeRoute(file, src(file)).handlers.map((facts) => ({
    key: `${file}#${facts.name}`,
    file,
    cls: ROUTE_MANIFEST[file],
    facts,
  })),
)
const PAGE_HANDLERS: Checked[] = PAGE_FILES.filter((f) => f in ROUTE_MANIFEST).flatMap((file) => {
  const facts = analyzeDefaultExport(file, src(file))
  return facts ? [{ key: `${file}#default`, file, cls: ROUTE_MANIFEST[file], facts }] : []
})

function missingKinds(h: Checked, page: boolean): GuardKind[] {
  // A page has no rate-limit requirement: public pages are documents.
  const required = page && h.cls === 'public' ? [] : CLASS_REQUIREMENTS[h.cls].kinds
  const got = satisfies(h.facts.calls, h.facts.comparesRoleToAdmin)
  const missing = required.filter((k) => !got.has(k))
  const first = CLASS_REQUIREMENTS[h.cls].firstStatement
  if (first && !page) {
    const firstGot = satisfies(h.facts.firstStatementCalls, false)
    if (!firstGot.has(first)) missing.push(first)
  }
  return missing
}

describe('route manifest: 100% classification', () => {
  it('finds the routes and pages (the sweep is not empty)', () => {
    expect(ROUTE_FILES.length).toBeGreaterThanOrEqual(MIN_ROUTE_FILES)
    expect(PAGE_FILES.length).toBeGreaterThanOrEqual(MIN_PAGES)
  })

  it('classifies every route handler and page file', () => {
    const unclassified = [...ROUTE_FILES, ...PAGE_FILES].filter((f) => !(f in ROUTE_MANIFEST))
    expect(unclassified, 'add these to lib/security/route-manifest.ts').toEqual([])
  })

  it('has no entry for a file that no longer exists or is not a route or page', () => {
    const stale = Object.keys(ROUTE_MANIFEST).filter(
      (f) => !existsSync(f) || !(isRouteFile(f) || isPageFile(f)),
    )
    expect(stale, 'remove these from lib/security/route-manifest.ts').toEqual([])
    expect(Object.keys(ROUTE_MANIFEST).length).toBe(ROUTE_FILES.length + PAGE_FILES.length)
  })

  it('uses only the defined classes, and never webhook or cron for a page', () => {
    for (const [f, cls] of Object.entries(ROUTE_MANIFEST)) {
      expect(ROUTE_CLASSES, f).toContain(cls)
      if (isPageFile(f)) expect(['webhook', 'cron'], f).not.toContain(cls)
    }
  })

  it('classifies by the documented rules', () => {
    for (const [f, cls] of Object.entries(ROUTE_MANIFEST)) {
      if (f.startsWith('app/api/cron/')) expect(cls, f).toBe('cron')
      if (f.startsWith('app/api/webhooks/') || /\/webhook\/route\.ts$/.test(f)) expect(cls, f).toBe('webhook')
      if (f.startsWith('app/(admin)/')) expect(cls, f).toBe('stellr_only')
      // Every admin API is stellr_only until S5 converts it, except the one
      // Sanity calls with a shared secret.
      if (f.startsWith('app/api/admin/') && f !== 'app/api/admin/sanity/event-sync/route.ts') {
        expect(cls, f).toBe('stellr_only')
      }
      if (cls === 'cron') expect(f.startsWith('app/api/cron/'), f).toBe(true)
    }
    // Nothing is tenant-scoped until S5, so these classes are still empty.
    const used = new Set(Object.values(ROUTE_MANIFEST))
    expect(used.has('platform_admin')).toBe(false)
    expect(used.has('tenant_staff')).toBe(false)
  })

  it('every class in use has members (counts)', () => {
    const count = (c: RouteClass) => Object.values(ROUTE_MANIFEST).filter((v) => v === c).length
    expect(count('stellr_only')).toBeGreaterThan(180)
    expect(count('participant')).toBeGreaterThan(100)
    expect(count('public')).toBeGreaterThan(80)
    expect(count('webhook')).toBeGreaterThanOrEqual(12)
    expect(count('cron')).toBeGreaterThanOrEqual(20)
  })
})

describe('route manifest: AST guard check', () => {
  it('reads a handler out of every route file, and every exported method', () => {
    expect(ROUTE_HANDLERS.length).toBeGreaterThanOrEqual(MIN_HANDLERS)
    const methods = new Set<string>(HTTP_METHODS)
    for (const file of ROUTE_FILES) {
      const names = exportedNames(file, src(file))
      // `export * from` would hide handlers from the walker.
      expect(names, file).not.toContain('*')
      const found = analyzeRoute(file, src(file)).handlers.map((h) => h.name).sort()
      expect(found.length, `${file} exports no handler the walker can read`).toBeGreaterThan(0)
      expect(found, file).toEqual(names.filter((n) => methods.has(n)).sort())
    }
  })

  it('reads the default export of every page', () => {
    expect(PAGE_HANDLERS.length).toBe(PAGE_FILES.length)
  })

  it('every route handler calls the guard its class requires', () => {
    const failures = ROUTE_HANDLERS.filter((h) => !(h.key in GUARD_EXCEPTIONS))
      .map((h) => ({ h, missing: missingKinds(h, false) }))
      .filter(({ missing }) => missing.length > 0)
      .map(({ h, missing }) => `${h.key} (${h.cls}) is missing: ${missing.join(', ')}`)
    expect(failures).toEqual([])
  })

  it('every page calls the guard its class requires', () => {
    const failures = PAGE_HANDLERS.filter((h) => !(h.key in GUARD_EXCEPTIONS))
      .map((h) => ({ h, missing: missingKinds(h, true) }))
      .filter(({ missing }) => missing.length > 0)
      .map(({ h, missing }) => `${h.key} (${h.cls}) is missing: ${missing.join(', ')}`)
    expect(failures).toEqual([])
  })

  it('crons call guardCron in their first statement', () => {
    const crons = ROUTE_HANDLERS.filter((h) => h.cls === 'cron')
    expect(crons.length).toBeGreaterThanOrEqual(20)
    for (const h of crons) expect(h.facts.firstStatementCalls.has('guardCron'), h.key).toBe(true)
  })
})

describe('route manifest: shared guard helpers really guard', () => {
  // Resolve each delegate's kinds from its source, following other delegates.
  const memo = new Map<string, Set<GuardKind>>()
  function kindsOf(name: string, stack: string[] = []): Set<GuardKind> {
    const cached = memo.get(name)
    if (cached) return cached
    const d = DELEGATE_GUARDS[name]
    const facts = analyzeNamedExport(d.file, src(d.file), name)
    if (!facts) throw new Error(`${name} is not exported from ${d.file}`)
    const out = new Set<GuardKind>()
    for (const [kind, names] of Object.entries(BASE_GUARDS) as [GuardKind, readonly string[]][]) {
      if (names.some((n) => facts.calls.has(n))) out.add(kind)
    }
    if (facts.comparesRoleToAdmin) out.add('admin')
    for (const other of Object.keys(DELEGATE_GUARDS)) {
      if (other !== name && !stack.includes(other) && facts.calls.has(other)) {
        for (const k of kindsOf(other, [...stack, name])) out.add(k)
      }
    }
    if (out.has('admin')) out.add('session')
    memo.set(name, out)
    return out
  }

  it('lists a real number of delegates', () => {
    expect(Object.keys(DELEGATE_GUARDS).length).toBeGreaterThanOrEqual(20)
  })

  for (const [name, { file, kinds }] of Object.entries(DELEGATE_GUARDS)) {
    it(`${name} (${file}) reaches a ${kinds.join(' and ')} check`, () => {
      const got = kindsOf(name)
      for (const k of kinds) expect(got.has(k), `${name} does not reach a ${k} check`).toBe(true)
    })
  }
})

describe('route manifest: grandfathered exceptions', () => {
  it(`has exactly ${EXPECTED_EXCEPTIONS} entries (the list cannot grow silently)`, () => {
    expect(Object.keys(GUARD_EXCEPTIONS).length).toBe(EXPECTED_EXCEPTIONS)
  })

  it('every entry gives a reason', () => {
    for (const [k, why] of Object.entries(GUARD_EXCEPTIONS)) expect(why.trim().length, k).toBeGreaterThan(15)
  })

  it('every entry names a real handler that still needs the exception', () => {
    const all = new Map([...ROUTE_HANDLERS, ...PAGE_HANDLERS].map((h) => [h.key, h]))
    for (const key of Object.keys(GUARD_EXCEPTIONS)) {
      const h = all.get(key)
      expect(h, `${key} is in GUARD_EXCEPTIONS but no such handler exists`).toBeDefined()
      const page = key.endsWith('#default')
      expect(missingKinds(h!, page).length, `${key} now passes its guard check; remove the exception`).toBeGreaterThan(0)
    }
  })
})

describe('route-ast analyser (fixtures)', () => {
  const route = (code: string) => analyzeRoute('fixture/route.ts', code).handlers

  it('follows same-file helpers and resolves import aliases', () => {
    const [h] = route(`
      import { auth as clerkAuth } from '@clerk/nextjs/server'
      async function who() { return clerkAuth() }
      export async function GET() { await who(); return new Response() }
    `)
    expect(h.name).toBe('GET')
    expect(satisfies(h.calls, h.comparesRoleToAdmin).has('session')).toBe(true)
  })

  it('does not trust a same-file function that borrows a guard name', () => {
    const [h] = route(`
      function getCurrentMember() { return { id: 'x' } }
      export async function POST() { getCurrentMember(); return new Response() }
    `)
    expect(satisfies(h.calls, false).has('session')).toBe(false)
  })

  it('detects the inline role check', () => {
    const [h] = route(`
      export async function GET() {
        const { sessionClaims } = await auth()
        if (sessionClaims?.metadata?.role !== 'admin') return new Response(null, { status: 403 })
        return new Response()
      }
    `)
    expect(h.comparesRoleToAdmin).toBe(true)
    expect(satisfies(h.calls, h.comparesRoleToAdmin).has('admin')).toBe(true)
  })

  it('reports only the first statement for the cron rule', () => {
    const [ok] = route(`export async function GET(req) { const blocked = guardCron(req); if (blocked) return blocked; return run() }`)
    const [late] = route(`export async function GET(req) { await work(); const blocked = guardCron(req); return blocked }`)
    expect(ok.firstStatementCalls.has('guardCron')).toBe(true)
    expect(late.firstStatementCalls.has('guardCron')).toBe(false)
    expect(late.calls.has('guardCron')).toBe(true)
  })

  it('reads const, re-exported and wrapped handlers', () => {
    const hs = route(`
      async function impl() { return verify() }
      export const POST = withLogging(impl)
      function get() { return new Response() }
      export { get as GET }
    `)
    expect(hs.map((h) => h.name).sort()).toEqual(['GET', 'POST'])
    expect(hs.find((h) => h.name === 'POST')!.calls.has('verify')).toBe(true)
  })

  it('follows a local component rendered by a page', () => {
    const facts = analyzeDefaultExport(
      'fixture/page.tsx',
      `async function Data() { await requireAdminPage(); return null }
       export default function Page() { return <main><Data /></main> }`,
    )!
    expect(satisfies(facts.calls, false).has('admin')).toBe(true)
  })

  it('does not count a guard that is only mentioned in a comment or string', () => {
    const [h] = route(`
      // requireAdminPage() is not called here
      export async function GET() { return new Response('isAdminClaims') }
    `)
    expect(satisfies(h.calls, h.comparesRoleToAdmin).size).toBe(0)
  })
})
