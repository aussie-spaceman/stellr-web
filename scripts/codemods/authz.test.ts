// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { analyzeDefaultExport, analyzeNamedExport, fileModule, resolveModule } from '../../lib/security/route-ast'
import { satisfies } from '../../lib/security/route-guards'
import { AFTER_WRITE, DISPOSITIONS, globToRegExp, HELD_WRAPPERS, isAdminSurface, main, routeOf, runCodemod, transformSource, transformTest } from './authz'
import { LEGACY_IDIOMS, measureIdioms } from '../authz-idioms.mjs'
import { collectSources, isTestFile, parse } from '../s5-inventory.mjs'

const ROUTE = 'app/api/admin/x/route.ts'
const PAGE = 'app/(stellr)/(admin)/admin/x/page.tsx'
const R = "{ route: '/api/admin/x' }"
const P = "{ route: '/admin/x' }"
const AUTH = "import { auth } from '@clerk/nextjs/server'\n"
const NEXT = "import { NextResponse } from 'next/server'\n"
const DENY = "NextResponse.json({ error: 'Forbidden' }, { status: 403 })"

const WRAPPER_FIXTURES: Record<string, string> = {
  'lib/scholarship-admin.ts': 'scripts/codemods/fixtures/authz/scholarship-admin.ts.txt',
  'lib/survey/admin-auth.ts': 'scripts/codemods/fixtures/authz/survey-admin-auth.ts.txt',
  'lib/store/auth.ts': 'scripts/codemods/fixtures/authz/store-auth.ts.txt',
  'app/api/admin/esign/templates/guard.ts': 'scripts/codemods/fixtures/authz/esign-templates-guard.ts.txt',
}

const run = (src: string, file = ROUTE) => transformSource(file, src)
const left = (file: string, src: string) => (measureIdioms(new Map([[file, src]])) as Record<string, Record<string, number>>)[file] ?? {}

