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
  callsClerkSession,
  callsDelegate,
  decisionKinds,
  enforcedFacts,
  satisfies,
  withImplied,
  type GuardKind,
} from '@/lib/security/route-guards'
import {
  HTTP_METHODS,
  analyzeDefaultExport,
  analyzeNamedExport,
  analyzeRoute,
  directRpcCalls,
  directTableReads,
  exportedNames,
  resolveModule,
  type HandlerFacts,
} from '@/lib/security/route-ast'
import { TABLE_REGISTRY } from '@/lib/tenancy/registry'

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
// numbers on 4 Nov 2026: 311 route files, 5 metadata routes, 158 pages,
// 425 route handlers.
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

/**
 * Functions a tenant_staff file may call directly. Empty: an rpc runs SQL this rule cannot
 * see, so adding one here is a review of what it reads and how it is scoped.
 */
const TENANT_STAFF_REVIEWED_RPCS: readonly string[] = []

/** Direct reads the tenant_staff rule refuses. An unknown table or schema fails closed. */
function unscopedTableReads(file: string, code: string): string[] {
  const tables = directTableReads(file, code).flatMap((key) => {
    if (key === null) return ['a table named at run time']
    const entry = TABLE_REGISTRY[key]
    return !entry || entry.tenantColumn !== 'none' ? [key] : []
  })
  const rpcs = directRpcCalls(file, code).flatMap((fn) => (fn !== null && TENANT_STAFF_REVIEWED_RPCS.includes(fn) ? [] : [`rpc ${fn ?? 'named at run time'}`]))
  return [...tables, ...rpcs]
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
  })

  // S5 C6: a file classed tenant_staff reaches a tenant-holding table only through
  // loadScoped, scopedQuery or tenantDb, so a bare `.from('registrations')` cannot be
  // the way in. Direct calls in the file; what a lib helper does is the IDOR personas' job.
  it('a tenant_staff file queries no own, derived or inherited table directly', () => {
    const files = Object.entries(ROUTE_MANIFEST).filter(([, cls]) => cls === 'tenant_staff').map(([f]) => f)
    const failures = files.flatMap((f) => unscopedTableReads(f, src(f)).map((t) => `${f}: ${t}`))
    expect(failures, 'use loadScoped, scopedQuery or tenantDb').toEqual([])
  })

  it('the tenant_staff table rule sees a direct read, and only a tenant-holding one', () => {
    const f = 'app/api/admin/x/route.ts'
    expect(unscopedTableReads(f, "db.from('registrations').select('*')")).toEqual(['public.registrations'])
    expect(unscopedTableReads(f, "const T = 'participants'; db.from(T).select('*')")).toEqual(['public.participants'])
    expect(unscopedTableReads(f, 'db.from(tableName).select()')).toEqual(['a table named at run time'])
    expect(unscopedTableReads(f, "db.schema('nope').from('registrations').select('*')")).toEqual(['nope.registrations'])
    // No tenant column, a bucket, a global, and the scoped ways in.
    expect(unscopedTableReads(f, "db.from('schools').select('*'); db.storage.from('registrations'); Array.from(x)")).toEqual([])
    expect(unscopedTableReads(f, "await loadScoped(s, 'registrations', id, o); scopedQuery(s, 'participants', o)")).toEqual([])
  })

  it('the tenant_staff table rule resolves only a name that can hold one value', () => {
    const f = 'app/api/admin/x/route.ts'
    const runTime = ['a table named at run time']
    expect(unscopedTableReads(f, "let T = 'schools'; T = 'registrations'; db.from(T).select('*')")).toEqual(runTime)
    expect(unscopedTableReads(f, "const T = 'schools'; function g(T) { return db.from(T).select('*') }")).toEqual(runTime)
    expect(unscopedTableReads(f, "const T = 'schools'; function g() { const T = 'registrations'; return db.from(T) }")).toEqual(runTime)
    expect(unscopedTableReads(f, "const T = 'schools'; const { T: U, ...rest } = o; const [V] = p; db.from(T)")).toEqual([])
  })

  it('the tenant_staff table rule refuses an rpc that nobody has reviewed', () => {
    const f = 'app/api/admin/x/route.ts'
    expect(unscopedTableReads(f, "await db.rpc('withdraw_registration', { p_id: id })")).toEqual(['rpc withdraw_registration'])
    expect(unscopedTableReads(f, 'await db.rpc(name, args)')).toEqual(['rpc named at run time'])
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
    const exported = d.export ?? d.call ?? name
    const raw = analyzeNamedExport(d.file, src(d.file), exported)
    if (!raw) throw new Error(`${exported} is not exported from ${d.file}`)
    // A helper that discards a lib/authz answer is no more a guard than a handler that does.
    const facts = enforcedFacts(raw)
    const out = baseKinds(facts)
    // lib/authz's composites decide through its pure functions, not each other.
    if (d.file === 'lib/authz.ts') for (const k of decisionKinds(facts)) out.add(k)
    for (const other of Object.keys(DELEGATE_GUARDS)) {
      if (other === name || stack.includes(other)) continue
      // Another delegate counts when imported from its file, or called inside
      // that same library (the analyser gives a library's own exports the
      // library as their origin).
      if (callsDelegate(facts, other)) {
        for (const k of kindsOf(other, [...stack, name])) out.add(k)
      }
    }
    withImplied(out)
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

  // The primitives are BASE guards, so nothing above proves them. An admin kind
  // implies a session only because each of these really reads the Clerk session.
  const AUTHZ_FILE = 'lib/authz.ts'
  it.each([
    ['assertTenantRole', 'tenant'],
    ['assertPlatformAdmin', 'platform'],
    ['requireStellrAdmin', 'admin'],
    ['requireTenantStaff', 'tenant'],
    ['hasPortalAccess', 'admin'],
    ['hasScope', 'admin'],
    ['requireEventAccess', 'tenant'],
  ] as const)('lib/authz %s reaches its %s decision and the Clerk session', (name, kind) => {
    const facts = analyzeNamedExport(AUTHZ_FILE, src(AUTHZ_FILE), name)!
    expect(decisionKinds(facts).has(kind)).toBe(true)
    expect(callsClerkSession(facts)).toBe(true)
  })

  it('getPrincipal reads the Clerk session', () => {
    expect(callsClerkSession(analyzeNamedExport(AUTHZ_FILE, src(AUTHZ_FILE), 'getPrincipal')!)).toBe(true)
  })

  it('a helper that stops deciding is no longer proved', () => {
    const code = `import { decideTenantStaff } from '@/lib/authz/decide'
      export async function requireTenantStaff() { return { ok: true } }
      export async function other() { return decideTenantStaff() }`
    expect(decisionKinds(analyzeNamedExport(AUTHZ_FILE, code, 'requireTenantStaff')!).size).toBe(0)
    expect(decisionKinds(analyzeNamedExport(AUTHZ_FILE, code, 'other')!).has('tenant')).toBe(true)
  })
})

