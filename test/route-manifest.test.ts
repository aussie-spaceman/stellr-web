// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ROUTE_CLASSES, ROUTE_MANIFEST, type RouteClass } from '@/lib/security/route-manifest'
import {
  CLASS_REQUIREMENTS,
  DATA_READERS,
  DELEGATE_GUARDS,
  GUARD_EXCEPTIONS,
  PUBLIC_DATA_GATES,
  baseKinds,
  calledFrom,
  callsDelegate,
  satisfies,
  type GuardKind,
} from '@/lib/security/route-guards'
import {
  HTTP_METHODS,
  analyzeDefaultExport,
  analyzeNamedExport,
  analyzeRoute,
  exportedNames,
  resolveModule,
  type HandlerFacts,
} from '@/lib/security/route-ast'

// S2 (multi-tenant plan): the route manifest and the AST guard check.
//   1. Every route handler, metadata route and page under app/ is classified,
//      and every entry names a real file (the 100% classification gate).
//   2. Every handler calls the guard its class needs, found by parsing it with
//      the TypeScript compiler (lib/security/route-ast.ts), not by regex, and
//      accepted only from the module the guard really lives in.
//   3. The exceptions list is pinned by count and cannot go stale.
// docs/SECURITY-route-manifest.md says how to classify a new route.
//
// This sits beside test/route-guards.test.ts and test/admin-page-guards.test.ts
// (the earlier regex sweeps), which stay as a second net.

// The number of grandfathered handlers in GUARD_EXCEPTIONS. Changing it is a
// deliberate act: an exception added without moving this number fails here.
const EXPECTED_EXCEPTIONS = 18
// Likewise for PUBLIC_DATA_GATES (public metadata routes that read the database).
const EXPECTED_DATA_GATES = 1

// Floors, so a broken walker or an emptied manifest cannot pass. The real
// numbers on 4 Nov 2026: 309 route files, 5 metadata routes, 158 pages,
// 420 route handlers.
const MIN_ROUTE_FILES = 300
const MIN_METADATA_FILES = 5
const MIN_PAGES = 150
const MIN_HANDLERS = 400

function isRouteFile(p: string) {
  return /(^|\/)route\.(ts|tsx|js|jsx)$/.test(p)
}
// Next's metadata file conventions that run code: each is served as a GET
// route handler from its default export. (Static images such as icon.png are
// files, not code, and are not listed.)
function isMetadataFile(p: string) {
  return (
    /(^|\/)(opengraph-image|twitter-image|icon|apple-icon)\d*\.(ts|tsx|js|jsx)$/.test(p) ||
    /(^|\/)(sitemap|robots|manifest)\.(ts|js)$/.test(p)
  )
}
function isPageFile(p: string) {
  return /(^|\/)page\.(ts|tsx|js|jsx|md|mdx)$/.test(p)
}

const appFiles = (readdirSync('app', { recursive: true }) as string[])
  .map((p) => `app/${p.replace(/\\/g, '/')}`)
const ROUTE_FILES = appFiles.filter(isRouteFile).sort()
const METADATA_FILES = appFiles.filter(isMetadataFile).sort()
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
const defaultHandlers = (files: string[]): Checked[] =>
  files.filter((f) => f in ROUTE_MANIFEST).flatMap((file) => {
    const facts = analyzeDefaultExport(file, src(file))
    return facts ? [{ key: `${file}#default`, file, cls: ROUTE_MANIFEST[file], facts }] : []
  })
const PAGE_HANDLERS = defaultHandlers(PAGE_FILES)
const METADATA_HANDLERS = defaultHandlers(METADATA_FILES)

function missingKinds(h: Checked, page: boolean): GuardKind[] {
  // A page has no rate-limit requirement: public pages are documents.
  const required = page && h.cls === 'public' ? [] : CLASS_REQUIREMENTS[h.cls].kinds
  const got = satisfies(h.facts)
  const missing = required.filter((k) => !got.has(k))
  const first = CLASS_REQUIREMENTS[h.cls].firstStatement
  if (first && !page) {
    const firstGot = satisfies({ ...h.facts, calls: h.facts.firstStatementCalls, comparesRoleToAdmin: false })
    if (!firstGot.has(first)) missing.push(first)
  }
  return missing
}

const readsData = (f: HandlerFacts) => Object.entries(DATA_READERS).some(([n, from]) => calledFrom(f, n, from))