describe('authz codemod: golden conversions', () => {
  const cases: [string, string, string, string?][] = [
    [
      'T1: isAdminClaims, keeping the response and dropping the auth() call it no longer needs',
      `${AUTH}${NEXT}import { isAdminClaims } from '@/lib/admin-auth'\n\nexport async function GET() {\n  const { sessionClaims } = await auth()\n  if (!isAdminClaims(sessionClaims)) return ${DENY}\n  return NextResponse.json({ ok: true })\n}\n`,
      `${NEXT}import { isStellrAdmin } from '@/lib/authz'\n\nexport async function GET() {\n  if (!(await isStellrAdmin(${R}))) return ${DENY}\n  return NextResponse.json({ ok: true })\n}\n`,
    ],
    [
      'T1: userId stays when it is still read',
      `${AUTH}import { isAdminClaims } from '@/lib/admin-auth'\nexport async function GET() {\n  const { userId, sessionClaims } = await auth()\n  if (!userId || !isAdminClaims(sessionClaims)) return null\n  return userId\n}\n`,
      `${AUTH}import { isStellrAdmin } from '@/lib/authz'\nexport async function GET() {\n  const { userId } = await auth()\n  if (!userId || !(await isStellrAdmin(${R}))) return null\n  return userId\n}\n`,
    ],
    [
      'T1: the claims stay when something else reads them',
      `${AUTH}import { isAdminClaims } from '@/lib/admin-auth'\nexport async function GET() {\n  const { sessionClaims } = await auth()\n  if (!isAdminClaims(sessionClaims)) return null\n  return sessionClaims?.email\n}\n`,
      `${AUTH}import { isStellrAdmin } from '@/lib/authz'\nexport async function GET() {\n  const { sessionClaims } = await auth()\n  if (!(await isStellrAdmin(${R}))) return null\n  return sessionClaims?.email\n}\n`,
    ],
    [
      'T1: an answer held in a let, a positive branch and a ternary',
      `${AUTH}import { isAdminClaims } from '@/lib/admin-auth'\nexport async function GET() {\n  const { sessionClaims } = await auth()\n  let a = isAdminClaims(sessionClaims)\n  if (isAdminClaims(sessionClaims)) a = false\n  return isAdminClaims(sessionClaims) ? null : a\n}\n`,
      `import { isStellrAdmin } from '@/lib/authz'\nexport async function GET() {\n  let a = await isStellrAdmin(${R})\n  if (await isStellrAdmin(${R})) a = false\n  return (await isStellrAdmin(${R})) ? null : a\n}\n`,
    ],
    [
      'T1: a redirect on a page, an aliased import and an aliased claim',
      `${AUTH}import { redirect } from 'next/navigation'\nimport { isAdminClaims as ok } from '@/lib/admin-auth'\nexport default async function Page() {\n  const { sessionClaims: c } = await auth()\n  if (!ok(c)) redirect('/admin')\n  return null\n}\n`,
      `import { redirect } from 'next/navigation'\nimport { isStellrAdmin } from '@/lib/authz'\nexport default async function Page() {\n  if (!(await isStellrAdmin(${P}))) redirect('/admin')\n  return null\n}\n`,
      PAGE,
    ],
    [
      'T1: hasAdminPortalAccess, which also lets an event manager in',
      `${AUTH}import { hasAdminPortalAccess, isAdminClaims } from '@/lib/admin-auth'\nexport async function GET() {\n  const { sessionClaims } = await auth()\n  if (!hasAdminPortalAccess(sessionClaims)) return null\n  return isAdminClaims(sessionClaims)\n}\n`,
      `import { hasPortalAccess, isStellrAdmin } from '@/lib/authz'\nexport async function GET() {\n  if (!(await hasPortalAccess(${R}))) return null\n  return await isStellrAdmin(${R})\n}\n`,
    ],
    [
      'T1: the inline role read through a local',
      `${AUTH}export async function GET() {\n  const { sessionClaims } = await auth()\n  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role\n  if (role !== 'admin') return ${DENY.replace('Forbidden', 'Unauthorised')}\n  return 1\n}\n`,
      `import { isStellrAdmin } from '@/lib/authz'\nexport async function GET() {\n  if (!(await isStellrAdmin(${R}))) return ${DENY.replace('Forbidden', 'Unauthorised')}\n  return 1\n}\n`,
    ],
    [
      'T1: the inline role read in place',
      `${AUTH}export async function GET() {\n  const { sessionClaims } = await auth()\n  const a = (sessionClaims as { metadata?: { role?: string } } | null)?.metadata?.role === 'admin'\n  return a\n}\n`,
      `import { isStellrAdmin } from '@/lib/authz'\nexport async function GET() {\n  const a = await isStellrAdmin(${R})\n  return a\n}\n`,
    ],
    [
      'T2: currentUserIsAdmin',
      `import { currentUserIsAdmin } from '@/lib/admin-auth'\nexport async function GET() {\n  if (!(await currentUserIsAdmin())) return ${DENY}\n}\n`,
      `import { isStellrAdmin } from '@/lib/authz'\nexport async function GET() {\n  if (!(await isStellrAdmin(${R}))) return ${DENY}\n}\n`,
    ],
    [
      'T2: currentUserHasScope, and a type taken with it stays behind',
      `import { currentUserHasScope, type DutyScope } from '@/lib/admin-auth'\nconst s: DutyScope = 'events'\nexport async function GET() {\n  return await currentUserHasScope(s)\n}\n`,
      `import { hasScope } from '@/lib/authz'\nimport { type DutyScope } from '@/lib/admin-auth'\nconst s: DutyScope = 'events'\nexport async function GET() {\n  return await hasScope(s, ${R})\n}\n`,
    ],
    [
      'T3: an async helper is inlined and deleted, with the comment on it',
      `${AUTH}import { isAdminClaims } from '@/lib/admin-auth'\n\n// Only admins.\nasync function requireAdmin() {\n  const { sessionClaims } = await auth()\n  return isAdminClaims(sessionClaims)\n}\n\nexport async function GET() {\n  if (!(await requireAdmin())) return 1\n  return 2\n}\n`,
      `import { isStellrAdmin } from '@/lib/authz'\n\nexport async function GET() {\n  if (!(await isStellrAdmin(${R}))) return 1\n  return 2\n}\n`,
    ],
    [
      'T3: an async helper over the inline read',
      `${AUTH}async function requireAdmin() {\n  const { sessionClaims } = await auth()\n  return (sessionClaims?.metadata as { role?: string } | undefined)?.role === 'admin'\n}\nexport async function GET() {\n  return (await requireAdmin()) ? 1 : 2\n}\n`,
      `import { isStellrAdmin } from '@/lib/authz'\nexport async function GET() {\n  return (await isStellrAdmin(${R})) ? 1 : 2\n}\n`,
    ],
    [
      'T3: a helper over the claims it is handed, every caller from auth()',
      `${AUTH}function requireAdmin(sessionClaims: Record<string, unknown> | null | undefined) {\n  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role\n  return role === 'admin'\n}\n\nexport async function GET() {\n  const { sessionClaims } = await auth()\n  if (!requireAdmin(sessionClaims)) return 1\n  return 2\n}\n`,
      `import { isStellrAdmin } from '@/lib/authz'\nexport async function GET() {\n  if (!(await isStellrAdmin(${R}))) return 1\n  return 2\n}\n`,
    ],
    [
      'T1, not T3: a helper with its own deny response stays, over lib/authz',
      `${AUTH}import { isAdminClaims } from '@/lib/admin-auth'\nasync function requireAdmin() {\n  const { sessionClaims } = await auth()\n  return isAdminClaims(sessionClaims) ? null : 403\n}\nexport async function GET() {\n  return await requireAdmin()\n}\n`,
      `import { isStellrAdmin } from '@/lib/authz'\nasync function requireAdmin() {\n  return (await isStellrAdmin(${R})) ? null : 403\n}\nexport async function GET() {\n  return await requireAdmin()\n}\n`,
    ],
    [
      'T4: requireAdminPage, beside a local called page',
      `import { requireAdminPage } from '@/lib/admin-auth'\nexport default async function Page({ page }: { page: number }) {\n  await requireAdminPage()\n  return page\n}\n`,
      `import { authz } from '@/lib/authz'\nexport default async function Page({ page }: { page: number }) {\n  await authz.page.requireAdmin(${P})\n  return page\n}\n`,
      PAGE,
    ],
    [
      'T5: a slug',
      `import { requireEventAccess } from '@/lib/event-access'\nexport async function GET(slug: string) {\n  const access = await requireEventAccess(slug)\n  if (!access.ok) return access.status\n  return access.assignedSlugs\n}\n`,
      `import { requireEventAccess } from '@/lib/authz'\nexport async function GET(slug: string) {\n  const access = await requireEventAccess(slug, ${R})\n  if (!access.ok) return access.status\n  return access.assignedSlugs\n}\n`,
    ],
    [
      'T5: section level, with the options after an explicit undefined',
      `import { requireEventAccess, type EventAccess } from '@/lib/event-access'\nexport async function GET() {\n  const access: EventAccess = await requireEventAccess()\n  return access.ok\n}\n`,
      `import { requireEventAccess, type EventAccess } from '@/lib/authz'\nexport async function GET() {\n  const access: EventAccess = await requireEventAccess(undefined, ${R})\n  return access.ok\n}\n`,
    ],
    [
      'T5: a type-only import moves too',
      `import { requireEventAccess } from '@/lib/event-access'\nimport type { EventAccess } from '@/lib/event-access'\nexport async function GET(): Promise<EventAccess | null> {\n  const a = await requireEventAccess()\n  return a.ok ? null : null\n}\n`,
      `import { requireEventAccess } from '@/lib/authz'\nimport type { EventAccess } from '@/lib/authz'\nexport async function GET(): Promise<EventAccess | null> {\n  const a = await requireEventAccess(undefined, ${R})\n  return a.ok ? null : null\n}\n`,
    ],
    [
      'merges into an existing lib/authz import',
      `${AUTH}import { isAdminClaims } from '@/lib/admin-auth'\nimport { hasScope } from '@/lib/authz'\nexport async function GET() {\n  const { sessionClaims } = await auth()\n  return (await hasScope('events')) && isAdminClaims(sessionClaims)\n}\n`,
      `import { hasScope, isStellrAdmin } from '@/lib/authz'\nexport async function GET() {\n  return (await hasScope('events')) && await isStellrAdmin(${R})\n}\n`,
    ],
    [
      'semicolons and double quotes survive',
      `import { currentUserIsAdmin } from "@/lib/admin-auth";\nexport async function GET() {\n  return await currentUserIsAdmin();\n}\n`,
      `import { isStellrAdmin } from "@/lib/authz";\nexport async function GET() {\n  return await isStellrAdmin({ route: "/api/admin/x" });\n}\n`,
    ],
    [
      'a file with no route gets no route option',
      `import { auth } from '@clerk/nextjs/server'\nimport { isAdminClaims } from '@/lib/admin-auth'\nexport async function canManageStoreCatalog() {\n  const { sessionClaims } = await auth()\n  return isAdminClaims(sessionClaims)\n}\n`,
      `import { isStellrAdmin } from '@/lib/authz'\nexport async function canManageStoreCatalog() {\n  return await isStellrAdmin()\n}\n`,
      'lib/scholarship-admin.ts',
    ],
  ]

  it.each(cases)('%s', (_name, input, expected, file) => {
    const out = run(input, file)
    expect(out.src).toBe(expected)
    expect(out.manual).toEqual([])
    expect(out.converted.length).toBeGreaterThan(0)
  })

  it.each(cases)('%s: a second run changes nothing', (_name, input, _expected, file) => {
    const once = run(input, file)
    const twice = run(once.src, file)
    expect(twice.src).toBe(once.src)
    expect(twice.converted).toEqual([])
  })

  it.each(cases)('%s: the ratchet no longer sees a converted idiom', (_name, input, _expected, file) => {
    const f = file ?? ROUTE
    const remaining = Object.keys(left(f, run(input, file).src))
    // T4 is a swap: the ratchet keeps counting the page until a person moves it on.
    expect(remaining.filter((id) => id !== 'pageRequireAdmin')).toEqual([])
  })

  it('leaves every other byte of the file alone', () => {
    const before = `${AUTH}import { isAdminClaims } from '@/lib/admin-auth'\n\n// a comment   with odd   spacing\nexport async function GET()   {\n  const { sessionClaims } = await auth()\n\n\n  if (!isAdminClaims(sessionClaims)) {\n      return   'no'  // why\n  }\n}\n`
    const after = `import { isStellrAdmin } from '@/lib/authz'\n\n// a comment   with odd   spacing\nexport async function GET()   {\n\n\n  if (!(await isStellrAdmin(${R}))) {\n      return   'no'  // why\n  }\n}\n`
    expect(run(before).src).toBe(after)
  })

  it('tidies every handler in a file with many, whatever the count', () => {
    const handler = (m: string) => `export async function ${m}() {\n  const { sessionClaims } = await auth()\n  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role\n  if (role !== 'admin') return 1\n  return 2\n}\n`
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
    const out = run(`${AUTH}${methods.map(handler).join('\n')}`)
    expect(out.manual).toEqual([])
    expect(out.src).not.toMatch(/auth\(\)|sessionClaims|const role|@clerk/)
    expect(out.src.match(/isStellrAdmin\(/g)).toHaveLength(methods.length)
  })

  it('says what it did, by transform and idiom', () => {
    const out = run(`import { currentUserIsAdmin } from '@/lib/admin-auth'\nimport { requireEventAccess } from '@/lib/event-access'\nexport async function GET() {\n  const a = await requireEventAccess()\n  return a.ok && (await currentUserIsAdmin())\n}\n`)
    expect(out.converted.map((c) => [c.transform, c.idiom]).sort()).toEqual([
      ['T2', 'currentUserIsAdmin'],
      ['T5', 'requireEventAccess'],
    ])
  })
})

describe('authz codemod: what stays', () => {
  const claimsHelper = "export function check(sessionClaims: unknown) { return isAdminClaims(sessionClaims) }\n"
  const adminAuth = "import { isAdminClaims } from '@/lib/admin-auth'\n"

  const stays: [string, string, RegExp][] = [
    ['claims handed in as a parameter', `${adminAuth}${claimsHelper}`, /isAdminClaims.*do not come from/],
    ['claims from a member of the auth() answer', `${AUTH}${adminAuth}export async function GET() {\n  const s = await auth()\n  return isAdminClaims(s.sessionClaims)\n}\n`, /do not come from/],
    ['claims that are not Clerk\'s', `import { auth } from '@/lib/other'\n${adminAuth}export async function GET() {\n  const { sessionClaims } = await auth()\n  return isAdminClaims(sessionClaims)\n}\n`, /do not come from/],
    ['auth() with options', `${AUTH}${adminAuth}export async function GET() {\n  const { sessionClaims } = await auth({ x: 1 })\n  return isAdminClaims(sessionClaims)\n}\n`, /do not come from/],
    ['claims in a let, which may be reassigned', `${AUTH}${adminAuth}export async function GET() {\n  let { sessionClaims } = await auth()\n  return isAdminClaims(sessionClaims)\n}\n`, /do not come from/],
    ['a rest element, which removing claims would change', `${AUTH}${adminAuth}export async function GET() {\n  const { sessionClaims, ...rest } = await auth()\n  return [isAdminClaims(sessionClaims), rest]\n}\n`, /do not come from/],
    ['inside a nested function', `${AUTH}${adminAuth}export async function GET() {\n  const { sessionClaims } = await auth()\n  return [1].map(() => isAdminClaims(sessionClaims))\n}\n`, /nested function/],
    ['a claims local shadowing the real one', `${AUTH}${adminAuth}export async function GET(sessionClaims: unknown) {\n  { const { sessionClaims: other } = await auth(); void other }\n  return isAdminClaims(sessionClaims)\n}\n`, /do not come from/],
    ['the isStellrAdmin name already taken', `${AUTH}${adminAuth}const isStellrAdmin = 1\nexport async function GET() {\n  const { sessionClaims } = await auth()\n  return [isStellrAdmin, isAdminClaims(sessionClaims)]\n}\n`, /already declares isStellrAdmin/],
    ['a role read for another value too', `${AUTH}export async function GET() {\n  const { sessionClaims } = await auth()\n  const role = (sessionClaims?.metadata as { role?: string })?.role\n  if (role !== 'admin' && role !== 'event_manager') return 1\n}\n`, /other than admin/],
    ['a role handed on', `${AUTH}export async function GET() {\n  const { sessionClaims } = await auth()\n  const role = (sessionClaims?.metadata as { role?: string })?.role\n  return role === 'admin' ? role : null\n}\n`, /other than admin/],
    ['a live publicMetadata role, a different source from the session', `import { currentUser } from '@clerk/nextjs/server'\nexport async function GET() {\n  const u = await currentUser()\n  return (u?.publicMetadata as { role?: string })?.role === 'admin'\n}\n`, /clerkRoleRead.*publicMetadata/],
    ['another user\'s role', `export async function GET(c: any) {\n  const u = await c.users.getUser('x')\n  const role = (u.publicMetadata as { role?: unknown })?.role\n  return role\n}\n`, /clerkRoleRead/],
    ['isEventManagerClaims', `${AUTH}import { isEventManagerClaims } from '@/lib/admin-auth'\nexport async function GET() {\n  const { sessionClaims } = await auth()\n  return isEventManagerClaims(sessionClaims)\n}\n`, /isEventManagerClaims.*no claim-only form/],
    ['isCrewRole', `import { isCrewRole } from '@/lib/admin-auth'\nexport const f = (r: unknown) => isCrewRole(r)\n`, /isCrewRole.*target/],
    ['CREW_CLERK_ROLES', `import { CREW_CLERK_ROLES } from '@/lib/admin-auth'\nexport const f = CREW_CLERK_ROLES\n`, /CREW_CLERK_ROLES/],
    ['a literal role list', "export const f = new Set(['admin', 'event_manager'])\n", /portalRoleList/],
    ['a role-table read', "export const f = (db: any) => db.from('admin_duties').select('scopes')\n", /roleTableRead/],
    ['a namespace import', "import * as a from '@/lib/admin-auth'\nexport const f = () => a.currentUserIsAdmin()\n", /currentUserIsAdmin/],
    ['a dynamic import', "export async function f() { const { currentUserIsAdmin } = await import('@/lib/admin-auth'); return currentUserIsAdmin() }\n", /currentUserIsAdmin/],
    ['a helper passed by reference', `${adminAuth}export const f = (l: unknown[]) => l.filter(isAdminClaims)\n`, /isAdminClaims/],
    ['currentUserIsAdmin passed by reference, where its argument would become options', "import { currentUserIsAdmin } from '@/lib/admin-auth'\nexport const f = (l: unknown[]) => l.map(currentUserIsAdmin)\n", /currentUserIsAdmin/],
    ['an un-awaited currentUserIsAdmin', "import { currentUserIsAdmin } from '@/lib/admin-auth'\nexport async function GET() {\n  if (!currentUserIsAdmin()) return 1\n}\n", /not awaited/],
    ['an un-awaited requireAdminPage', "import { requireAdminPage } from '@/lib/admin-auth'\nexport async function GET() {\n  requireAdminPage()\n}\n", /not awaited/],
    ['the access answer returned whole, which would add tenantId', "import { requireEventAccess } from '@/lib/event-access'\nexport async function GET() {\n  const a = await requireEventAccess()\n  return a\n}\n", /requireEventAccess.*whole/],
    ['the access answer spread', "import { requireEventAccess } from '@/lib/event-access'\nexport async function GET() {\n  const a = await requireEventAccess()\n  return { ...a }\n}\n", /whole/],
    ['the access answer destructured', "import { requireEventAccess } from '@/lib/event-access'\nexport async function GET() {\n  const { ok } = await requireEventAccess()\n  return ok\n}\n", /whole/],
    ['the access answer never read', "import { requireEventAccess } from '@/lib/event-access'\nexport async function GET() {\n  const a = await requireEventAccess()\n}\n", /never read/],
    ['an un-awaited requireEventAccess', "import { requireEventAccess } from '@/lib/event-access'\nexport function GET() {\n  return requireEventAccess()\n}\n", /not awaited/],
    ['the authz name taken for T4', "import { requireAdminPage } from '@/lib/admin-auth'\nconst authz = 1\nexport async function GET() {\n  await requireAdminPage()\n  return authz\n}\n", /already declares authz/],
    ['a section-level answer guarding a row by id, on isAdmin and assignedSlugs', `import { requireEventAccess } from '@/lib/event-access'\nexport async function POST(id: string) {\n  const access = await requireEventAccess()\n  if (!access.ok) return access.status\n  const reg = await load(id)\n  if (!access.isAdmin && !(access.assignedSlugs ?? []).includes(reg.event_slug)) return 403\n  return reg\n}\n`, /requireEventAccess: a section-level answer.*accessCoversEvent/],
    ['a section-level answer guarding a row by id, on isAdmin alone', "import { requireEventAccess } from '@/lib/event-access'\nexport async function POST() {\n  const access = await requireEventAccess()\n  if (access.isAdmin) return null\n  return 403\n}\n", /section-level/],
    ['a section-level answer listing across events', "import { requireEventAccess } from '@/lib/event-access'\nexport default async function Page() {\n  const access = await requireEventAccess()\n  return access.assignedSlugs === null ? all() : some(access.assignedSlugs)\n}\n", /section-level/],
    ['an explicit undefined, read for isAdmin', "import { requireEventAccess } from '@/lib/event-access'\nexport async function GET() {\n  const access = await requireEventAccess(undefined)\n  return access.isAdmin\n}\n", /section-level/],
    ['a slug that can come out undefined', "import { requireEventAccess } from '@/lib/event-access'\nexport async function POST(cred: { event_slug: string | null }) {\n  const access = await requireEventAccess(cred.event_slug ?? undefined)\n  return access.isAdmin\n}\n", /section-level/],
    ['a slug read through an optional chain', "import { requireEventAccess } from '@/lib/event-access'\nexport async function POST(cred?: { event_slug: string }) {\n  const access = await requireEventAccess(cred?.event_slug)\n  return access.assignedSlugs\n}\n", /section-level/],
    ['an optional slug parameter', "import { requireEventAccess } from '@/lib/event-access'\nexport async function check(slug?: string) {\n  const access = await requireEventAccess(slug)\n  return access.isAdmin\n}\n", /section-level/],
  ]

  it.each(stays)('leaves %s, and reports it', (_name, src, why) => {
    const out = run(src)
    expect(out.manual.map((m) => `${m.idiom}: ${m.why}`).join('\n')).toMatch(why)
    // The named site stays. Sites the tool can prove in the same file still convert.
    expect(run(out.src).src).toBe(out.src)
  })

  it('a section-level answer left for a person stays counted, so the ratchet cannot reach 0 past it', () => {
    const src = "import { requireEventAccess } from '@/lib/event-access'\nexport async function POST() {\n  const access = await requireEventAccess()\n  if (!access.isAdmin) return 403\n}\n"
    const out = run(src)
    expect(out.src).toBe(src)
    expect(out.converted).toEqual([])
    expect(left(ROUTE, out.src)).toEqual({ requireEventAccess: 1 })
  })

  it('a section-level check that only reads ok, status or userId converts: it trusts nothing about reach', () => {
    const out = run("import { requireEventAccess } from '@/lib/event-access'\nexport async function GET() {\n  const access = await requireEventAccess()\n  if (!access.ok) return access.status\n  return access.userId\n}\n")
    expect(out.manual).toEqual([])
    expect(out.converted.map((c) => c.transform)).toEqual(['T5'])
  })

  it('a named slug may still read isAdmin and assignedSlugs: that event\'s tenant decided the answer', () => {
    const out = run("import { requireEventAccess } from '@/lib/event-access'\nexport async function GET(slug: string) {\n  const access = await requireEventAccess(slug)\n  return access.isAdmin ? access.assignedSlugs : null\n}\n")
    expect(out.manual).toEqual([])
    expect(out.converted.map((c) => c.transform)).toEqual(['T5'])
  })

  it('one section-level read keeps the whole file on the old import', () => {
    const src = "import { requireEventAccess } from '@/lib/event-access'\nexport async function GET(slug: string) {\n  const a = await requireEventAccess(slug)\n  return a.ok\n}\nexport async function POST() {\n  const b = await requireEventAccess()\n  return b.isAdmin\n}\n"
    expect(run(src).src).toBe(src)
  })

  describe('T3 never inlines a helper whose answer is the opposite of the check', () => {
    const inverted: [string, string][] = [
      ['a negated role compare', "return (sessionClaims?.metadata as { role?: string } | undefined)?.role !== 'admin'"],
      ['a reversed negated compare', "return 'admin' !== (sessionClaims?.metadata as { role?: string } | undefined)?.role"],
    ]

    it.each(inverted)('%s: the helper stays, over lib/authz, and still answers the opposite', (_name, ret) => {
      const out = run(`${AUTH}async function notAdmin() {\n  const { sessionClaims } = await auth()\n  ${ret}\n}\nexport async function GET() {\n  if (await notAdmin()) return 403\n  return 200\n}\n`)
      expect(out.src).toContain('async function notAdmin()')
      expect(out.src).toContain('if (await notAdmin()) return 403')
      expect(out.src).toContain(`!(await isStellrAdmin(${R}))`)
      expect(out.converted.map((c) => c.transform)).toEqual(['T1'])
    })

    it('a negated local role: the helper stays', () => {
      const out = run(`${AUTH}async function notAdmin() {\n  const { sessionClaims } = await auth()\n  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role\n  return role !== 'admin'\n}\nexport async function GET() {\n  return await notAdmin()\n}\n`)
      expect(out.src).toContain('async function notAdmin()')
      expect(out.src).toContain(`!(await isStellrAdmin(${R}))`)
    })

    it('a negated legacy call: the helper stays', () => {
      const out = run(`${AUTH}import { isAdminClaims } from '@/lib/admin-auth'\nasync function notAdmin() {\n  const { sessionClaims } = await auth()\n  return !isAdminClaims(sessionClaims)\n}\nexport async function GET() {\n  return await notAdmin()\n}\n`)
      expect(out.src).toContain('async function notAdmin()')
      expect(out.src).toContain(`!(await isStellrAdmin(${R}))`)
    })

    it('a helper over claims it is handed, negated: left, and reported', () => {
      const src = `${AUTH}function notAdmin(c: unknown) {\n  return (c as { metadata?: { role?: string } })?.metadata?.role !== 'admin'\n}\nexport async function GET() {\n  const { sessionClaims } = await auth()\n  return notAdmin(sessionClaims)\n}\n`
      const out = run(src)
      expect(out.src).toBe(src)
      expect(out.manual.map((m) => m.idiom)).toContain('clerkRoleRead')
    })
  })

  it('T3 leaves a helper something else imports, which deleting it would break', () => {
    const out = run(`${AUTH}import { isAdminClaims } from '@/lib/admin-auth'\nexport async function requireAdmin() {\n  const { sessionClaims } = await auth()\n  return isAdminClaims(sessionClaims)\n}\nexport async function GET() {\n  return await requireAdmin()\n}\n`)
    expect(out.src).toContain('export async function requireAdmin()')
  })

  it('T3 leaves a helper handed on by reference', () => {
    const out = run(`${AUTH}import { isAdminClaims } from '@/lib/admin-auth'\nasync function requireAdmin() {\n  const { sessionClaims } = await auth()\n  return isAdminClaims(sessionClaims)\n}\nexport const GET = () => requireAdmin\n`)
    expect(out.src).toContain('async function requireAdmin()')
  })

  it('T5 is all or nothing per file: one whole-value use keeps every site on the old import', () => {
    const src = "import { requireEventAccess } from '@/lib/event-access'\nexport async function GET() {\n  const a = await requireEventAccess()\n  return a\n}\nexport async function POST() {\n  const b = await requireEventAccess()\n  return b.ok\n}\n"
    expect(run(src).src).toBe(src)
  })

  it.each([
    ['a held result', 'const x = log()'],
    ['a bare statement', 'log()'],
  ])('T3 leaves a helper with %s before its return, and T1 converts what it can inside', (_name, line) => {
    const src = `${AUTH}${adminAuth}async function requireAdmin() {\n  const { sessionClaims } = await auth()\n  ${line}\n  return isAdminClaims(sessionClaims)\n}\nexport async function GET() {\n  return await requireAdmin()\n}\n`
    const out = run(src)
    expect(out.src).toContain(line)
    expect(out.src).toContain('async function requireAdmin()')
    expect(out.src).toContain(`await isStellrAdmin(${R})`)
  })

  it('T5 stays for a field that lib/event-access does not return', () => {
    const src = "import { requireEventAccess } from '@/lib/event-access'\nexport async function GET() {\n  const a = await requireEventAccess()\n  return a.ok && a.tenantId\n}\n"
    const out = run(src)
    expect(out.src).toBe(src)
    expect(out.manual.map((m) => m.idiom)).toContain('requireEventAccess')
  })

  it('T3 leaves a claims helper when one caller passes something else, and reports the site', () => {
    const src = `${AUTH}function isAdmin(c: unknown) {\n  return (c as { metadata?: { role?: string } })?.metadata?.role === 'admin'\n}\nexport async function GET(other: unknown) {\n  const { sessionClaims } = await auth()\n  return [isAdmin(sessionClaims), isAdmin(other)]\n}\n`
    const out = run(src)
    expect(out.src).toContain('function isAdmin(c: unknown)')
    expect(out.manual.map((m) => m.idiom)).toContain('clerkRoleRead')
  })

  it.each([
    ['a request body', "export async function POST(req: Request) {\n  const b = await req.json()\n  return b.role === 'admin'\n}\n"],
    ['a database row', "export const f = (row: { role: string }) => row.role === 'admin'\n"],
    ['a look-alike module', "import { isAdminClaims } from '@/lib/not-admin-auth'\nexport const f = (c: unknown) => isAdminClaims(c)\n"],
    ['a local of the same name', 'function isAdminClaims() { return true }\nexport const f = () => isAdminClaims()\n'],
    ['a name in a comment or a string', "// isAdminClaims(sessionClaims)\nexport const a = 'requireAdminPage'\n"],
    ['requireEventAccess already on lib/authz', "import { requireEventAccess } from '@/lib/authz'\nexport async function GET() {\n  const a = await requireEventAccess()\n  return a.ok\n}\n"],
  ])('does not touch or report %s', (_name, src) => {
    const out = run(src)
    expect(out.src).toBe(src)
    expect(out.manual).toEqual([])
  })

  it.each([
    ['proxy.ts', 'the proxy, which must stay database-free'],
    ['lib/community.ts', 'a lib helper that serves members'],
    ['app/(stellr)/(member)/layout.tsx', 'the member shell'],
    ['app/api/store/returns/route.ts', 'a route members reach'],
    ['components/layout/NavUserButton.tsx', 'a client component outside the surface'],
    ['lib/admin-auth.ts', 'the legacy module'],
    ['lib/event-access.ts', 'the legacy module'],
  ])('refuses %s: %s', (file) => {
    const src = `${AUTH}import { isAdminClaims } from '@/lib/admin-auth'\nexport async function GET() {\n  const { sessionClaims } = await auth()\n  return isAdminClaims(sessionClaims)\n}\n`
    const out = transformSource(file, src)
    expect(out.src).toBe(src)
    expect(out.manual.map((m) => m.why).join()).toMatch(/outside the admin surface/)
  })

  it('holds lib/store/auth.ts, and names the member route it waits on', () => {
    const src = readFileSync(WRAPPER_FIXTURES['lib/store/auth.ts'], 'utf8')
    const out = transformSource('lib/store/auth.ts', src)
    expect(out.src).toBe(src)
    expect(out.converted).toEqual([])
    expect(out.manual.map((m) => m.why).join()).toMatch(/store\/returns.*sampling decision/)
  })

  it('every wrapper it will convert serves staff only: a caller outside the surface means it belongs in HELD_WRAPPERS', () => {
    const sources: Map<string, string> = collectSources(process.cwd())
    const wrappers = (LEGACY_IDIOMS as { id: string; kind: string; file?: string }[]).filter((i) => i.kind === 'wrapper')
    const outside: string[] = []
    for (const [file, src] of sources) {
      if (isTestFile(file)) continue
      for (const s of (parse(file, src) as ts.SourceFile).statements) {
        if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier)) continue
        const nb = s.importClause?.namedBindings
        if (!nb || !ts.isNamedImports(nb)) continue
        const module = resolveModule(file, s.moduleSpecifier.text)
        for (const w of wrappers) {
          if (fileModule(w.file as string) !== module || !nb.elements.some((el) => (el.propertyName ?? el.name).text === w.id)) continue
          if (!isAdminSurface(file) && !((w.file as string) in HELD_WRAPPERS)) outside.push(`${file} -> ${w.id}`)
        }
      }
    }
    expect(outside).toEqual([])
    // The hold is still earned: the member route is why it is there.
    expect(sources.get('app/api/store/returns/route.ts')).toContain('canManageStoreCatalog')
  })

  it('refuses a client component on the admin surface', () => {
    const src = `'use client'\n${AUTH}import { isAdminClaims } from '@/lib/admin-auth'\nexport async function f() {\n  const { sessionClaims } = await auth()\n  return isAdminClaims(sessionClaims)\n}\n`
    const out = transformSource('app/(stellr)/(admin)/admin/x/Thing.tsx', src)
    expect(out.src).toBe(src)
    expect(out.manual.map((m) => m.why).join()).toMatch(/client component/)
  })

})

