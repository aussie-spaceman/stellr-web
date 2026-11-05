// @vitest-environment node
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { auditHandlers, isCronRoute, isRouteFile } from '@/lib/security/audit-coverage'
import { auditBaseline, auditDiff, collectSources, measure, readBaseline, summarize } from '../scripts/s5-inventory.mjs'

// S5 data access (C2): how many mutating route handlers reach audit().
//
// REPORT-ONLY for now. A drift between the live routes and
// test/baselines/unaudited-mutations.json is reported, not failed: S5-DA-5 turns
// this into an enforcing ratchet once the audit mechanism exists. What IS
// asserted is that the measurement works, so the switch to enforcing can trust
// it: the classifier's rules, the shape of the baseline, and that a new
// unaudited POST would show up as growth.
//
// BEFORE THIS BECOMES THE "100% AUDITED" GATE, S5-DA-5 MUST:
//   - make the audit mandatory by construction: prefer its wrapper as the only
//     accepted writer (`export const POST = withAudit(…)`). 'mandatory' coverage
//     here only says an audit write sits at the top level of the handler or in a
//     finally; it does not prove the write path passes it;
//   - assert the baseline equals the measurement, which this report does not;
//   - cover writes reached through another module's helper, which no probe here
//     sees (a GET doing that is missing from getMutations).
//
// To read the report: `npx tsx scripts/s5-inventory.mjs`. The line this test logs
// needs --reporter=verbose, because the default reporter hides a passing test's logs.

const AUDITED_POST = `import { audit } from '@/lib/audit/platform'
export async function POST() { await audit({ action: 'x', actor: 'y' }); return new Response() }`
const UNAUDITED_POST = 'export async function POST() { return new Response() }'

describe('audit coverage (report-only)', () => {
  let live: ReturnType<typeof measure>
  const baseline = readBaseline(process.cwd(), 'audit')

  beforeAll(() => {
    live = measure(collectSources(process.cwd()))
  }, 120_000)

  it('reports the live position', () => {
    const s = summarize(live)
    const { added, stale } = auditDiff(baseline, live)
    console.info(
      `Audit coverage: ${s.mutatingHandlersAudited} of ${s.mutatingHandlers} mutating handlers, ` +
        `${s.cronHandlersAudited} of ${s.cronHandlers} cron handlers. ` +
        `Since the baseline: ${added.length} newly unaudited, ${stale.length} audited or gone.`,
    )
    expect(s.mutatingHandlers).toBeGreaterThan(0)
  })

  it('the baseline totals agree with its own lists', () => {
    expect(baseline).not.toBeNull()
    expect(baseline.totals.unauditedMutations).toBe(baseline.mutations.length)
    expect(baseline.totals.unauditedCrons).toBe(baseline.crons.length)
    expect(baseline.totals.unauditedGetMutations).toBe(baseline.getMutations.length)
  })

  it('sees the one route known to audit today: POST always, DELETE only down a branch', () => {
    const file = 'app/api/admin/impersonation/route.ts'
    const by = Object.fromEntries(auditHandlers(file, readFileSync(file, 'utf8')).map((h) => [h.method, h.coverage]))
    expect(by).toEqual({ DELETE: 'conditional', POST: 'mandatory' })
  })

  it('reports the GET handlers known to write', () => {
    for (const [file, method] of [
      ['app/api/registrations/[id]/spreadsheet/route.ts', 'update'],
      ['app/api/members/teams/[id]/route.ts', 'insert'],
      ['app/api/community/resources/attachment/[id]/download/route.ts', 'rpc'],
    ]) {
      expect(baseline.getMutations, method).toContain(`${file}#GET`)
    }
    expect(baseline.getMutations).not.toContain('app/api/admin/events/slug-guard/route.ts#GET')
  })

  it('a synthetic new unaudited POST shows as growth', () => {
    const file = 'app/api/zz-synthetic/route.ts'
    const synth = measure(new Map([[file, UNAUDITED_POST]]))
    const measured = { ...live, mutations: [...live.mutations, ...synth.mutations] }
    const before = auditDiff(auditBaseline(live), live)
    const after = auditDiff(auditBaseline(live), measured)
    expect(before.added).toEqual([])
    expect(after.added).toEqual([`${file}#POST`])
  })

  it('a newly audited handler leaves the unaudited list', () => {
    const file = 'app/api/zz-synthetic/route.ts'
    const unaudited = measure(new Map([[file, UNAUDITED_POST]]))
    const audited = measure(new Map([[file, AUDITED_POST]]))
    expect(auditDiff(auditBaseline(unaudited), audited).stale).toEqual([`${file}#POST`])
  })
})