describe('guard list: lib/authz', () => {
  const handler = (code: string) => analyzeRoute('app/api/fixture/route.ts', code).handlers[0]
  const meets = (cls: RouteClass, code: string) => {
    const got = satisfies(handler(code))
    return CLASS_REQUIREMENTS[cls].kinds.every((k) => got.has(k))
  }
  // Branches on the answer: a lib/authz check returns its decision, it does not throw.
  const calling = (spec: string, name: string, call = `${name}('t', ['tenant_admin'])`) =>
    `import { ${name} } from '${spec}'\nexport async function GET() { const d = await ${call}; if (!d) return new Response(null, { status: 403 }); return new Response() }`
  const AUTHZ = '@/lib/authz'
  const inGet = (imports: string, body: string) =>
    `import { ${imports} } from '@/lib/authz'\nexport async function GET(req, { params }) { ${body}; return new Response() }`

  it('a tenant_staff or platform_admin handler with only a legacy admin check fails', () => {
    const legacy = [
      calling('@/lib/admin-auth', 'isAdminClaims'),
      calling('@/lib/admin-auth', 'currentUserIsAdmin'),
      calling('@/lib/admin-auth', 'requireAdminPage'),
      calling('@/lib/event-access', 'requireEventAccess'),
      `import { auth } from '@clerk/nextjs/server'
       export async function GET() {
         const { sessionClaims } = await auth()
         if (sessionClaims?.metadata?.role !== 'admin') return new Response(null, { status: 403 })
         return new Response() }`,
    ]
    for (const code of legacy) {
      expect(meets('stellr_only', code), code).toBe(true)
      expect(meets('tenant_staff', code), code).toBe(false)
      expect(meets('platform_admin', code), code).toBe(false)
    }
  })

  it('each class accepts its own lib/authz check, and not the other', () => {
    for (const name of ['assertTenantRole', 'requireTenantStaff', 'requireTenantAdmin']) {
      expect(meets('tenant_staff', calling(AUTHZ, name)), name).toBe(true)
      expect(meets('platform_admin', calling(AUTHZ, name)), name).toBe(false)
    }
    expect(meets('tenant_staff', calling(AUTHZ, 'requireEventAccess', "requireEventAccess('slug')"))).toBe(true)
    expect(meets('platform_admin', calling(AUTHZ, 'assertPlatformAdmin'))).toBe(true)
    expect(meets('tenant_staff', calling(AUTHZ, 'assertPlatformAdmin'))).toBe(false)
  })

  it('a Stellr-wide check does not pass as a tenant check', () => {
    for (const name of ['requireStellrAdmin', 'isStellrAdmin', 'hasPortalAccess', 'hasScope', 'requireAdmin']) {
      expect(meets('stellr_only', calling(AUTHZ, name)), name).toBe(true)
      expect(meets('tenant_staff', calling(AUTHZ, name)), name).toBe(false)
      expect(meets('platform_admin', calling(AUTHZ, name)), name).toBe(false)
    }
  })

  it('a converted stellr_only handler passes on a Stellr check, and every authz guard implies a session', () => {
    for (const name of ['assertPlatformAdmin', 'requireStellrAdmin', 'isStellrAdmin', 'hasPortalAccess', 'hasScope']) {
      expect(meets('stellr_only', calling(AUTHZ, name)), name).toBe(true)
    }
    expect(meets('stellr_only', calling(AUTHZ, 'requireAdmin'))).toBe(true)
    expect(meets('stellr_only', calling(AUTHZ, 'requireEventAccess', "requireEventAccess('slug')"))).toBe(true)
    expect(meets('stellr_only', calling(AUTHZ, 'requireEventSection'))).toBe(true)
    for (const name of ['assertTenantRole', 'assertPlatformAdmin', 'requireStellrAdmin', 'requireTenantStaff']) {
      expect(satisfies(handler(calling(AUTHZ, name))).has('session'), name).toBe(true)
    }
  })

  it('a tenant check does not meet stellr_only: holding a role in some tenant is not being a Stellr admin', () => {
    for (const name of ['assertTenantRole', 'requireTenantStaff', 'requireTenantAdmin']) {
      expect(meets('stellr_only', calling(AUTHZ, name)), name).toBe(false)
      expect([...satisfies(handler(calling(AUTHZ, name)))].sort(), name).toEqual(['session', 'tenant'])
    }
    expect(withImplied(new Set<GuardKind>(['tenant'])).has('admin')).toBe(false)
    expect(withImplied(new Set<GuardKind>(['platform'])).has('admin')).toBe(true)
  })

  describe('a lib/authz answer has to be used', () => {
    it('a discarded or un-awaited answer is no guard', () => {
      const none = [
        inGet('assertTenantRole', "await assertTenantRole('t', ['staff'])"),
        inGet('assertTenantRole', "assertTenantRole('t', ['staff'])"),
        inGet('requireTenantStaff', "void requireTenantStaff('t', ['staff'])"),
        inGet('assertPlatformAdmin', 'await assertPlatformAdmin()'),
        inGet('requireStellrAdmin', 'const d = await requireStellrAdmin()'),
        inGet('requireStellrAdmin', '(await requireStellrAdmin()).ok'),
        inGet('isStellrAdmin', 'if (!isStellrAdmin()) return new Response(null, { status: 403 })'),
        inGet('isStellrAdmin', 'const ok = isStellrAdmin(); if (!ok) return new Response(null, { status: 403 })'),
        inGet('hasScope', "await hasScope('x')"),
        inGet('hasPortalAccess', 'req && (await hasPortalAccess())'),
        inGet('getPrincipal', 'await getPrincipal()'),
        inGet('authz', "await authz.api.requireTenantStaff('t', ['staff'])"),
        inGet('page', 'page.requireAdmin()'),
        inGet('authz', 'authz.page.requireStellrAdmin()'),
        `import { isStellrAdmin } from '@/lib/authz'
         async function gate() { return isStellrAdmin() }
         export async function GET() { await gate(); return new Response() }`,
      ]
      for (const code of none) expect([...satisfies(handler(code))], code).toEqual([])
    })

    it('every way of acting on the answer counts', () => {
      const admin = [
        inGet('requireStellrAdmin', 'const d = await requireStellrAdmin(); if (!d.ok) return new Response(null, { status: d.status })'),
        inGet('requireStellrAdmin', 'const { ok } = await requireStellrAdmin(); if (!ok) return new Response(null, { status: 403 })'),
        inGet('requireStellrAdmin', 'if (!(await requireStellrAdmin()).ok) return new Response(null, { status: 403 })'),
        inGet('isStellrAdmin', 'if (!(await isStellrAdmin())) return new Response(null, { status: 403 })'),
        inGet('isStellrAdmin', '(await isStellrAdmin()) || notFound()'),
        inGet('isStellrAdmin', 'const out = (await isStellrAdmin()) ? a() : b(); use(out)'),
        inGet('isStellrAdmin', 'const p = isStellrAdmin(); if (!(await p)) return new Response(null, { status: 403 })'),
        inGet('isStellrAdmin', 'let ok = false; ok = await isStellrAdmin(); if (!ok) return new Response(null, { status: 403 })'),
        inGet('isStellrAdmin', 'const [ok, rows] = await Promise.all([isStellrAdmin(), load()]); if (!ok) return rows'),
        inGet('isStellrAdmin', 'const ok = await isStellrAdmin().catch(() => false); if (!ok) return new Response(null, { status: 403 })'),
        inGet('isStellrAdmin', 'return (await isStellrAdmin()) ? 1 : 2'),
        inGet('isStellrAdmin', 'return isStellrAdmin()'),
        inGet('authz', 'const r = await authz.api.requireStellrAdmin(); if (!r.ok) return r.deny'),
        inGet('page', 'await page.requireAdmin()'),
        inGet('authz', 'await authz.page.requireStellrAdmin()'),
        inGet('page as p', 'await p.requireStellrAdmin()'),
        `import { isStellrAdmin } from '@/lib/authz'
         async function gate() { return isStellrAdmin() }
         export async function GET() { if (!(await gate())) return new Response(null, { status: 403 }); return new Response() }`,
      ]
      for (const code of admin) expect(satisfies(handler(code)).has('admin'), code).toBe(true)
    })

    it('leaves a legacy check as it was: that blind spot goes when the check does', () => {
      expect([...satisfies(handler(`import { currentUserIsAdmin } from '@/lib/admin-auth'
        export async function GET() { await currentUserIsAdmin(); return 1 }`))].sort()).toEqual(['admin', 'session'])
    })
  })

  describe('which tenant a tenant check asks about', () => {
    const asked = (imports: string, setup: string, tenant: string) =>
      inGet(imports, `${setup}; const d = await assertTenantRole(${tenant}, ['tenant_admin']); if (!d.ok) return new Response(null, { status: 403 })`)

    it('a tenant the request names proves nothing', () => {
      const fromRequest = [
        ['const b = await req.json()', 'b.tenantId'],
        ['const body = await req.json()', 'body.tenantId'],
        ['const { tenantId } = await req.json()', 'tenantId'],
        ['const { tenantId } = await params', 'tenantId'],
        ["const t = req.nextUrl.searchParams.get('tenant')", 't'],
        ['const parsed = schema.parse(await req.json())', 'parsed.tenantId'],
        ['const parsed = readJson(req)', 'parsed.tenantId'],
        ["const t = (await headers()).get('x-tenant')", 't'],
        ['', 'params.tenantId'],
      ]
      for (const [setup, tenant] of fromRequest) {
        const got = satisfies(handler(asked('assertTenantRole', setup, tenant)))
        expect(got.has('tenant'), `${setup} ${tenant}`).toBe(false)
        expect(got.has('session'), `${setup} ${tenant}`).toBe(false)
      }
      const staff = inGet('requireTenantStaff', "const b = await req.json(); if (!(await requireTenantStaff(b.tenantId, ['staff'])).ok) return 1")
      expect(satisfies(handler(staff)).has('tenant')).toBe(false)
      const adapter = inGet('authz', "const b = await req.json(); const r = await authz.api.requireTenantStaff(b.tenantId, ['staff']); if (!r.ok) return r.deny")
      expect(satisfies(handler(adapter)).has('tenant')).toBe(false)
    })

    it('a tenant from the server counts, even when the request picked the row', () => {
      const fromServer = [
        ['', 'currentTenantId()'],
        ['', 'STELLR_TENANT_ID'],
        ['const ctx = await scope()', 'ctx.tenantId'],
        ['const tenant = await requestTenant(req)', 'tenant.id'],
        ["const b = await req.json(); const { data: row } = await db.from('t').select('tenant_id').eq('id', b.id).single()", 'row.tenant_id'],
        ['const b = await req.json(); const row = await loadEvent(b.id)', 'row.tenant_id'],
      ]
      for (const [setup, tenant] of fromServer) {
        expect(satisfies(handler(asked('assertTenantRole', setup, tenant))).has('tenant'), `${setup} ${tenant}`).toBe(true)
      }
    })
  })

  describe('section-level event access', () => {
    const eventCall = (arg: string) => inGet('requireEventAccess', `const a = await requireEventAccess(${arg}); if (!a.ok) return new Response(null, { status: a.status })`)

    it('without an event it is an admin check, not a tenant check', () => {
      for (const code of [eventCall(''), eventCall('undefined'), eventCall('undefined, { route: "x" }'), inGet('page', 'await page.requireEventSection()')]) {
        expect(meets('stellr_only', code), code).toBe(true)
        expect(meets('tenant_staff', code), code).toBe(false)
      }
      const onIdRoute = analyzeRoute('app/api/admin/x/[id]/route.ts', eventCall('')).handlers[0]
      expect(satisfies(onIdRoute).has('tenant')).toBe(false)
      expect(satisfies(handler(inGet('authz', 'const r = await authz.api.requireEventAccess(); if (!r.ok) return r.deny'))).has('tenant')).toBe(false)
    })

    it('naming the event is a tenant check, and the request may name it', () => {
      for (const arg of ["'slug'", '(await params).slug', 'slug']) {
        expect(meets('tenant_staff', eventCall(arg)), arg).toBe(true)
      }
      expect(satisfies(handler(inGet('authz', 'const r = await authz.api.requireEventAccess(slug); if (!r.ok) return r.deny'))).has('tenant')).toBe(true)
    })
  })

  it('accepts the authz object and the page and api adapters', () => {
    const viaObject = (call: string) =>
      `import { authz } from '@/lib/authz'\nexport async function GET() { const d = await authz.${call}; if (!d) return new Response(null, { status: 403 }); return new Response() }`
    expect(meets('tenant_staff', viaObject("assertTenantRole('t', ['staff'])"))).toBe(true)
    expect(meets('platform_admin', viaObject('assertPlatformAdmin()'))).toBe(true)
    expect(meets('tenant_staff', viaObject("api.requireTenantStaff('t', ['staff'])"))).toBe(true)
    expect(meets('tenant_staff', viaObject('page.requireTenantAdmin()'))).toBe(true)
    expect(meets('stellr_only', viaObject('page.requireAdmin()'))).toBe(true)
    expect(meets('tenant_staff', viaObject('page.requireAdmin()'))).toBe(false)
    expect(meets('stellr_only', `import { page } from '@/lib/authz'
      export async function GET() { await page.requireStellrAdmin(); return 1 }`)).toBe(true)
  })

  it('does not trust a look-alike', () => {
    for (const name of ['assertTenantRole', 'assertPlatformAdmin', 'requireTenantStaff', 'requireAdmin']) {
      expect([...satisfies(handler(calling('@/lib/not-authz', name)))], name).toEqual([])
      expect([...satisfies(handler(`function ${name}() { return true }
        export async function GET() { ${name}(); return 1 }`))], name).toEqual([])
    }
    expect([...satisfies(handler(`export async function GET() {
      const g = { assertTenantRole: async () => true }; await g.assertTenantRole(); return 1 }`))]).toEqual([])
  })

  it('a pure decision, or a helper about someone else, is not a guard', () => {
    expect([...satisfies(handler(calling('@/lib/authz/decide', 'decideTenantRole')))]).toEqual([])
    expect([...satisfies(handler(calling('@/lib/authz/decide', 'decideStellrAdmin')))]).toEqual([])
    expect([...satisfies(handler(calling(AUTHZ, 'isStaffTarget')))]).toEqual([])
    expect([...satisfies(handler(calling(AUTHZ, 'accessCoversEvent')))]).toEqual([])
    expect([...satisfies(handler(calling(AUTHZ, 'assertWritable')))]).toEqual([])
    expect([...satisfies(handler(calling(AUTHZ, 'getPrincipal')))]).toEqual(['session'])
  })

  it('reads a method of an exported object, and only that', () => {
    const code = `import { auth } from '@clerk/nextjs/server'
      export const page = { async a() { return auth() }, b: async () => 1 }
      const hidden = { async a() { return auth() } }`
    expect(analyzeNamedExport('lib/x.ts', code, 'page.a')!.calls.has('auth')).toBe(true)
    expect(analyzeNamedExport('lib/x.ts', code, 'page.b')!.calls.has('auth')).toBe(false)
    expect(analyzeNamedExport('lib/x.ts', code, 'page.missing')).toBeNull()
    expect(analyzeNamedExport('lib/x.ts', code, 'hidden.a')).toBeNull()
    // The object itself runs nothing, so it is never a guard.
    expect(analyzeNamedExport('lib/x.ts', code, 'page')!.calls.has('auth')).toBe(false)
  })
})