describe('authz codemod: the static guard check still passes on the output', () => {
  const kindsOf = (file: string, src: string, name: string) => {
    const f = name === 'default' ? analyzeDefaultExport(file, src) : analyzeNamedExport(file, src, name)
    return f ? [...satisfies(f)] : []
  }

  it.each([
    ['T1', `${AUTH}import { isAdminClaims } from '@/lib/admin-auth'\nexport async function GET() {\n  const { sessionClaims } = await auth()\n  if (!isAdminClaims(sessionClaims)) return 1\n  return 2\n}\n`, 'GET', ROUTE],
    ['T1, inline', `${AUTH}export async function GET() {\n  const { sessionClaims } = await auth()\n  const role = (sessionClaims?.metadata as { role?: string })?.role\n  if (role !== 'admin') return 1\n  return 2\n}\n`, 'GET', ROUTE],
    ['T1, return', `${AUTH}import { isAdminClaims } from '@/lib/admin-auth'\nexport async function check() {\n  const { sessionClaims } = await auth()\n  return isAdminClaims(sessionClaims)\n}\n`, 'check', 'lib/scholarship-admin.ts'],
    ['T2', "import { currentUserIsAdmin } from '@/lib/admin-auth'\nexport async function GET() {\n  if (!(await currentUserIsAdmin())) return 1\n}\n", 'GET', ROUTE],
    ['T2, scope', "import { currentUserHasScope } from '@/lib/admin-auth'\nexport async function GET() {\n  if (!(await currentUserHasScope('events'))) return 1\n}\n", 'GET', ROUTE],
    ['T3', `${AUTH}import { isAdminClaims } from '@/lib/admin-auth'\nasync function requireAdmin() {\n  const { sessionClaims } = await auth()\n  return isAdminClaims(sessionClaims)\n}\nexport async function GET() {\n  if (!(await requireAdmin())) return 1\n}\n`, 'GET', ROUTE],
    ['T4', "import { requireAdminPage } from '@/lib/admin-auth'\nexport default async function Page() {\n  await requireAdminPage()\n  return null\n}\n", 'default', PAGE],
    ['T5', "import { requireEventAccess } from '@/lib/event-access'\nexport async function GET(slug: string) {\n  const a = await requireEventAccess(slug)\n  if (!a.ok) return 1\n}\n", 'GET', ROUTE],
    ['T5, section', "import { requireEventAccess } from '@/lib/event-access'\nexport async function GET() {\n  const a = await requireEventAccess()\n  if (!a.ok) return 1\n}\n", 'GET', ROUTE],
  ])('%s still reaches an admin check', (_name, src, name, file) => {
    const out = transformSource(file, src)
    expect(out.converted.length).toBeGreaterThan(0)
    expect(kindsOf(file, out.src, name)).toContain('admin')
  })

  it('T5 with the options keeps a section-level check from reading as a named event', () => {
    const named = transformSource(ROUTE, "import { requireEventAccess } from '@/lib/event-access'\nexport async function GET(slug: string) {\n  const a = await requireEventAccess(slug)\n  return a.ok\n}\n")
    const section = transformSource(ROUTE, "import { requireEventAccess } from '@/lib/event-access'\nexport async function GET() {\n  const a = await requireEventAccess()\n  return a.ok\n}\n")
    expect(kindsOf(ROUTE, named.src, 'GET')).toContain('tenant')
    expect(kindsOf(ROUTE, section.src, 'GET')).not.toContain('tenant')
  })
})

