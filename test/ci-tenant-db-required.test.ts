// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TENANT_DB_CALLERS } from '@/lib/tenancy/db-callers'

// The tenant-db job is a required check (owner decision, 10 Nov 2026, with S5 C18, the
// first live area on tenantDb). A continue-on-error on the job or a step would let a
// failure pass as green, an Action named by tag could change under it, and a converted
// area the scope step does not list would skip the very tests that prove it.

const ci = readFileSync('.github/workflows/ci.yml', 'utf8')

/** The job's block: from its key to the next job's key. */
function jobBlock(name: string): string {
  const start = ci.indexOf(`\n  ${name}:\n`)
  expect(start, `${name} job`).toBeGreaterThan(0)
  const rest = ci.slice(start + 1)
  const next = rest.slice(1).search(/\n {2}[a-z][a-z0-9-]*:\n/)
  return next < 0 ? rest : rest.slice(0, next + 1)
}

const job = jobBlock('tenant-db')

describe('ci.yml tenant-db (required)', () => {
  it('has no continue-on-error, on the job or on any step', () => {
    expect(job).toMatch(/runs-on: ubuntu-latest/)
    expect(job).not.toMatch(/continue-on-error/)
  })

  it('pins every Action to a commit SHA', () => {
    const uses = [...job.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1])
    expect(uses.length).toBeGreaterThan(2)
    for (const u of uses) expect(u, u).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/)
  })

  it('still runs the integration suite', () => {
    expect(job).toMatch(/name: Two tenants through the real driver\n\s+run: npx vitest run -c vitest\.integration\.config\.mts\n/)
  })

  it("its scope step runs the job for every converted area's module", () => {
    const pattern = job.match(/grep -qE '([^']+)'/)?.[1]
    expect(pattern, 'the scope pattern').toBeTruthy()
    const scope = new RegExp(pattern as string)
    const areaModules = TENANT_DB_CALLERS.filter((f) => !/\.test\.tsx?$/.test(f) && !f.startsWith('test/'))
    expect(areaModules).toContain('lib/events/admin-config.ts')
    for (const f of areaModules) expect(scope.test(f), f).toBe(true)
    // A change elsewhere still lets a PR skip it.
    expect(scope.test('app/(stellr)/(public)/page.tsx')).toBe(false)
  })

  // A route passes the area module its tenantId, so a change to a route alone can
  // change what the two-tenant tests prove. Every app/ or lib/ file that imports a
  // converted area's module is in the scope too.
  it("its scope step runs the job for every file that imports a converted area's module", () => {
    const scope = new RegExp(job.match(/grep -qE '([^']+)'/)?.[1] as string)
    const areaModules = TENANT_DB_CALLERS.filter((f) => !/\.test\.tsx?$/.test(f) && !f.startsWith('test/') && !f.startsWith('lib/tenancy/'))
    const specs = areaModules.map((f) => `@/${f.replace(/\.tsx?$/, '')}`)
    const importers: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name)) {
          // A cheap substring check before anything else.
          const src = readFileSync(p, 'utf8')
          if (specs.some((s) => src.includes(`'${s}'`) || src.includes(`"${s}"`))) importers.push(p)
        }
      }
    }
    walk('app')
    walk('lib')
    expect(importers).toContain('app/api/admin/events/[slug]/companies/route.ts')
    expect(importers).toContain('app/api/admin/events/[slug]/offerings/route.ts')
    expect(importers).toContain('app/api/admin/events/[slug]/merch/commit/route.ts')
    for (const f of importers) expect(scope.test(f), f).toBe(true)
    // A sibling route that does not reach the area stays out of scope.
    expect(scope.test('app/api/admin/events/[slug]/export/route.ts')).toBe(false)
  })
})
