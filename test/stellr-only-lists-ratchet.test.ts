// @vitest-environment node
import { readFileSync, writeFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { ROUTE_MANIFEST } from '@/lib/security/route-manifest'
import { TABLE_REGISTRY } from '@/lib/tenancy/registry'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// S5 tracker s5-programme.29: a Stellr-only admin list must not show another tenant's rows.
//
// A LIST READ SITE is a file that ROUTE_MANIFEST classes stellr_only, under the admin page
// tree or app/api/admin, whose route has no dynamic segment (a list across every event, not
// one record or one event's page), where a direct `.from('<table>')` chain reads (selects,
// and never inserts, updates, upserts or deletes) a tenant_scoped or event_scoped table. For
// a route file only its GET handler counts; for a page, the whole file.
//
// A site is FILTERED when that same chain keeps it to Stellr: wrapped in stellrRows(…)
// (lib/tenancy/stellr-scope.ts), or `.or(STELLR_OR_NULL)`, or `.or()` / `.eq('tenant_id', …)`
// naming STELLR_TENANT_ID.
//
// Shrink-only. Every unfiltered site is listed in test/baselines/stellr-only-lists.json with
// a reason. A new unfiltered site fails here: filter it (stellrRows), or, if it truly must
// read every tenant's rows, list it with a reason a person wrote. A listed site that is now
// filtered or gone fails too, so the baseline tightens instead of leaving room.
//
// To regenerate after shrinking: STELLR_ONLY_LISTS_WRITE=1 npx vitest run test/stellr-only-lists-ratchet.test.ts
// It only ever removes entries, and keeps the reasons of those that stay.
//
// The scan reads direct `.from()` calls only. A table a helper in another module reads is
// not seen (the admin agreements page's needs-paperwork panel, lib/esign/needs-paperwork.ts,
// is one), nor a query built in one statement and filtered in a later one.

const BASELINE_PATH = 'test/baselines/stellr-only-lists.json'
const ADMIN_TREES = ['app/api/admin/', 'app/(stellr)/(admin)/admin/']
const WRITE_OPS = new Set(['insert', 'update', 'upsert', 'delete'])

type Baseline = { $comment?: string; sites: Record<string, { reason: string }> }

/** Is this table one whose rows belong to a tenant (registry class tenant_scoped or event_scoped)? */
function tenantScopedTable(name: string): boolean {
  const key = name.includes('.') ? name : `public.${name}`
  const entry = TABLE_REGISTRY[key]
  return !!entry && (entry.class === 'tenant_scoped' || entry.class === 'event_scoped')
}

/** The candidate files: stellr_only, in an admin tree, a route or a page, with no dynamic segment. */
function listFiles(manifest: Record<string, string> = ROUTE_MANIFEST): string[] {
  return Object.entries(manifest)
    .filter(([f, cls]) => cls === 'stellr_only' && ADMIN_TREES.some((t) => f.startsWith(t)))
    .filter(([f]) => /\/(route\.ts|page\.tsx)$/.test(f) && !f.includes('['))
    .map(([f]) => f)
    .sort()
}

function stringArg(call: ts.CallExpression, i = 0): string | null {
  const a = call.arguments[i]
  return a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) ? a.text : null
}

function methodName(call: ts.CallExpression): string | null {
  const e = call.expression
  if (ts.isPropertyAccessExpression(e)) return e.name.text
  if (ts.isIdentifier(e)) return e.text
  return null
}

/** Does this argument name Stellr's tenant: STELLR_OR_NULL, STELLR_TENANT_ID, or a string holding its id? */
function namesStellr(arg: ts.Expression | undefined): boolean {
  if (!arg) return false
  let found = false
  const visit = (n: ts.Node) => {
    if (ts.isIdentifier(n) && (n.text === 'STELLR_TENANT_ID' || n.text === 'STELLR_OR_NULL')) found = true
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) && n.text.includes(STELLR_TENANT_ID)) found = true
    ts.forEachChild(n, visit)
  }
  visit(arg)
  return found
}