describe('authz codemod: T6, the wrappers in their own files, from a snapshot taken while they were legacy', () => {
  const WRAPPERS = (LEGACY_IDIOMS as { id: string; kind: string; file?: string }[]).filter((i) => i.kind === 'wrapper')
  /** A held wrapper is rewritten as if it sat on the surface, so its proof is ready when the hold comes off. */
  const rewritten = (file: string, src: string) => transformSource(file in HELD_WRAPPERS ? 'app/api/admin/held/auth.ts' : file, src)

  it.each(WRAPPERS.map((w) => [w.id, w.file as string] as const))('%s: the snapshot is the live file, until a slice converts the live file', (_id, file) => {
    const live = readFileSync(file, 'utf8')
    // Once converted the snapshot is all that is left of the legacy form, and it stays the proof.
    if (/@\/lib\/admin-auth/.test(live)) expect(readFileSync(WRAPPER_FIXTURES[file], 'utf8'), `${file} changed while still legacy. Copy it over ${WRAPPER_FIXTURES[file]}`).toBe(live)
  })

  it.each(WRAPPERS.map((w) => [w.id, w.file as string] as const))('%s converts with nothing left', (id, file) => {
    const src = readFileSync(WRAPPER_FIXTURES[file], 'utf8')
    const out = rewritten(file, src)
    expect(out.src, file).not.toBe(src)
    expect(out.converted.length, file).toBeGreaterThan(0)
    expect(out.manual, file).toEqual([])
    expect(out.src, file).not.toMatch(/isAdminClaims/)
    const facts = analyzeNamedExport(file, out.src, id)
    expect(facts && [...satisfies(facts)], file).toContain('admin')
  })

  it.each(WRAPPERS.map((w) => [w.id, w.file as string] as const))('%s: callers drop out of the ratchet once it is converted', (id, file) => {
    const caller = 'app/api/admin/zz/route.ts'
    const module = fileModule(file)
    const callerSrc = `import { ${id} } from '@/${module}'\nexport const GET = () => ${id}()\n`
    const src = readFileSync(WRAPPER_FIXTURES[file], 'utf8')
    const before = measureIdioms(new Map([[caller, callerSrc], [file, src]])) as Record<string, Record<string, number>>
    const after = measureIdioms(new Map([[caller, callerSrc], [file, rewritten(file, src).src]])) as Record<string, Record<string, number>>
    expect(before[caller]).toEqual({ [id]: 1 })
    expect(after[caller]).toBeUndefined()
  })

  it('every file T6 touches stays out of what proxy.ts and lib/authz import', () => {
    const closure = (start: string) => {
      const seen = new Set<string>()
      const walk = (module: string) => {
        if (seen.has(module)) return
        const file = [`${module}.ts`, `${module}.tsx`, `${module}/index.ts`].find((f) => {
          try {
            readFileSync(f)
            return true
          } catch {
            return false
          }
        })
        if (!file) return
        seen.add(module)
        for (const m of readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)) {
          if (m[1].startsWith('@/') || m[1].startsWith('.')) walk(resolveModule(file, m[1]))
        }
      }
      walk(start)
      return seen
    }
    const proxy = closure('proxy')
    const authz = closure('lib/authz')
    expect(proxy.size).toBeGreaterThan(1)
    expect(authz.size).toBeGreaterThan(1)
    for (const w of WRAPPERS) {
      const module = fileModule(w.file as string)
      expect(proxy.has(module), `${module} is imported by proxy.ts, and lib/authz is server-only`).toBe(false)
      expect(authz.has(module), `${module} is imported by lib/authz, so importing it back would be a cycle`).toBe(false)
    }
  })
})