describe('route manifest: 100% classification', () => {
  it('finds the routes, metadata routes and pages (the sweep is not empty)', () => {
    expect(ROUTE_FILES.length).toBeGreaterThanOrEqual(MIN_ROUTE_FILES)
    expect(METADATA_FILES.length).toBeGreaterThanOrEqual(MIN_METADATA_FILES)
    expect(PAGE_FILES.length).toBeGreaterThanOrEqual(MIN_PAGES)
    // The two dynamic share cards are the reason metadata routes are swept.
    expect(METADATA_FILES).toContain('app/(public)/credentials/[number]/opengraph-image.tsx')
    expect(METADATA_FILES).toContain('app/(public)/lp/[slug]/opengraph-image.tsx')
  })

  it('classifies every route handler, metadata route and page file', () => {
    const unclassified = [...ROUTE_FILES, ...METADATA_FILES, ...PAGE_FILES].filter((f) => !(f in ROUTE_MANIFEST))
    expect(unclassified, 'add these to lib/security/route-manifest.ts').toEqual([])
  })

  it('has no entry for a file that no longer exists or is not a route, metadata route or page', () => {
    const stale = Object.keys(ROUTE_MANIFEST).filter(
      (f) => !existsSync(f) || !(isRouteFile(f) || isMetadataFile(f) || isPageFile(f)),
    )
    expect(stale, 'remove these from lib/security/route-manifest.ts').toEqual([])
    expect(Object.keys(ROUTE_MANIFEST).length).toBe(ROUTE_FILES.length + METADATA_FILES.length + PAGE_FILES.length)
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
      // Crawlers and unfurlers fetch metadata routes with no session.
      if (isMetadataFile(f)) expect(cls, f).toBe('public')
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

  it('reads the default export of every page and metadata route', () => {
    expect(PAGE_HANDLERS.length).toBe(PAGE_FILES.length)
    expect(METADATA_HANDLERS.length).toBe(METADATA_FILES.length)
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

  it('crons call guardCron (from lib/cron) in their first statement', () => {
    const crons = ROUTE_HANDLERS.filter((h) => h.cls === 'cron')
    expect(crons.length).toBeGreaterThanOrEqual(20)
    for (const h of crons) {
      expect(h.facts.firstStatementCalls.has('guardCron'), h.key).toBe(true)
      expect(calledFrom(h.facts, 'guardCron', ['lib/cron']), h.key).toBe(true)
    }
  })
})

describe('route manifest: public metadata routes that read data', () => {
  it(`has exactly ${EXPECTED_DATA_GATES} PUBLIC_DATA_GATES entries, each with a reason`, () => {
    expect(Object.keys(PUBLIC_DATA_GATES).length).toBe(EXPECTED_DATA_GATES)
    for (const [k, g] of Object.entries(PUBLIC_DATA_GATES)) expect(g.why.trim().length, k).toBeGreaterThan(15)
  })

  it('every metadata route that reads the database is listed in PUBLIC_DATA_GATES', () => {
    const unlisted = METADATA_HANDLERS.filter((h) => readsData(h.facts) && !(h.key in PUBLIC_DATA_GATES)).map((h) => h.key)
    expect(unlisted, 'list these in PUBLIC_DATA_GATES with the checks they must reach').toEqual([])
  })

  it('every PUBLIC_DATA_GATES route still reads data and reaches each listed check', () => {
    const all = new Map(METADATA_HANDLERS.map((h) => [h.key, h]))
    for (const [key, gate] of Object.entries(PUBLIC_DATA_GATES)) {
      const h = all.get(key)
      expect(h, `${key} is in PUBLIC_DATA_GATES but no such metadata route exists`).toBeDefined()
      expect(readsData(h!.facts), `${key} no longer reads the database; remove it`).toBe(true)
      for (const [name, from] of Object.entries(gate.calls)) {
        expect(calledFrom(h!.facts, name, from), `${key} no longer calls ${name}`).toBe(true)
      }
      for (const c of gate.compares) expect(h!.facts.compares.has(c), `${key} no longer checks ${c}`).toBe(true)
    }
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
    const out = baseKinds(facts)
    for (const other of Object.keys(DELEGATE_GUARDS)) {
      if (other === name || stack.includes(other)) continue
      // Another delegate counts when imported from its file, or called inside
      // that same library (the analyser gives a library's own exports the
      // library as their origin).
      if (callsDelegate(facts, other)) {
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
  const route = (code: string) => analyzeRoute('app/api/fixture/route.ts', code).handlers
  const kinds = (code: string) => {
    const [h] = route(code)
    return [...satisfies(h)].sort()
  }

  it('follows same-file helpers and resolves import aliases', () => {
    const [h] = route(`
      import { auth as clerkAuth } from '@clerk/nextjs/server'
      async function who() { return clerkAuth() }
      export async function GET() { await who(); return new Response() }
    `)
    expect(h.name).toBe('GET')
    expect(satisfies(h).has('session')).toBe(true)
  })

  it('resolves @/ and relative imports to the same module', () => {
    expect(resolveModule('app/api/x/route.ts', '@/lib/community')).toBe('lib/community')
    expect(resolveModule('lib/store/auth.ts', '../community')).toBe('lib/community')
    expect(resolveModule('lib/store/auth.ts', './printful')).toBe('lib/store/printful')
    expect(resolveModule('lib/x.ts', '@clerk/nextjs/server')).toBe('@clerk/nextjs/server')
    expect(kinds(`import { getOnboardedMember } from '@/lib/onboarded-member'
      export async function GET() { await getOnboardedMember(); return 1 }`)).toEqual(['session'])
  })

  it('reads a guard destructured from a dynamic import', () => {
    expect(kinds(`export async function GET() { const { auth } = await import('@clerk/nextjs/server'); await auth(); return 1 }`)).toEqual(['session'])
    expect(kinds(`export async function GET() { const { auth } = await import('@/lib/fake'); await auth(); return 1 }`)).toEqual([])
  })

  it('does not trust a same-file function that borrows a guard name', () => {
    expect(kinds(`
      function getCurrentMember() { return { id: 'x' } }
      export async function POST() { getCurrentMember(); return new Response() }
    `)).toEqual([])
  })

  it('does not trust a nested function that borrows a guard name', () => {
    expect(kinds(`export async function GET() { function isAdminClaims() { return true }; isAdminClaims(); return 1 }`)).toEqual([])
    expect(kinds(`export async function GET() { const auth = async () => ({}); await auth(); return 1 }`)).toEqual([])
  })

  it('does not trust a guard name imported from the wrong module', () => {
    expect(kinds(`import { getOnboardedMember } from '@/lib/not-the-guard'
      export async function GET() { await getOnboardedMember(); return 1 }`)).toEqual([])
    expect(kinds(`import { guardCron } from '@/lib/fake-cron'
      export async function GET(req) { const b = guardCron(req); return b }`)).toEqual([])
    expect(kinds(`import { auth } from '@/lib/auth-lookalike'
      export async function GET() { await auth(); return 1 }`)).toEqual([])
  })

  it('does not trust a method that borrows a guard name', () => {
    expect(kinds(`export async function GET() {
      const g = { getOnboardedMember: async () => ({ id: 'x' }) }
      await g.getOnboardedMember(); return 1 }`)).toEqual([])
    expect(kinds(`export async function POST() { const p = new URLSearchParams(); p.verify?.(); return 1 }`)).toEqual([])
    expect(kinds(`export async function POST(req) { const b = await req.json(); b.verify(); return 1 }`)).toEqual([])
  })

  it('trusts a verifier method only on the provider object', () => {
    expect(kinds(`import { Webhook } from 'svix'
      export async function POST(req) { const wh = new Webhook(s); wh.verify(p, h); return 1 }`)).toEqual(['webhook'])
    expect(kinds(`import { Webhook } from 'svix'
      export async function POST(req) { new Webhook(s).verify(p, h); return 1 }`)).toEqual(['webhook'])
    expect(kinds(`import { requireStripe } from '@/lib/stripe'
      export async function POST(req) { const stripe = requireStripe(); stripe.webhooks.constructEvent(a, b, c); return 1 }`)).toEqual(['webhook'])
    expect(kinds(`import crypto from 'crypto'
      export async function POST(req) { return crypto.timingSafeEqual(a, b) }`)).toEqual(['webhook'])
  })

  it('does not count a guard inside a closure that never runs', () => {
    expect(kinds(`import { requireAdminPage } from '@/lib/admin-auth'
      export async function GET() { const never = () => requireAdminPage(); return members() }`)).toEqual([])
    expect(kinds(`import { auth } from '@clerk/nextjs/server'
      export async function GET() { return { later: async () => auth() } }`)).toEqual([])
  })

  it('counts a guard inside a closure that runs: called, passed, or referenced', () => {
    expect(kinds(`import { auth } from '@clerk/nextjs/server'
      export async function GET() { const who = async () => auth(); await who(); return 1 }`)).toEqual(['session'])
    expect(kinds(`import { auth } from '@clerk/nextjs/server'
      export async function GET() { await Promise.all([1].map(async () => auth())); return 1 }`)).toEqual(['session'])
    expect(kinds(`import { auth } from '@clerk/nextjs/server'
      export async function GET() { await (async () => auth())(); return 1 }`)).toEqual(['session'])
  })

  it('does not count a guard after an unconditional return or throw', () => {
    expect(kinds(`import { auth } from '@clerk/nextjs/server'
      export async function GET() { return members(); await auth() }`)).toEqual([])
    expect(kinds(`import { auth } from '@clerk/nextjs/server'
      export async function GET() { throw new Error('x'); await auth() }`)).toEqual([])
    // A conditional return does not end the block.
    expect(kinds(`import { auth } from '@clerk/nextjs/server'
      export async function GET(req) { if (req) return 1; await auth(); return 2 }`)).toEqual(['session'])
  })

  it('detects the inline role check on the session claims', () => {
    const [h] = route(`
      import { auth } from '@clerk/nextjs/server'
      export async function GET() {
        const { sessionClaims } = await auth()
        if (sessionClaims?.metadata?.role !== 'admin') return new Response(null, { status: 403 })
        return new Response()
      }
    `)
    expect(h.comparesRoleToAdmin).toBe(true)
    expect(satisfies(h).has('admin')).toBe(true)
    // The repo's usual form: the role bound to a const first.
    expect(kinds(`import { auth } from '@clerk/nextjs/server'
      export async function GET() {
        const { sessionClaims } = await auth()
        const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role
        if (role !== 'admin') return 403
        return 1 }`)).toEqual(['admin', 'session'])
  })

  it('does not count a role read from the request or a row, or without Clerk', () => {
    expect(kinds(`export async function POST(req) { const b = await req.json(); if (b.role !== 'admin') return 403; return db() }`)).toEqual([])
    expect(kinds(`import { auth } from '@clerk/nextjs/server'
      export async function POST(req) { await auth(); const body = await req.json(); if (body.role === 'admin') {} return 1 }`)).toEqual(['session'])
    expect(kinds(`import { auth } from '@clerk/nextjs/server'
      export async function POST(req) { await auth(); const role = (await req.json()).role; if (role !== 'admin') return 403; return 1 }`)).toEqual(['session'])
    // Claims-shaped, but nothing calls Clerk.
    expect(kinds(`export async function POST(req) { const sessionClaims = await req.json(); if (sessionClaims.role !== 'admin') return 403; return 1 }`)).toEqual([])
  })

  it('reports only the first statement for the cron rule', () => {
    const imp = `import { guardCron } from '@/lib/cron'\n`
    const [ok] = route(`${imp}export async function GET(req) { const blocked = guardCron(req); if (blocked) return blocked; return run() }`)
    const [late] = route(`${imp}export async function GET(req) { await work(); const blocked = guardCron(req); return blocked }`)
    expect(ok.firstStatementCalls.has('guardCron')).toBe(true)
    expect(late.firstStatementCalls.has('guardCron')).toBe(false)
    expect(late.calls.has('guardCron')).toBe(true)
  })

  it('reads const, re-exported and wrapped handlers', () => {
    const hs = route(`
      import { Webhook } from 'svix'
      async function impl() { return new Webhook(s).verify() }
      export const POST = withLogging(impl)
      function get() { return new Response() }
      export { get as GET }
    `)
    expect(hs.map((h) => h.name).sort()).toEqual(['GET', 'POST'])
    expect(satisfies(hs.find((h) => h.name === 'POST')!).has('webhook')).toBe(true)
  })

  it('follows a local component rendered by a page', () => {
    const facts = analyzeDefaultExport(
      'app/fixture/page.tsx',
      `import { requireAdminPage } from '@/lib/admin-auth'
       async function Data() { await requireAdminPage(); return null }
       export default function Page() { return <main><Data /></main> }`,
    )!
    expect(satisfies(facts).has('admin')).toBe(true)
  })

  it('does not count a guard that is only mentioned in a comment or string', () => {
    expect(kinds(`
      // requireAdminPage() is not called here
      export async function GET() { return new Response('isAdminClaims') }
    `)).toEqual([])
  })

  it('records prop=literal comparisons for the data gates', () => {
    const facts = analyzeDefaultExport(
      'app/fixture/opengraph-image.tsx',
      `function gate(d) { if (d.visibility !== 'public') return null; return d }
       export default async function Image() { return gate(await load()) }`,
    )!
    expect(facts.compares.has('visibility=public')).toBe(true)
  })
})