/** The nodes a route's GET handler covers, or the whole file for a page. */
function scanRoots(file: string, sf: ts.SourceFile): ts.Node[] {
  if (!file.endsWith('/route.ts')) return [sf]
  const roots: ts.Node[] = []
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === 'GET') roots.push(stmt)
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) if (ts.isIdentifier(d.name) && d.name.text === 'GET' && d.initializer) roots.push(d.initializer)
    }
  }
  // `export const GET = withAudit(…, handler)`: follow a named handler declared in the same file.
  const names = new Set<string>()
  for (const r of roots) {
    if (ts.isCallExpression(r)) for (const a of r.arguments) if (ts.isIdentifier(a)) names.add(a.text)
  }
  for (const stmt of sf.statements) if (ts.isFunctionDeclaration(stmt) && stmt.name && names.has(stmt.name.text)) roots.push(stmt)
  return roots
}

/** `<file> :: <table>` for every unfiltered list read in this source. */
function unfilteredSites(file: string, src: string): string[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const out = new Set<string>()
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && methodName(node) === 'from' && ts.isPropertyAccessExpression(node.expression)) {
      const table = stringArg(node)
      if (table && tenantScopedTable(table)) {
        // Climb the chain: `.x(…)` calls on this one, and a stellrRows(…) wrapped around it.
        const methods: string[] = []
        let filtered = false
        let cur: ts.Node = node
        for (;;) {
          const parent: ts.Node | undefined = cur.parent
          if (!parent) break
          if (ts.isPropertyAccessExpression(parent) && parent.expression === cur && ts.isCallExpression(parent.parent) && parent.parent.expression === parent) {
            const call = parent.parent
            const m = parent.name.text
            methods.push(m)
            if (m === 'or' && namesStellr(call.arguments[0])) filtered = true
            if (m === 'eq' && stringArg(call) === 'tenant_id' && namesStellr(call.arguments[1])) filtered = true
            cur = call
            continue
          }
          if (ts.isCallExpression(parent) && parent.arguments.includes(cur as ts.Expression) && methodName(parent) === 'stellrRows') {
            filtered = true
            methods.push('stellrRows')
            cur = parent
            continue
          }
          if (ts.isParenthesizedExpression(parent) || ts.isAwaitExpression(parent) || ts.isAsExpression(parent) || ts.isNonNullExpression(parent)) {
            cur = parent
            continue
          }
          break
        }
        const reads = methods.includes('select') && !methods.some((m) => WRITE_OPS.has(m))
        if (reads && !filtered) out.add(`${file} :: ${table.includes('.') ? table : `public.${table}`}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  for (const root of scanRoots(file, sf)) visit(root)
  return [...out].sort()
}

function measure(): string[] {
  return listFiles().flatMap((f) => unfilteredSites(f, readFileSync(f, 'utf8'))).sort()
}

function readBaseline(): Baseline {
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline
}

describe('Stellr-only admin lists read only Stellr rows (shrink-only)', () => {
  const live = measure()
  const baseline = readBaseline()
  const listed = Object.keys(baseline.sites).sort()

  if (process.env.STELLR_ONLY_LISTS_WRITE === '1') {
    const kept = Object.fromEntries(listed.filter((s) => live.includes(s)).map((s) => [s, baseline.sites[s]]))
    writeFileSync(BASELINE_PATH, `${JSON.stringify({ ...baseline, sites: kept }, null, 2)}\n`)
  }

  it('scans a real set of files', () => {
    // A floor against a manifest or tree move that silently empties the scan.
    expect(listFiles().length).toBeGreaterThan(40)
  })

  it('no new unfiltered Stellr-only list read', () => {
    const added = live.filter((s) => !baseline.sites[s])
    expect(added, `Filter these with stellrRows (lib/tenancy/stellr-scope.ts), or list them in ${BASELINE_PATH} with a reason`).toEqual([])
  })

  it('the baseline lists no site that is now filtered or gone', () => {
    const stale = listed.filter((s) => !live.includes(s))
    expect(stale, `Remove these from ${BASELINE_PATH} (STELLR_ONLY_LISTS_WRITE=1 does it)`).toEqual([])
  })

  it('every listed site has a real reason', () => {
    for (const [site, entry] of Object.entries(baseline.sites)) {
      expect(typeof entry?.reason, site).toBe('string')
      expect(entry.reason.length, site).toBeGreaterThan(20)
      expect(entry.reason, site).not.toMatch(/^(TODO|auto:)/i)
    }
  })

  it("the agreements list is filtered, and is not in the baseline (s5-programme.29)", () => {
    const agreements = ['app/api/admin/docusigns/route.ts', 'app/(stellr)/(admin)/admin/docusigns/page.tsx']
    for (const f of agreements) {
      expect(listFiles(), f).toContain(f)
      expect(unfilteredSites(f, readFileSync(f, 'utf8')), f).toEqual([])
      expect(listed.some((s) => s.startsWith(`${f} ::`)), f).toBe(false)
    }
  })
})

describe('the scan', () => {
  const PAGE = 'app/(stellr)/(admin)/admin/zz-synthetic/page.tsx'
  const ROUTE = 'app/api/admin/zz-synthetic/route.ts'

  it('flags an unfiltered read of a tenant-scoped table', () => {
    const src = "export default async function P() { await db.from('agreements').select('id').order('sent_at') }\n"
    expect(unfilteredSites(PAGE, src)).toEqual([`${PAGE} :: public.agreements`])
  })

  it('accepts stellrRows, STELLR_OR_NULL, and an eq or or naming Stellr', () => {
    for (const src of [
      "await stellrRows(db.from('agreements').select('id')).order('sent_at')",
      "await db.from('agreements').select('id').or(STELLR_OR_NULL)",
      "await db.from('agreements').select('id').or(`tenant_id.is.null,tenant_id.eq.${STELLR_TENANT_ID}`)",
      "await db.from('agreements').select('id').eq('tenant_id', STELLR_TENANT_ID)",
      `await db.from('agreements').select('id').eq('tenant_id', '${STELLR_TENANT_ID}')`,
    ]) {
      expect(unfilteredSites(PAGE, `export default async function P() { ${src} }\n`), src).toEqual([])
    }
  })

  it('does not accept a tenant filter that is not Stellr', () => {
    const src = "export default async function P(t: string) { await db.from('agreements').select('id').eq('tenant_id', t) }\n"
    expect(unfilteredSites(PAGE, src)).toEqual([`${PAGE} :: public.agreements`])
  })

  it('ignores writes, Stellr-only and identity tables', () => {
    const src = [
      "export default async function P() {",
      "  await db.from('agreements').update({ status: 'x' }).eq('id', '1').select('id')",
      "  await db.from('members').select('id')",
      "  await db.from('membership_tiers').select('id')",
      "}",
    ].join('\n')
    expect(unfilteredSites(PAGE, src)).toEqual([])
  })

  it("reads a route's GET only, including a handler passed to a wrapper", () => {
    const src = [
      "export async function POST() { await db.from('registrations').select('id') }",
      "export const GET = withAudit(meta, listThem)",
      "async function listThem() { await db.from('agreements').select('id') }",
    ].join('\n')
    expect(unfilteredSites(ROUTE, src)).toEqual([`${ROUTE} :: public.agreements`])
  })

  it('leaves out record routes and pages, and anything not stellr_only', () => {
    const files = listFiles({
      'app/api/admin/a/route.ts': 'stellr_only',
      'app/api/admin/a/[id]/route.ts': 'stellr_only',
      'app/(stellr)/(admin)/admin/b/page.tsx': 'stellr_only',
      'app/(stellr)/(admin)/admin/b/[slug]/page.tsx': 'stellr_only',
      'app/api/admin/c/route.ts': 'tenant_crew',
      'app/api/members/d/route.ts': 'stellr_only',
    })
    expect(files).toEqual(['app/(stellr)/(admin)/admin/b/page.tsx', 'app/api/admin/a/route.ts'])
  })
})