describe('authz codemod: T7, test mocks', () => {
  const TEST = 'app/api/admin/x/route.test.ts'
  const converted = (legacy = "import { isStellrAdmin } from '@/lib/authz'\nexport const GET = () => isStellrAdmin()\n") => (m: string) => (m === 'app/api/admin/x/route' ? legacy : null)
  const withImport = (body: string) => `${body}import { GET } from './route'\n`

  const cases: [string, string, string][] = [
    ['a fixed answer', "vi.mock('@/lib/admin-auth', () => ({ isAdminClaims: () => true }))\n", "vi.mock('@/lib/authz', () => ({ isStellrAdmin: async () => true }))\n"],
    ['an answer the test sets', "vi.mock('@/lib/admin-auth', () => ({ isAdminClaims: () => state.admin }))\n", "vi.mock('@/lib/authz', () => ({ isStellrAdmin: async () => state.admin }))\n"],
    ['an async helper, by reference', "vi.mock('@/lib/admin-auth', () => ({ currentUserIsAdmin }))\n", "vi.mock('@/lib/authz', () => ({ isStellrAdmin: currentUserIsAdmin }))\n"],
    ['the access gate, by reference', "vi.mock('@/lib/event-access', () => ({ requireEventAccess }))\n", "vi.mock('@/lib/authz', () => ({ requireEventAccess }))\n"],
    ['the access gate, inline', "vi.mock('@/lib/event-access', () => ({ requireEventAccess: async () => ({ ok: true }) }))\n", "vi.mock('@/lib/authz', () => ({ requireEventAccess: async () => ({ ok: true }) }))\n"],
    ['a scope', "vi.mock('@/lib/admin-auth', () => ({ currentUserHasScope: async () => false }))\n", "vi.mock('@/lib/authz', () => ({ hasScope: async () => false }))\n"],
    ['the page gate', "vi.mock('@/lib/admin-auth', () => ({ requireAdminPage: async () => {} }))\n", "vi.mock('@/lib/authz', () => ({ authz: { page: { requireAdmin: async () => {} } } }))\n"],
  ]

  it.each(cases)('%s', (_name, input, expected) => {
    const out = transformTest(TEST, withImport(input), converted())
    expect(out.src).toBe(withImport(expected))
    expect(out.manual).toEqual([])
    expect(transformTest(TEST, out.src, converted()).src).toBe(out.src)
  })

  it('finds the subject of a test not named after it', () => {
    const out = transformTest('app/api/admin/x/admin-entry.test.ts', withImport(cases[0][1]), converted())
    expect(out.converted.length).toBe(1)
  })

  it('finds the subject of a test with a qualifier in its name', () => {
    const src = cases[0][1]
    expect(transformTest('app/api/admin/x/route.desk.test.ts', src, converted()).converted.length).toBe(1)
  })

  it.each([
    ['the subject still reads the legacy module', cases[0][1], /convert it first/, converted("import { isAdminClaims } from '@/lib/admin-auth'\nexport const GET = isAdminClaims\n")],
    ['no subject can be found', cases[0][1], /what this test exercises/, () => null],
    ['the mock reads the claims it is handed', "vi.mock('@/lib/admin-auth', () => ({ isAdminClaims: (c: { admin?: boolean } | null) => !!c?.admin }))\n", /reads the claims/, converted()],
    ['the mock is a bare reference, so its arguments are unknown', "vi.mock('@/lib/admin-auth', () => ({ isAdminClaims }))\n", /reads the claims/, converted()],
    ['an export with no one-for-one name', "vi.mock('@/lib/admin-auth', () => ({ isCrewRole: () => true }))\n", /no one-for-one/, converted()],
    ['both legacy modules are mocked, and two mocks of lib/authz would replace each other', "vi.mock('@/lib/admin-auth', () => ({ isAdminClaims: () => true }))\nvi.mock('@/lib/event-access', () => ({ requireEventAccess }))\n", /both legacy/, converted()],
    ['lib/authz is mocked already', "vi.mock('@/lib/admin-auth', () => ({ isAdminClaims: () => true }))\nvi.mock('@/lib/authz', () => ({}))\n", /already mocks/, converted()],
    ['two helpers would land on one name', "vi.mock('@/lib/admin-auth', () => ({ isAdminClaims: () => true, currentUserIsAdmin: async () => false }))\n", /two helpers/, converted()],
    ['a factory using the original', "vi.mock('@/lib/admin-auth', async (o) => ({ ...(await o()) }))\n", /plain/, converted()],
  ])('leaves it and reports when %s', (_name, input, why, read) => {
    const src = withImport(input)
    const out = transformTest(TEST, src, read)
    expect(out.src).toBe(src)
    expect(out.manual.map((m) => m.why).join()).toMatch(why)
  })

  describe('what the test still loads for real', () => {
    const SUBJECT = 'app/api/admin/x/route'
    const OK = "import { isStellrAdmin } from '@/lib/authz'\nimport { helper } from '@/lib/helper'\nexport const GET = () => [isStellrAdmin(), helper()]\n"
    const LEGACY_HELPER = "import { requireEventAccess } from '@/lib/event-access'\nexport const helper = requireEventAccess\n"
    const MOCK = "vi.mock('@/lib/event-access', () => ({ requireEventAccess: vi.fn() }))\n"
    const modules = (extra: Record<string, string>) => (m: string) => ({ [SUBJECT]: OK, ...extra })[m] ?? null

    it('refuses when a module the subject imports still reads the legacy module', () => {
      const src = withImport(MOCK)
      const out = transformTest(TEST, src, modules({ 'lib/helper': LEGACY_HELPER }))
      expect(out.src).toBe(src)
      expect(out.manual.map((m) => m.why).join()).toMatch(/lib\/helper still imports lib\/event-access: convert it first/)
    })

    it('refuses however far down it is', () => {
      const out = transformTest(TEST, withImport(MOCK), modules({ 'lib/helper': "export { helper } from './deep'\n", 'lib/deep': "import { x } from './deeper'\nexport const helper = x\n", 'lib/deeper': LEGACY_HELPER }))
      expect(out.manual.map((m) => m.why).join()).toMatch(/lib\/deeper still imports/)
    })

    it('refuses for a module the test keeps through importOriginal: the resource-finalise shape', () => {
      const src = withImport(`vi.mock('@/lib/helper', async (importOriginal) => ({ ...(await importOriginal()) }))\n${MOCK}`)
      const out = transformTest(TEST, src, modules({ 'lib/helper': LEGACY_HELPER }))
      expect(out.src).toBe(src)
      expect(out.manual.map((m) => m.why).join()).toMatch(/lib\/helper still imports/)
    })

    it('refuses for a module the factory keeps through vi.importActual', () => {
      const src = withImport(`vi.mock('@/lib/helper', async () => ({ ...(await vi.importActual('@/lib/helper')) }))\n${MOCK}`)
      expect(transformTest(TEST, src, modules({ 'lib/helper': LEGACY_HELPER })).manual.map((m) => m.why).join()).toMatch(/lib\/helper still imports/)
    })

    it('refuses for a module the test itself imports, not only its subject', () => {
      const src = `import { helper } from '@/lib/helper'\n${withImport(MOCK)}`
      expect(transformTest(TEST, src, (m) => ({ [SUBJECT]: "import { isStellrAdmin } from '@/lib/authz'\nexport const GET = isStellrAdmin\n", 'lib/helper': LEGACY_HELPER })[m] ?? null).manual.map((m) => m.why).join()).toMatch(/lib\/helper still imports/)
    })

    it('moves when the test replaces that module outright, so its imports never run', () => {
      const src = withImport(`vi.mock('@/lib/helper', () => ({ helper: vi.fn() }))\n${MOCK}`)
      const out = transformTest(TEST, src, modules({ 'lib/helper': LEGACY_HELPER }))
      expect(out.manual).toEqual([])
      expect(out.converted.map((c) => c.transform)).toEqual(['T7'])
    })

    it('moves past a type-only import, which loads nothing', () => {
      for (const line of ["import type { EventAccess } from '@/lib/event-access'\n", "import { type EventAccess } from '@/lib/event-access'\n", "export type { EventAccess } from '@/lib/event-access'\n"]) {
        const out = transformTest(TEST, withImport(MOCK), modules({ 'lib/helper': `${line}export const helper = () => 1\n` }))
        expect(out.manual, line).toEqual([])
        expect(out.converted.length, line).toBe(1)
      }
    })

    it('does not walk into lib/authz, which is the mock once this runs', () => {
      const out = transformTest(TEST, withImport(MOCK), (m) => ({ [SUBJECT]: OK, 'lib/authz': LEGACY_HELPER, 'lib/helper': 'export const helper = 1\n' })[m] ?? null)
      expect(out.manual).toEqual([])
    })

    it('ends on an import cycle', () => {
      const out = transformTest(TEST, withImport(MOCK), modules({ 'lib/helper': "import { a } from './a'\nexport const helper = a\n", 'lib/a': "import { helper } from './helper'\nexport const a = helper\n" }))
      expect(out.manual).toEqual([])
      expect(out.converted.length).toBe(1)
    })
  })

  it('leaves a test that imports the legacy module itself', () => {
    const src = `import { isAdminClaims } from '@/lib/admin-auth'\n${withImport(cases[0][1])}`
    expect(transformTest(TEST, src, converted()).manual.map((m) => m.why).join()).toMatch(/imports the legacy module/)
  })

  it('does not touch a test with no legacy mock', () => {
    const src = "vi.mock('@/lib/other', () => ({ isAdminClaims: () => true }))\n"
    expect(transformTest(TEST, src, converted())).toEqual({ src, converted: [], manual: [] })
  })
})