describe('guard list: async rate limiter', () => {
  const ASYNC = '@/lib/rate-limit-async'
  const OPTS = '{ limit: 5, windowMs: 60_000, tenantId: null }'
  const viaRateLimit = `const blocked = await rateLimit(req, 'schools', ${OPTS}); if (blocked) return blocked`
  const viaLimit = `const d = await limit('k', ${OPTS}); if (!d.ok) return new Response(null, { status: 429 })`
  const route = (imports: string, body: string) =>
    `${imports}\nexport async function GET(req) { ${body}; return new Response() }`
  // The same check the real routes get above, on a public handler.
  const missing = (code: string) => {
    const facts = analyzeRoute('app/api/fixture/route.ts', code).handlers[0]
    return missingKinds({ key: 'app/api/fixture/route.ts#GET', file: 'app/api/fixture/route.ts', cls: 'public', facts }, false)
  }
  const SUPABASE = "import { supabaseServer } from '@/lib/supabase'"
  const QUERY = "const db = supabaseServer(); const { data } = await db.from('schools').select('name').limit(8)"

  it('a public route using only the async limiter counts as guarded', () => {
    expect(missing(route(`import { rateLimit } from '${ASYNC}'`, viaRateLimit))).toEqual([])
    expect(missing(route(`import { limit } from '${ASYNC}'`, viaLimit))).toEqual([])
  })

  it('a public route using neither limiter does not', () => {
    expect(missing(route('', 'const a = 1'))).toEqual(['rate_limit'])
    expect(missing(route(SUPABASE, QUERY))).toEqual(['rate_limit'])
  })

  it('still counts the sync limiter', () => {
    expect(missing(route("import { rateLimitGuard } from '@/lib/rate-limit'", "const b = rateLimitGuard(req, 'x', { limit: 1, windowMs: 1 }); if (b) return b"))).toEqual([])
    expect(missing(route("import { checkRateLimit } from '@/lib/rate-limit'", "if (!checkRateLimit('k', { limit: 1, windowMs: 1 }).ok) return 1"))).toEqual([])
  })

  it('reads an alias, a namespace, a relative path and a same-file helper', () => {
    expect(missing(route(`import { rateLimit as rl } from '${ASYNC}'`, viaRateLimit.replace('rateLimit(', 'rl(')))).toEqual([])
    expect(missing(route(`import * as rl from '${ASYNC}'`, viaLimit.replace('limit(', 'rl.limit(')))).toEqual([])
    expect(missing(route("import { limit } from '../../../lib/rate-limit-async'", viaLimit))).toEqual([])
    expect(missing(`import { rateLimit } from '${ASYNC}'
      async function gate(req) { const b = await rateLimit(req, 'x', ${OPTS}); return b }
      export async function GET(req) { const b = await gate(req); if (b) return b; return new Response() }`)).toEqual([])
  })

  describe('its answer has to decide something', () => {
    const RL = `import { rateLimit } from '${ASYNC}'`
    const LIM = `import { limit } from '${ASYNC}'`
    const OK = 'return new Response()'
    const USES_GATE = `const b = await gate(req); if (b) return b; ${OK}`
    const gateReturns = `async function gate(req) { return await rateLimit(req, 'x', ${OPTS}) }`
    const gateDecides = `async function gate(req) { const b = await rateLimit(req, 'x', ${OPTS}); if (b) return b; return null }`
    const allowedReturns = `async function allowed() { const d = await limit('k', ${OPTS}); return d.ok }`
    const allowedDecides = `async function allowed() { const d = await limit('k', ${OPTS}); if (!d.ok) return false; return true }`
    const get = (imports: string, helper: string, body: string) =>
      `${imports}\n${helper}\nexport async function GET(req) { ${body} }`

    it.each([
      ['a direct call whose result is thrown away', get(RL, '', `await rateLimit(req, 'x', ${OPTS}); ${OK}`)],
      ['a direct call that is not awaited', get(RL, '', `const b = rateLimit(req, 'x', ${OPTS}); if (b) return b; ${OK}`)],
      ['a limit() decision thrown away', get(LIM, '', `await limit('k', ${OPTS}); ${OK}`)],
      ['a helper that hands back the un-awaited Promise', get(RL, `async function gate(req) { return rateLimit(req, 'x', ${OPTS}) }`, USES_GATE)],
      ['a helper that is not awaited', get(RL, gateReturns, `gate(req); ${OK}`)],
      ['a helper whose result is thrown away', get(RL, gateReturns, `await gate(req); ${OK}`)],
      ['a helper only referenced, never called', get(RL, gateReturns, `const g = gate; ${OK}`)],
      ['a limit() helper whose result is thrown away', get(LIM, allowedReturns, `await allowed(); ${OK}`)],
      ['a helper that reads the answer, not awaited', get(RL, gateDecides, `gate(req); ${OK}`)],
      ['a helper that reads the answer, result thrown away', get(RL, gateDecides, `await gate(req); ${OK}`)],
      ['a limit() helper that reads .ok, result thrown away', get(LIM, allowedDecides, `await allowed(); ${OK}`)],
      [
        'a helper behind a helper, result thrown away',
        get(RL, `${gateDecides}\nasync function outer(req) { const b = await gate(req); if (b) return b; return null }`, `await outer(req); ${OK}`),
      ],
    ])('refuses %s', (_label, code) => {
      expect(missing(code)).toEqual(['rate_limit'])
    })

    it('refuses a helper that one caller ignores, in every handler that shares it', () => {
      const code = `${RL}\n${gateDecides}
        export async function GET(req) { ${USES_GATE} }
        export async function POST(req) { await gate(req); ${OK} }`
      for (const facts of analyzeRoute('app/api/fixture/route.ts', code).handlers) {
        expect(satisfies(facts).has('rate_limit'), facts.name).toBe(false)
      }
    })

    it.each([
      ['a helper whose answer is returned', get(RL, gateReturns, USES_GATE)],
      ['a helper that reads the answer and returns it', get(RL, gateDecides, USES_GATE)],
      ['a helper behind a local name', get(RL, gateDecides, `const g = gate; const b = await g(req); if (b) return b; ${OK}`)],
      ['a helper declared in the handler', `${RL}\nexport async function GET(req) { ${gateDecides}; ${USES_GATE} }`],
      ['a limit() helper that returns .ok', get(LIM, allowedReturns, `if (!(await allowed())) return new Response(null, { status: 429 }); ${OK}`)],
      ['a call inside a wrapper', `${RL}\nexport const GET = wrap(async (req) => { const b = await rateLimit(req, 'x', ${OPTS}); if (b) return b; ${OK} })`],
      ['a handler exported by name', `${RL}\nasync function GET(req) { const b = await rateLimit(req, 'x', ${OPTS}); if (b) return b; ${OK} }\nexport { GET }`],
    ])('accepts %s', (_label, code) => {
      expect(missing(code)).toEqual([])
    })
  })

  it('a query limit is not a rate limit', () => {
    expect(missing(route(SUPABASE, QUERY))).toEqual(['rate_limit'])
    // The same, in a file that imports the limiter and never calls it.
    expect(missing(route(`${SUPABASE}\nimport { limit, rateLimit } from '${ASYNC}'`, QUERY))).toEqual(['rate_limit'])
    // The options object and a local constant are not calls either.
    expect(missing(route('', `const limit = 8; const rateLimit = { limit }; use(limit, rateLimit)`))).toEqual(['rate_limit'])
  })

  it('does not trust a look-alike', () => {
    for (const spec of ['@/lib/not-rate-limit', '@/lib/rate-limit', '@/lib/rate-limit-async-old']) {
      expect(missing(route(`import { rateLimit } from '${spec}'`, viaRateLimit)), spec).toEqual(['rate_limit'])
      expect(missing(route(`import { limit } from '${spec}'`, viaLimit)), spec).toEqual(['rate_limit'])
    }
    expect(missing(`function rateLimit() { return null }
      export async function GET(req) { const b = await rateLimit(req); if (b) return b; return 1 }`)).toEqual(['rate_limit'])
    expect(missing(route('', "const g = { rateLimit: async () => null }; await g.rateLimit(req)"))).toEqual(['rate_limit'])
  })

  it('a rate limit is not a session', () => {
    const facts = analyzeRoute('app/api/fixture/route.ts', route(`import { rateLimit } from '${ASYNC}'`, viaRateLimit)).handlers[0]
    expect([...satisfies(facts)]).toEqual(['rate_limit'])
    expect(missingKinds({ key: 'x', file: 'x', cls: 'participant', facts }, false)).toEqual(['session'])
  })

  it('a limiter that stops counting is no longer proved', () => {
    const FILE = 'lib/rate-limit-async.ts'
    const code = `import { checkRateLimit } from '@/lib/rate-limit'
      async function decide(key, opts) { return checkRateLimit(key, opts) }
      export function limit(key, opts) { return decide(key, opts) }
      export async function rateLimit(req, route, opts) { return null }`
    expect(baseKinds(analyzeNamedExport(FILE, code, 'limit')!).has('rate_limit')).toBe(true)
    expect(baseKinds(analyzeNamedExport(FILE, code, 'rateLimit')!).has('rate_limit')).toBe(false)
  })
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