describe('auditHandlers', () => {
  const file = 'app/api/x/route.ts'

  it('counts POST, PUT, PATCH and DELETE, and ignores a plain GET', () => {
    const src = `export async function GET() {}
export async function POST() {}
export async function PUT() {}
export const PATCH = async () => {}
async function del() {}
export { del as DELETE }`
    expect(auditHandlers(file, src).map((h) => h.method).sort()).toEqual(['DELETE', 'PATCH', 'POST', 'PUT'])
  })

  it('accepts audit() from lib/audit/platform, directly or through a same-file helper', () => {
    expect(auditHandlers(file, AUDITED_POST)[0].audited).toBe(true)
    const helper = `import { audit } from '@/lib/audit/platform'
async function record() { await audit({ action: 'x', actor: 'y' }) }
export async function POST() { await record() }`
    expect(auditHandlers(file, helper)[0].audited).toBe(true)
  })

  it('does not trust the name: a local or foreign audit() is not an audit', () => {
    const local = 'async function audit() {}\nexport async function POST() { await audit() }'
    expect(auditHandlers(file, local)[0].audited).toBe(false)
    const foreign = "import { audit } from '@/lib/not-audit'\nexport async function POST() { await audit() }"
    expect(auditHandlers(file, foreign)[0].audited).toBe(false)
    const other = "import { sanitizeMetadata } from '@/lib/audit/platform'\nexport async function POST() { sanitizeMetadata({}) }"
    expect(auditHandlers(file, other)[0].audited).toBe(false)
  })

  it('audit in one handler does not cover another', () => {
    const src = `import { audit } from '@/lib/audit/platform'
export async function POST() { await audit({ action: 'x', actor: 'y' }) }
export async function DELETE() {}`
    const by = Object.fromEntries(auditHandlers(file, src).map((h) => [h.method, h.audited]))
    expect(by).toEqual({ DELETE: false, POST: true })
  })

  it('counts a cron GET, because crons mutate on GET', () => {
    const cron = 'app/api/cron/thing/route.ts'
    const handlers = auditHandlers(cron, 'export async function GET() {}')
    expect(handlers).toEqual([{ key: `${cron}#GET`, file: cron, method: 'GET', kind: 'cron', audited: false, coverage: 'none' }])
    expect(isCronRoute(cron)).toBe(true)
    expect(isCronRoute(file)).toBe(false)
  })

  it('reports a handler it cannot follow, as unaudited', () => {
    const handlers = auditHandlers(file, "export { POST } from './shared'")
    expect(handlers.map((h) => [h.method, h.audited])).toEqual([['POST', false]])
  })

  it('reports `export *` as an unaudited entry, and a destructured handler', () => {
    expect(auditHandlers(file, "export * from './shared'").map((h) => [h.key, h.kind, h.audited])).toEqual([[`${file}#*`, 'mutation', false]])
    expect(auditHandlers(file, 'export const { POST, DELETE: gone } = h').map((h) => [h.method, h.audited])).toEqual([['POST', false]])
    expect(auditHandlers(file, 'export const { GET } = h').map((h) => [h.method, h.kind])).toEqual([['GET', 'get_mutation']])
  })

  describe('a GET that writes', () => {
    const client = "import { supabaseServer } from '@/lib/supabase'\n"

    it('counts insert, update, upsert and delete on a Supabase client', () => {
      for (const op of ['insert({})', 'update({})', 'upsert({})', 'delete()']) {
        const src = `${client}export async function GET() { await supabaseServer().from('a').${op} }`
        expect(auditHandlers(file, src), op).toEqual([{ key: `${file}#GET`, file, method: 'GET', kind: 'get_mutation', audited: false, coverage: 'none' }])
      }
    })

    it('counts a write in a same-file helper, and one on a client passed in', () => {
      const helper = `${client}async function save(db) { await db.from('a').update({}) }\nexport async function GET() { await save(supabaseServer()) }`
      expect(auditHandlers(file, helper).map((h) => h.kind)).toEqual(['get_mutation'])
    })

    it('counts an rpc unless it is known to be read-only, or its name cannot be read', () => {
      const rpc = (name: string) => `${client}export async function GET() { await supabaseServer().rpc(${name}) }`
      expect(auditHandlers(file, rpc("'increment_resource_download'")).map((h) => h.kind)).toEqual(['get_mutation'])
      expect(auditHandlers(file, rpc('name')).map((h) => h.kind)).toEqual(['get_mutation'])
      expect(auditHandlers(file, rpc("'event_slug_row_counts'"))).toEqual([])
    })

    it('ignores a read, and a delete that is not on a database', () => {
      expect(auditHandlers(file, `${client}export async function GET() { await supabaseServer().from('a').select() }`)).toEqual([])
      expect(auditHandlers(file, 'export async function GET(req) { new URL(req.url).searchParams.delete("x"); new Map().delete(1) }')).toEqual([])
    })

    it('a cron GET stays kind cron', () => {
      const src = `${client}export async function GET() { await supabaseServer().from('a').update({}) }`
      expect(auditHandlers('app/api/cron/thing/route.ts', src).map((h) => h.kind)).toEqual(['cron'])
    })
  })

  describe('mandatory or conditional', () => {
    const imp = "import { audit } from '@/lib/audit/platform'\n"
    const coverage = (body: string) => auditHandlers(file, `${imp}export async function POST(r) { ${body} }`)[0]

    it('a top-level or finally audit is mandatory', () => {
      expect(coverage('await audit({}); return new Response()')).toMatchObject({ coverage: 'mandatory', audited: true })
      expect(coverage('if (!r.ok) return new Response(); const a = await audit({}); return a')).toMatchObject({ coverage: 'mandatory', audited: true })
      expect(coverage('try { await work() } finally { await audit({}) }')).toMatchObject({ coverage: 'mandatory', audited: true })
      expect(coverage('return audit({})')).toMatchObject({ coverage: 'mandatory', audited: true })
    })

    it('a branch, a loop, a try block, a short-circuit or a closure is conditional, not audited', () => {
      for (const body of [
        'if (r.x) { await audit({}) } return new Response()',
        'const a = () => audit({}); if (0) a(); return new Response()',
        'for (const x of r.xs) await audit({})',
        'try { await audit({}) } catch {}',
        'try { await work() } catch { await audit({}) }',
        'r.x && (await audit({}))',
        'r.x ? audit({}) : null',
        'switch (r.x) { case 1: await audit({}) }',
      ]) {
        expect(coverage(body), body).toMatchObject({ coverage: 'conditional', audited: false })
      }
    })

    it('follows same-file helpers, an alias and a namespace, and a wrapped handler', () => {
      const helper = `${imp}async function record() { await audit({}) }\nexport async function POST() { await record() }`
      expect(auditHandlers(file, helper)[0].coverage).toBe('mandatory')
      const branchy = `${imp}async function record(r) { if (r) await audit({}) }\nexport async function POST(r) { await record(r) }`
      expect(auditHandlers(file, branchy)[0].coverage).toBe('conditional')
      expect(auditHandlers(file, "import { audit as a } from '@/lib/audit/platform'\nexport async function POST() { await a({}) }")[0].coverage).toBe('mandatory')
      expect(auditHandlers(file, "import * as p from '@/lib/audit/platform'\nexport async function POST() { await p.audit({}) }")[0].coverage).toBe('mandatory')
      expect(auditHandlers(file, `${imp}export const POST = withThing(async () => { await audit({}) })`)[0].coverage).toBe('mandatory')
    })
  })

  it('only reads App Router route files', () => {
    expect(isRouteFile('app/route.ts')).toBe(true)
    expect(isRouteFile('app/api/a/b/route.ts')).toBe(true)
    expect(isRouteFile('app/api/a/route.jsx')).toBe(true)
    expect(isRouteFile('app/api/a/route.mts')).toBe(false)
    expect(isRouteFile('app/(public)/x/page.tsx')).toBe(false)
    expect(isRouteFile('lib/route.ts')).toBe(false)
    expect(auditHandlers('lib/route.ts', UNAUDITED_POST)).toEqual([])
  })

  it('the route extensions are Next defaults, because next.config sets no pageExtensions', () => {
    expect(readFileSync('next.config.mjs', 'utf8')).not.toContain('pageExtensions')
  })
})