describe('authz codemod: a run', () => {
  const route = 'app/api/admin/a/route.ts'
  const test = 'app/api/admin/a/route.test.ts'
  const other = 'app/api/admin/b/route.ts'
  const legacy = "import { currentUserIsAdmin } from '@/lib/admin-auth'\nexport async function GET() {\n  return await currentUserIsAdmin()\n}\n"
  const mock = "vi.mock('@/lib/admin-auth', () => ({ currentUserIsAdmin: async () => true }))\n"
  const sources = () => new Map([[route, legacy], [other, legacy]])

  it('touches only what is selected', () => {
    const { results, after } = runCodemod(sources(), new Map([[test, mock]]), (f) => f.startsWith('app/api/admin/a/'))
    expect([...results.keys()].sort()).toEqual([test, route])
    expect(after.get(other)).toBe(legacy)
    expect(after.get(route)).toContain('isStellrAdmin')
  })

  it('moves a test mock only when the same run moved its subject, or an earlier one did', () => {
    const both = runCodemod(sources(), new Map([[test, mock]]), (f) => f.startsWith('app/api/admin/a/'))
    expect(both.results.get(test)?.src).toContain("'@/lib/authz'")
    const testOnly = runCodemod(sources(), new Map([[test, mock]]), (f) => f === test)
    expect(testOnly.results.get(test)?.src).toBe(mock)
    expect(testOnly.results.get(test)?.manual.map((m) => m.why).join()).toMatch(/convert it first/)
  })
})

