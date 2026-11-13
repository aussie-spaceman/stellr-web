// What Staff can reach in /api/admin, read from the code (Staff role phase 3, 13 Nov 2026).
//
// For every admin route handler, the capabilities it checks (hasCapability /
// requireCapability with a literal, and the domain wrappers' arguments). The owner
// decisions this pins:
//   - Staff never passes a guard in the admin-only areas: view-as, Duties, the access
//     console, privacy requests, deletion and merge, clearance decisions, granting
//     Staff, the e-sign templates, the store catalogue, scholarship decisions.
//   - Where Staff can write, it is through the capability of that area, never a
//     broader one: a Members route does not take competitions:write, and so on.
// A change to who can do what shows here as a failing line, on purpose.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { STAFF_CAPABILITIES, type Capability } from '@/lib/authz/capabilities'

const FILES = execFileSync('git', ['ls-files', 'app/api/admin'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f.endsWith('/route.ts'))
const route = (f: string) => f.replace('app/api/admin/', '').replace(/\/route\.ts$/, '')

const CAP_CALL = new Set(['hasCapability', 'requireCapability', 'requireScholarshipAdmin', 'requireSurveyAdmin', 'canManageStoreCatalog', 'guard', 'requireAdmin'])
const WRAPPER_DEFAULT: Record<string, Capability> = {
  requireScholarshipAdmin: 'scholarships:write',
  requireSurveyAdmin: 'competitions:write',
  canManageStoreCatalog: 'store:write',
}

/** Every capability literal a file checks, whatever the handler. */
function capsIn(file: string): Capability[] {
  const src = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const out = new Set<Capability>()
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const name = ts.isIdentifier(n.expression) ? n.expression.text : ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text : ''
      if (CAP_CALL.has(name)) {
        const lit = n.arguments.find((a) => ts.isStringLiteral(a)) as ts.StringLiteral | undefined
        if (lit) out.add(lit.text as Capability)
        else if (WRAPPER_DEFAULT[name]) out.add(WRAPPER_DEFAULT[name])
      }
    }
    // A capability named as a parameter default (guard(params, cap = '...')).
    if (ts.isParameter(n) && n.initializer && ts.isStringLiteral(n.initializer) && /:/.test(n.initializer.text)) out.add(n.initializer.text as Capability)
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return [...out].sort()
}

const STAFF_HELD = new Set<string>(STAFF_CAPABILITIES)
const staffCaps = (file: string) => capsIn(file).filter((c) => STAFF_HELD.has(c))

/** Admin-only areas: no handler here may accept a capability Staff holds. */
const ADMIN_ONLY = [
  /^access(\/|$)/,
  /^duties$/,
  /^impersonation$/,
  /^privacy-requests(\/|$)/,
  /^deletion/,
  /^members\/merge$/,
  /^members\/\[id\]\/background-check\/adjudicate$/,
  /^members\/\[id\]\/staff$/,
  /^esign\/templates(?!\/\[id\]\/preview$)/, // reading a template's preview is portal:read
  /^esign\/(maintenance|membership-backfill)$/,
  /^compliance\/sync$/,
  /^digest\/send$/,
  /^sanity\//,
]

/** The areas Staff writes, and the capabilities each may use (portal:read is always allowed). */
const AREA: [RegExp, Capability[]][] = [
  [/^members\/\[id\]\/volunteer$/, ['volunteers:write']],
  [/^members\/\[id\]\/event-manager$/, ['event_managers:assign']],
  [/^members\/\[id\]\/background-check\/report$/, ['export']],
  [/^members\/export$/, ['export']],
  [/^members(\/|$)/, ['members:write']],
  [/^schools\//, ['schools:write']],
  [/^event-managers$/, ['event_managers:assign']],
  [/^(artwork-defaults|pd-certificate)(\/|$)/, ['competitions:write']],
  [/^events\//, ['competitions:write', 'export']],
  [/^surveys\/export$/, ['export']],
  [/^surveys\//, ['competitions:write']],
]

describe('Staff in /api/admin', () => {
  it('reads the routes it should, at least the core ones', () => {
    for (const r of ['members/search', 'members/[id]/activity', 'community/spaces', 'store/products', 'docusigns', 'event-managers']) {
      expect(capsIn(`app/api/admin/${r}/route.ts`), r).toContain('portal:read')
    }
  })

  it('never passes a guard in an admin-only area', () => {
    const leaks = FILES.filter((f) => ADMIN_ONLY.some((re) => re.test(route(f)))).flatMap((f) => staffCaps(f).map((c) => `${route(f)}: ${c}`))
    expect(leaks).toEqual([])
  })

  it('writes only through the capability of its area', () => {
    const wrong: string[] = []
    for (const f of FILES) {
      const writes = staffCaps(f).filter((c) => c !== 'portal:read')
      if (writes.length === 0) continue
      const allowed = AREA.find(([re]) => re.test(route(f)))?.[1]
      for (const c of writes) if (!allowed?.includes(c)) wrong.push(`${route(f)}: ${c}`)
    }
    expect(wrong).toEqual([])
  })

  it('decides clearance only with clearance:verify, on the routes that verify', () => {
    for (const r of ['members/[id]/license', 'members/[id]/external-check']) {
      expect(capsIn(`app/api/admin/${r}/route.ts`), r).toContain('clearance:verify')
    }
  })
})
