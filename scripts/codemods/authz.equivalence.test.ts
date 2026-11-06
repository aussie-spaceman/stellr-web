/**
 * The codemod's equivalence proof. Each fixture is a real handler in a legacy idiom, one
 * for each deny shape the app uses. It is compiled and run before and after the rewrite,
 * against the frozen pre-C14 lib/admin-auth (test/fixtures/authz-legacy.ts: the live one is
 * a shim over lib/authz now, so it could not tell the two runs apart), the real
 * lib/event-access and lib/authz, over every Stellr role scenario in the truth table. The
 * two runs must answer the same: same status, same body, same redirect, same 404, same reads
 * of the role tables under clerk.
 *
 * What it does not claim: postgres on unsynced data follows the tables, and
 * lib/authz/equivalence.test.ts pins which answers move there.
 */
import { readFileSync } from 'node:fs'
import { NextResponse } from 'next/server'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { allScenarios, fakeDb, isSynced, scenarioAuth, scenarioTables, type FakeDb, type Scenario } from '@/test/fixtures/authz-principal'

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(),
  currentUser: vi.fn(async () => ({ firstName: 'Test', lastName: 'Person' })),
}))
vi.mock('@/lib/admin-auth', () => import('@/test/fixtures/authz-legacy'))
vi.mock('@/lib/supabase', () => ({ supabaseServer: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`)
  }),
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND')
  }),
}))
vi.mock('@/lib/community', () => ({ getSignedInMember: vi.fn(async () => null) }))
vi.mock('@/lib/esign/native/template-admin', () => ({ TemplateAdminError: class extends Error {} }))

import * as clerk from '@clerk/nextjs/server'
import * as navigation from 'next/navigation'
import { supabaseServer } from '@/lib/supabase'
import * as adminAuth from '@/lib/admin-auth'
import * as authz from '@/lib/authz'
import * as community from '@/lib/community'
import * as eventAccess from '@/lib/event-access'
import * as templateAdmin from '@/lib/esign/native/template-admin'
import { transformSource } from './authz'

const MODULES: Record<string, unknown> = {
  '@clerk/nextjs/server': clerk,
  'next/navigation': navigation,
  'next/server': { NextResponse },
  '@/lib/admin-auth': adminAuth,
  '@/lib/authz': authz,
  '@/lib/community': community,
  '@/lib/event-access': eventAccess,
  '@/lib/esign/native/template-admin': templateAdmin,
  '@/lib/supabase': { supabaseServer },
}

/** Compile a module's text and hand back its exports. Any import not listed above throws, so nothing is silently stubbed. */
function load(file: string, src: string): Record<string, (...a: unknown[]) => unknown> {
  const { outputText, diagnostics } = ts.transpileModule(src, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  })
  expect(diagnostics ?? []).toEqual([])
  const mod = { exports: {} as Record<string, (...a: unknown[]) => unknown> }
  const require = (name: string) => {
    if (!(name in MODULES)) throw new Error(`Fixture imports ${name}, which this test does not provide`)
    return MODULES[name]
  }
  new Function('exports', 'require', 'module', outputText)(mod.exports, require, mod)
  return mod.exports
}

let db: FakeDb

function use(s: Scenario) {
  db = fakeDb(scenarioTables(s))
  vi.mocked(supabaseServer).mockReturnValue(db.client)
  vi.mocked(clerk.auth).mockResolvedValue(scenarioAuth(s) as never)
}

/** What a caller sees: status and body, a redirect, a 404, or whatever came back. */
async function see(call: () => unknown): Promise<string> {
  try {
    const r = await call()
    if (r instanceof Response) return `${r.status} ${await r.text()}`
    // A Response held in an answer ({ ok: false, response }) serialises to {}, so open it.
    if (r && typeof r === 'object') {
      const held = await Promise.all(Object.entries(r).map(async ([k, v]) => [k, v instanceof Response ? `${v.status} ${await v.text()}` : v]))
      return JSON.stringify(Object.fromEntries(held))
    }
    return JSON.stringify(r) ?? 'undefined'
  } catch (e) {
    return `threw ${e instanceof Error ? e.message : String(e)}`
  }
}

const AUTH = "import { auth } from '@clerk/nextjs/server'"
const NEXT = "import { NextResponse } from 'next/server'"
const NAV = "import { notFound, redirect } from 'next/navigation'"
const ADMIN = "import { isAdminClaims } from '@/lib/admin-auth'"
const ROLE = 'const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role'
const ROUTE = 'app/api/admin/x/route.ts'
const PAGE = 'app/(admin)/admin/x/page.tsx'

interface Fixture {
  name: string
  /** The transform it must take. */
  transform: string
  src: string
  file?: string
  /** Named export to call. Default GET, or `default` on a page. */
  fn?: string
  args?: unknown[]
}

const lines = (...l: string[]) => `${l.join('\n')}\n`

const FIXTURES: Fixture[] = [
  {
    name: "T1: 403 'Forbidden'",
    transform: 'T1',
    src: lines(AUTH, NEXT, ADMIN, 'export async function GET() {', '  const { sessionClaims } = await auth()', "  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })", "  return NextResponse.json({ ok: 'served' })", '}'),
  },
  {
    name: "T1: signed out and not admin, one branch",
    transform: 'T1',
    src: lines(AUTH, NEXT, ADMIN, 'export async function GET() {', '  const { userId, sessionClaims } = await auth()', "  if (!userId || !isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })", '  return NextResponse.json({ userId })', '}'),
  },
  {
    name: "T1: a block branch, 'Unauthorised' first and 'Forbidden' after",
    transform: 'T1',
    src: lines(AUTH, NEXT, ADMIN, 'export async function GET() {', '  const { userId, sessionClaims } = await auth()', "  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })", '  if (!isAdminClaims(sessionClaims)) {', "    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })", '  }', "  return NextResponse.json({ ok: 'served' })", '}'),
  },
  {
    name: "T1: 403 'Admins only' in an ok/response shape",
    transform: 'T1',
    src: lines(AUTH, NEXT, ADMIN, 'export async function GET() {', '  const { userId, sessionClaims } = await auth()', "  if (!userId) return { ok: false, status: 401 }", "  if (!isAdminClaims(sessionClaims)) return { ok: false, response: NextResponse.json({ error: 'Admins only' }, { status: 403 }) }", '  return { ok: true, userId }', '}'),
  },
  {
    name: 'T1: null for a non-admin',
    transform: 'T1',
    src: lines(AUTH, ADMIN, 'export async function GET() {', '  const { userId, sessionClaims } = await auth()', '  if (!userId || !isAdminClaims(sessionClaims)) return null', '  return userId', '}'),
  },
  {
    name: "T1: a kind:'none' answer",
    transform: 'T1',
    src: lines(AUTH, ADMIN, 'export async function GET() {', '  const { userId, sessionClaims } = await auth()', "  if (!userId || !isAdminClaims(sessionClaims)) return { kind: 'none' }", "  return { kind: 'admin', userId }", '}'),
  },
  {
    name: "T1: redirect('/admin') on a page",
    transform: 'T1',
    file: PAGE,
    src: lines(AUTH, NAV, ADMIN, 'export default async function Page() {', '  const { sessionClaims } = await auth()', "  if (!isAdminClaims(sessionClaims)) redirect('/admin')", "  return 'rendered'", '}'),
  },
  {
    name: 'T1: a ternary helper with its own deny, called by the handler',
    transform: 'T1',
    src: lines(AUTH, NEXT, ADMIN, 'async function requireAdmin() {', '  const { sessionClaims } = await auth()', "  return isAdminClaims(sessionClaims) ? null : NextResponse.json({ error: 'Forbidden' }, { status: 403 })", '}', 'export async function GET() {', '  const denied = await requireAdmin()', '  if (denied) return denied', "  return NextResponse.json({ ok: 'served' })", '}'),
  },
  {
    name: 'T1: an answer held, and used to widen what is served',
    transform: 'T1',
    src: lines(AUTH, ADMIN, 'export async function GET() {', '  const { sessionClaims } = await auth()', '  let isAdmin = isAdminClaims(sessionClaims)', "  return { all: isAdmin, again: isAdminClaims(sessionClaims) ? 'yes' : 'no' }", '}'),
  },
  {
    name: 'T1: the portal shell, notFound for anyone else',
    transform: 'T1',
    file: PAGE,
    src: lines(AUTH, NAV, "import { hasAdminPortalAccess } from '@/lib/admin-auth'", 'export default async function Page() {', '  const { userId, sessionClaims } = await auth()', "  if (!userId) redirect('/sign-in')", '  if (!hasAdminPortalAccess(sessionClaims)) notFound()', "  return 'shell'", '}'),
  },
  {
    name: "T1: inline role, 403 'Unauthorised'",
    transform: 'T1',
    src: lines(AUTH, NEXT, 'export async function GET() {', '  const { sessionClaims } = await auth()', ROLE, "  if (role !== 'admin') return NextResponse.json({ error: 'Unauthorised' }, { status: 403 })", "  return NextResponse.json({ ok: 'served' })", '}'),
  },
  {
    name: "T1: inline role, redirect('/account') on a page",
    transform: 'T1',
    file: PAGE,
    src: lines(AUTH, NAV, 'export default async function Page() {', '  const { sessionClaims } = await auth()', ROLE, "  if (role !== 'admin') redirect('/account')", "  return 'rendered'", '}'),
  },
  {
    name: 'T1: inline role in place, reversed and positive',
    transform: 'T1',
    src: lines(AUTH, 'export async function GET() {', '  const { sessionClaims } = await auth()', "  const a = 'admin' === (sessionClaims as { metadata?: { role?: string } } | null)?.metadata?.role", '  return a', '}'),
  },
  {
    name: "T2: currentUserIsAdmin, 403 'Forbidden'",
    transform: 'T2',
    src: lines(NEXT, "import { currentUserIsAdmin } from '@/lib/admin-auth'", 'export async function GET() {', "  if (!(await currentUserIsAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })", "  return NextResponse.json({ ok: 'served' })", '}'),
  },
  {
    name: 'T2: currentUserHasScope, a held scope and one not held',
    transform: 'T2',
    src: lines("import { currentUserHasScope } from '@/lib/admin-auth'", 'export async function GET() {', "  return [await currentUserHasScope('events'), await currentUserHasScope('community')]", '}'),
  },
  {
    name: 'T3: an async helper, inlined',
    transform: 'T3',
    src: lines(AUTH, NEXT, ADMIN, 'async function requireAdmin() {', '  const { sessionClaims } = await auth()', '  return isAdminClaims(sessionClaims)', '}', 'export async function GET() {', "  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })", "  return NextResponse.json({ ok: 'served' })", '}'),
  },
  {
    name: 'T3: an async helper over the inline read, inlined',
    transform: 'T3',
    src: lines(AUTH, NEXT, 'async function requireAdmin() {', '  const { sessionClaims } = await auth()', "  return (sessionClaims?.metadata as { role?: string } | undefined)?.role === 'admin'", '}', 'export async function GET() {', "  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })", "  return NextResponse.json({ ok: 'served' })", '}'),
  },
  {
    name: 'T3: a helper taking the claims, inlined at each caller',
    transform: 'T3',
    src: lines(AUTH, NEXT, 'function isAdmin(sessionClaims: unknown) {', "  return (sessionClaims as { metadata?: { role?: string } } | null)?.metadata?.role === 'admin'", '}', 'export async function GET() {', '  const { sessionClaims } = await auth()', "  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })", "  return NextResponse.json({ ok: 'served' })", '}'),
  },
  {
    name: 'T4: requireAdminPage, sign-in or 404',
    transform: 'T4',
    file: PAGE,
    src: lines("import { requireAdminPage } from '@/lib/admin-auth'", 'export default async function Page() {', '  await requireAdminPage()', "  return 'rendered'", '}'),
  },
  {
    name: 'T5: per event, with the answer used to choose what is served',
    transform: 'T5',
    src: lines(NEXT, "import { requireEventAccess } from '@/lib/event-access'", "export async function GET() {", "  const access = await requireEventAccess('ev-a')", "  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })", '  return NextResponse.json({ who: access.userId, admin: access.isAdmin, slugs: access.assignedSlugs })', '}'),
  },
  {
    name: 'T5: an event nobody is assigned to',
    transform: 'T5',
    src: lines(NEXT, "import { requireEventAccess } from '@/lib/event-access'", "export async function GET() {", "  const access = await requireEventAccess('ev-z')", "  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })", '  return NextResponse.json({ who: access.userId, admin: access.isAdmin })', '}'),
  },
  {
    name: 'T5: section level',
    transform: 'T5',
    src: lines(NEXT, "import { requireEventAccess } from '@/lib/event-access'", 'export async function GET() {', '  const access = await requireEventAccess()', "  if (!access.ok) return NextResponse.json({ error: 'Forbidden' }, { status: access.status })", '  return NextResponse.json({ who: access.userId })', '}'),
  },
  {
    name: 'T5: a slug that may be undefined, with only the gate read',
    transform: 'T5',
    fn: 'GET',
    args: [null],
    src: lines("import { requireEventAccess } from '@/lib/event-access'", 'export async function GET(slug: string | null) {', '  const access = await requireEventAccess(slug ?? undefined)', '  return access.ok ? access.userId : access.status', '}'),
  },
  {
    name: 'T1, not T3: a helper answering the opposite stays a helper, so the guard is not inverted',
    transform: 'T1',
    src: lines(AUTH, NEXT, 'async function notAdmin() {', '  const { sessionClaims } = await auth()', ROLE, "  return role !== 'admin'", '}', 'export async function GET() {', "  if (await notAdmin()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })", "  return NextResponse.json({ ok: 'served' })", '}'),
  },
]

const scenarios = allScenarios()

async function everyAnswer(f: Fixture, src: string, source: string, list: Scenario[]): Promise<Record<string, string>> {
  const file = f.file ?? ROUTE
  const mod = load(file, src)
  const name = f.fn ?? (file === PAGE ? 'default' : 'GET')
  const out: Record<string, string> = {}
  for (const s of list) {
    use(s)
    vi.stubEnv('AUTHZ_SOURCE', source)
    out[s.name] = await see(() => mod[name](...(f.args ?? [])))
    vi.unstubAllEnvs()
  }
  return out
}

/** Enough different answers that an accidental constant, an always-allow or an always-deny, cannot pass. */
function expectSeveralOutcomes(answers: Record<string, string>) {
  expect(new Set(Object.values(answers)).size).toBeGreaterThan(1)
}

beforeEach(() => {
  vi.stubEnv('AUTHZ_SOURCE', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('every fixture is what it says', () => {
  it.each(FIXTURES.map((f) => [f.name, f] as const))('%s', (_name, f) => {
    const out = transformSource(f.file ?? ROUTE, f.src)
    expect(out.manual).toEqual([])
    expect(out.converted.map((c) => c.transform)).toContain(f.transform)
    expect(out.src).not.toBe(f.src)
    expect(out.src).toContain('@/lib/authz')
    expect(out.src).not.toMatch(/@\/lib\/(admin-auth|event-access)/)
  })
})

describe('the rewrite answers as the legacy guard did', () => {
  it.each(FIXTURES.map((f) => [f.name, f] as const))('clerk, every scenario: %s', async (_name, f) => {
    const want = await everyAnswer(f, f.src, 'clerk', scenarios)
    expectSeveralOutcomes(want)
    expect(await everyAnswer(f, transformSource(f.file ?? ROUTE, f.src).src, 'clerk', scenarios)).toEqual(want)
  })

  it.each(FIXTURES.map((f) => [f.name, f] as const))('unset AUTHZ_SOURCE, the production default, every scenario: %s', async (_name, f) => {
    const want = await everyAnswer(f, f.src, '', scenarios)
    expect(await everyAnswer(f, transformSource(f.file ?? ROUTE, f.src).src, '', scenarios)).toEqual(want)
  })

  it.each(FIXTURES.map((f) => [f.name, f] as const))('shadow answers as clerk, every scenario, synced or not: %s', async (_name, f) => {
    const want = await everyAnswer(f, f.src, 'clerk', scenarios)
    expect(await everyAnswer(f, transformSource(f.file ?? ROUTE, f.src).src, 'shadow', scenarios)).toEqual(want)
  })

  it.each(FIXTURES.map((f) => [f.name, f] as const))('postgres on synced data: %s', async (_name, f) => {
    const synced = scenarios.filter(isSynced)
    const want = await everyAnswer(f, f.src, 'clerk', synced)
    expect(await everyAnswer(f, transformSource(f.file ?? ROUTE, f.src).src, 'postgres', synced)).toEqual(want)
  })

  it.each(FIXTURES.map((f) => [f.name, f] as const))('clerk adds no read of any table: %s', async (_name, f) => {
    const out = transformSource(f.file ?? ROUTE, f.src).src
    const reads = async (src: string) => {
      const mod = load(f.file ?? ROUTE, src)
      const name = f.fn ?? ((f.file ?? ROUTE) === PAGE ? 'default' : 'GET')
      const all: string[][] = []
      for (const s of scenarios) {
        use(s)
        await see(() => mod[name](...(f.args ?? [])))
        all.push([...db.reads])
      }
      return all
    }
    expect(await reads(out)).toEqual(await reads(f.src))
  })
})

describe('the harness can fail', () => {
  const fixture = (name: string) => FIXTURES.find((f) => f.name === name) as Fixture

  const differs = async (f: Fixture, wrong: string) => {
    const want = await everyAnswer(f, f.src, 'clerk', scenarios)
    const got = await everyAnswer(f, wrong, 'clerk', scenarios)
    return Object.keys(want).filter((k) => want[k] !== got[k]).length
  }

  it('catches the wrong predicate: isStellrAdmin in place of the portal check', async () => {
    const f = fixture('T1: the portal shell, notFound for anyone else')
    const wrong = transformSource(PAGE, f.src).src.replaceAll('hasPortalAccess', 'isStellrAdmin')
    expect(await differs(f, wrong)).toBeGreaterThan(0)
  })

  it('catches a lost negation', async () => {
    const f = fixture("T1: 403 'Forbidden'")
    const wrong = transformSource(ROUTE, f.src).src.replace('!(await isStellrAdmin', '(await isStellrAdmin')
    expect(await differs(f, wrong)).toBeGreaterThan(0)
  })

  it('catches an un-awaited check, the bug that would pass everyone', async () => {
    const f = fixture("T1: 403 'Forbidden'")
    const wrong = transformSource(ROUTE, f.src).src.replace('!(await isStellrAdmin', '!(isStellrAdmin')
    expect(await differs(f, wrong)).toBeGreaterThan(0)
  })

  it('catches a changed deny body', async () => {
    const f = fixture("T1: 403 'Admins only' in an ok/response shape")
    const wrong = transformSource(ROUTE, f.src).src.replace('Admins only', 'Forbidden')
    expect(await differs(f, wrong)).toBeGreaterThan(0)
  })

  it('catches a slug dropped from requireEventAccess', async () => {
    const f = fixture('T5: per event, with the answer used to choose what is served')
    const wrong = transformSource(ROUTE, f.src).src.replace("requireEventAccess('ev-a', ", 'requireEventAccess(undefined, ')
    expect(await differs(f, wrong)).toBeGreaterThan(0)
  })

  it('catches a confining adapter swapped in for T4, which is why T4 does not do that', async () => {
    const f = fixture('T4: requireAdminPage, sign-in or 404')
    const wrong = transformSource(PAGE, f.src).src.replace('authz.page.requireAdmin', 'authz.page.requireStellrAdmin')
    expect(await differs(f, wrong)).toBeGreaterThan(0)
  })
})

describe('T6: the real wrappers, from a snapshot of their legacy source, rewritten in memory, over every scenario', () => {
  // The snapshot keeps this proof running after a slice converts the live file. authz.test.ts
  // checks each against the live file for as long as that is legacy.
  const FIXTURES_DIR = 'scripts/codemods/fixtures/authz'
  const wrappers: [string, string, string, (r: unknown) => unknown][] = [
    ['requireScholarshipAdmin', 'lib/scholarship-admin.ts', 'scholarship-admin', (r) => r],
    // HELD_WRAPPERS holds this one, so it is rewritten under a path on the surface.
    ['canManageStoreCatalog', 'app/api/admin/held/auth.ts', 'store-auth', (r) => r],
    ['requireSurveyAdmin', 'lib/survey/admin-auth.ts', 'survey-admin-auth', (r) => (r as { ok: boolean; userId?: string; response?: Response }).ok ? r : (r as { response: Response }).response],
    ['adminName', 'app/api/admin/esign/templates/guard.ts', 'esign-templates-guard', (r) => r],
  ]

  it.each(wrappers)('%s answers as it did', async (id, file, fixture, shape) => {
    const src = readFileSync(`${FIXTURES_DIR}/${fixture}.ts.txt`, 'utf8')
    const out = transformSource(file, src)
    expect(out.src).not.toBe(src)
    const answers = async (text: string) => {
      const mod = load(file, text)
      const got: Record<string, string> = {}
      for (const s of scenarios) {
        use(s)
        got[s.name] = await see(async () => shape(await mod[id]()))
      }
      return got
    }
    const want = await answers(src)
    expectSeveralOutcomes(want)
    expect(await answers(out.src)).toEqual(want)
  })
})

describe('one difference, pinned', () => {
  it('claims with no user id: legacy says admin and lib/authz refuses. Clerk never sends this, and refusing is the safe side', async () => {
    vi.mocked(clerk.auth).mockResolvedValue({ userId: null, sessionClaims: { metadata: { role: 'admin' } } } as never)
    vi.mocked(supabaseServer).mockReturnValue(fakeDb({}).client)
    expect(adminAuth.isAdminClaims({ metadata: { role: 'admin' } })).toBe(true)
    expect(await authz.isStellrAdmin()).toBe(false)
  })
})