describe('authz codemod: the command line', () => {
  afterEach(() => vi.restoreAllMocks())

  it('refuses to write the whole tree', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(main(['--all', '--write'])).toBe(1)
    expect(err.mock.calls.join()).toMatch(/one feature area per PR/)
  })

  it('asks what to change', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(main([])).toBe(1)
  })

  it('--write changes the file and names both baselines to regenerate', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'authz-codemod-'))
    try {
      mkdirSync(path.join(root, 'app/api/admin/x'), { recursive: true })
      writeFileSync(path.join(root, ROUTE), "import { currentUserIsAdmin } from '@/lib/admin-auth'\nexport async function GET() {\n  return await currentUserIsAdmin()\n}\n")
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})
      expect(main(['--file', ROUTE, '--write'], root)).toBe(0)
      expect(readFileSync(path.join(root, ROUTE), 'utf8')).toContain('isStellrAdmin')
      const said = log.mock.calls.join('\n')
      expect(said).toContain(AFTER_WRITE)
      expect(AFTER_WRITE).toContain('scripts/authz-idioms.mjs --write')
      expect(AFTER_WRITE).toContain('scripts/s5-inventory.mjs --write')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reads areas as globs, with route brackets literal', () => {
    const r = globToRegExp('app/api/admin/events/[slug]/**')
    expect(r.test('app/api/admin/events/[slug]/export/route.ts')).toBe(true)
    expect(r.test('app/api/admin/events/[slug]/route.ts')).toBe(true)
    expect(r.test('app/api/admin/events/s/route.ts')).toBe(false)
    expect(globToRegExp('lib/*.ts').test('lib/a.ts')).toBe(true)
    expect(globToRegExp('lib/*.ts').test('lib/a/b.ts')).toBe(false)
    expect(globToRegExp('app/**/route.ts').test('app/route.ts')).toBe(true)
    expect(globToRegExp('(admin)/x').test('(admin)/x')).toBe(true)
  })
})

describe('authz codemod: helpers', () => {
  it('names a route by its pattern, never a concrete path', () => {
    expect(routeOf('app/api/admin/events/[slug]/export/route.ts')).toBe('/api/admin/events/[slug]/export')
    expect(routeOf('app/(stellr)/(admin)/admin/members/[id]/page.tsx')).toBe('/admin/members/[id]')
    expect(routeOf('app/(stellr)/(admin)/layout.tsx')).toBeNull()
    expect(routeOf('app/api/admin/esign/templates/guard.ts')).toBeNull()
    expect(routeOf('lib/store/auth.ts')).toBeNull()
  })

  it('knows the admin surface', () => {
    expect(isAdminSurface('app/api/admin/x/route.ts')).toBe(true)
    expect(isAdminSurface('app/(stellr)/(admin)/admin/x/page.tsx')).toBe(true)
    expect(isAdminSurface('lib/scholarship-admin.ts')).toBe(true)
    expect(isAdminSurface('lib/survey/admin-auth.ts')).toBe(true)
    expect(isAdminSurface('lib/store/auth.ts')).toBe(false)
    expect(isAdminSurface('lib/uploads.ts')).toBe(false)
    expect(isAdminSurface('app/api/community/x/route.ts')).toBe(false)
    expect(isAdminSurface('app/(stellr)/(member)/layout.tsx')).toBe(false)
  })
})

describe('authz codemod: the idiom list', () => {
  const ids = (LEGACY_IDIOMS as { id: string }[]).map((i) => i.id).sort()

  it('has a decision for every idiom the ratchet counts, and none it does not', () => {
    expect(Object.keys(DISPOSITIONS).sort()).toEqual(ids)
  })

  it('says why, for every idiom that can be left', () => {
    for (const [id, d] of Object.entries(DISPOSITIONS)) expect(d.why.length, id).toBeGreaterThan(10)
  })

  it('names as manual exactly the idioms lib/authz has no safe one-for-one form for', () => {
    expect(Object.entries(DISPOSITIONS).filter(([, d]) => d.transform === null).map(([id]) => id).sort()).toEqual([
      'CREW_CLERK_ROLES',
      'isCrewRole',
      'isEventManagerClaims',
      'pageRequireAdmin',
      'portalRoleList',
      'roleTableRead',
    ])
  })

})
