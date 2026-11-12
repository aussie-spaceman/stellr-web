// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { analyzeRoute } from '@/lib/security/route-ast'
import { AUDIT_EXEMPTIONS, auditHandlers, isCronRoute, isRouteFile, OPERATIONAL_WRITERS, whyGetWrites, type Project } from '@/lib/security/audit-coverage'
import { capGrowth, checkSince } from '../scripts/audit-cap.mjs'
import { auditBaseline, auditDiff, collectSources, measure, nextAuditBaseline, readBaseline, summarize } from '../scripts/s5-inventory.mjs'

// The audit gate (docs/TENANCY-S5.md, C7): every mutating route handler audits, or
// is listed in test/baselines/unaudited-mutations.json, or has an owner-approved
// exemption. The list must equal the measurement, so a new unaudited handler fails
// here, and so does a handler that starts auditing until the list shrinks with it:
//   npx tsx scripts/s5-inventory.mjs --write
// scripts/audit-cap.mjs, in CI, compares the list with the merge base, because no
// test in this tree can see a list regenerated with --allow-grow.
//
// To read the position: `npx tsx scripts/s5-inventory.mjs`. Why a GET counts as
// writing: `npx tsx scripts/s5-inventory.mjs --why <route file>`. The line this test
// logs needs --reporter=verbose, because the default reporter hides a passing test's logs.

const AUDITED_POST = `import { audit } from '@/lib/audit/platform'
export async function POST() { await audit({ action: 'x', actor: 'y' }); return new Response() }`
const UNAUDITED_POST = 'export async function POST() { return new Response() }'

describe('audit coverage', () => {
  let live: ReturnType<typeof measure>
  let sources: Map<string, string>
  const baseline = readBaseline(process.cwd(), 'audit')

  beforeAll(() => {
    sources = collectSources(process.cwd())
    live = measure(sources)
  }, 120_000)

  it('reports the live position', () => {
    const s = summarize(live)
    console.info(
      `Audit coverage: ${s.mutatingHandlersAudited} of ${s.mutatingHandlers} mutating handlers, ` +
        `${s.cronHandlersAudited} of ${s.cronHandlers} cron handlers, ` +
        `${s.getMutationHandlersAudited} of ${s.getMutationHandlers} GET handlers that write.`,
    )
    expect(s.mutatingHandlers).toBeGreaterThan(0)
  })

  it('a mutating handler audits or is on the list: nothing new, and nothing the list no longer needs', () => {
    const { added, stale } = auditDiff(baseline, live)
    expect(added, 'these write and do not certainly audit. Use withAudit (lib/audit/route.ts)').toEqual([])
    expect(stale, 'these now audit, or are gone. Shrink the list: npx tsx scripts/s5-inventory.mjs --write').toEqual([])
  })

  it('the committed baseline equals the measurement, totals included', () => {
    expect(baseline).toEqual(auditBaseline(live))
  })

  it('every exemption has a reason and a live handler that does not already audit', () => {
    const byKey = new Map(live.mutations.map((h: { key: string }) => [h.key, h]))
    for (const [key, reason] of Object.entries(AUDIT_EXEMPTIONS)) {
      expect(reason.trim().length, `${key} needs a real reason`).toBeGreaterThan(20)
      expect(byKey.get(key), `${key} is not a live handler, or it audits now`).toMatchObject({ coverage: 'exempt' })
    }
  })

  it('every operational writer has a reason and names a module that exists', () => {
    for (const [key, reason] of Object.entries(OPERATIONAL_WRITERS)) {
      expect(reason.trim().length, `${key} needs a real reason`).toBeGreaterThan(20)
      const [module, name] = key.split('#')
      const file = ['.ts', '/index.ts'].map((ext) => module + ext).find((f) => sources.has(f))
      expect(file, `${key}: no such module`).toBeDefined()
      if (name) expect(new RegExp(`export (async )?(function|const) ${name}\\b`).test(sources.get(file as string) as string), `${key}: no such export`).toBe(true)
    }
  })

  it('an operational writer in a module that does more is named by export, so a new export is not exempt by default', () => {
    expect(OPERATIONAL_WRITERS).not.toHaveProperty(['lib/activity-log'])
    expect(OPERATIONAL_WRITERS).not.toHaveProperty(['lib/survey/audit'])
    expect(OPERATIONAL_WRITERS).not.toHaveProperty(['lib/pending-consent'])
  })

  it('the owner gates name the operational writers: they are an exemption in all but name', () => {
    const plan = readFileSync('docs/TENANCY-S5.md', 'utf8')
    expect(plan.slice(plan.indexOf('## Owner gates'))).toContain('OPERATIONAL_WRITERS')
  })

  it('--write only shrinks the list unless told otherwise', () => {
    const file = 'app/api/zz-synthetic/route.ts'
    const measured = { ...live, mutations: [...live.mutations, ...measure(new Map([[file, UNAUDITED_POST]])).mutations] }
    expect(nextAuditBaseline(baseline, measured).mutations).not.toContain(`${file}#POST`)
    expect(nextAuditBaseline(baseline, measured, { allowGrow: true }).mutations).toContain(`${file}#POST`)
    const fewer = { ...live, mutations: live.mutations.filter((h: { key: string }) => h.key !== baseline.mutations[0]) }
    expect(nextAuditBaseline(baseline, fewer).mutations).not.toContain(baseline.mutations[0])
  })

  it('follows a GET into the helper that writes, and names the way there', () => {
    // Audited since S5 A10b (survey.response.open), so out of the baseline's list, and
    // still measured as a GET that writes.
    const file = 'app/api/survey/[token]/route.ts'
    expect(live.mutations.find((h: { key: string }) => h.key === `${file}#GET`)).toMatchObject({ kind: 'get_mutation', audited: true })
    expect(baseline.getMutations).not.toContain(`${file}#GET`)
    const why = whyGetWrites(file, sources.get(file) as string, sources)
    expect(why?.[0]).toBe('lib/survey/handlers#handleOpen')
  })

  it.each([
    ['isStellrAdmin', "if (!(await isStellrAdmin())) return new Response(null, { status: 403 })"],
    ['hasPortalAccess', "if (!(await hasPortalAccess())) return new Response(null, { status: 403 })"],
    ['hasScope', "if (!(await hasScope('events'))) return new Response(null, { status: 403 })"],
    ['requireEventAccess', "if (!(await requireEventAccess('x')).ok) return new Response(null, { status: 403 })"],
    ['requireStellrAdmin', "if (!(await requireStellrAdmin()).ok) return new Response(null, { status: 403 })"],
  ])('a GET guarded by lib/authz %s is not a GET that writes: a shadow mismatch row is the error log', (name, guard) => {
    const src = `import { ${name} } from '@/lib/authz'\nexport async function GET() {\n  ${guard}\n  return new Response()\n}\n`
    expect(whyGetWrites('app/api/admin/zz-synthetic/route.ts', src, sources)).toBeNull()
  })

  it('the gate is not one the app can import', () => {
    for (const [file, src] of sources) {
      if (/^(app|components|lib)\//.test(file) && !file.startsWith('lib/security/')) {
        expect(/from ['"][^'"]*security\/audit-coverage['"]/.test(src), file).toBe(false)
      }
    }
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
    ]) {
      expect(baseline.getMutations, method).toContain(`${file}#GET`)
    }
    // Writes only through an rpc. B16 audits it, so it has left the baseline, and the
    // measurement still counts it as a GET that writes.
    const rpc = live.mutations.find((m: { key: string }) => m.key === 'app/api/community/resources/attachment/[id]/download/route.ts#GET')
    expect(rpc, 'rpc').toMatchObject({ kind: 'get_mutation', audited: true })
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

    it('accepts auditMutation from lib/audit/route, and not a look-alike', () => {
      const route = "import { auditMutation } from '@/lib/audit/route'\n"
      expect(auditHandlers(file, `${route}export async function POST() { await auditMutation({}) }`)[0].coverage).toBe('mandatory')
      expect(auditHandlers(file, "import { auditMutation } from '@/lib/not-audit'\nexport async function POST() { await auditMutation({}) }")[0].coverage).toBe('none')
      expect(auditHandlers(file, "import { auditMutation } from '@/lib/audit/platform'\nexport async function POST() { await auditMutation({}) }")[0].coverage).toBe('none')
      expect(auditHandlers(file, 'async function auditMutation() {}\nexport async function POST() { await auditMutation({}) }')[0].coverage).toBe('none')
    })

    it('a writer whose options can turn it off is not an audit', () => {
      const route = "import { auditMutation } from '@/lib/audit/route'\n"
      expect(coverage('await audit({}, { enabled: false }); return new Response()').coverage).toBe('conditional')
      expect(coverage('await audit({}, { enabled }); return new Response()').coverage).toBe('conditional')
      expect(coverage("await audit({}, { 'enabled': false }); return new Response()").coverage).toBe('conditional')
      expect(coverage('await audit({}, { ...r.opts }); return new Response()').coverage).toBe('conditional')
      expect(coverage('await audit({}, r.opts); return new Response()').coverage).toBe('conditional')
      expect(auditHandlers(file, `${route}export async function POST() { await auditMutation({}, { enabled: false }) }`)[0].coverage).toBe('conditional')
      expect(coverage('await audit({}, { timeoutMs: 100 }); return new Response()').coverage).toBe('mandatory')
    })

    it('a write kept in a variable has to be awaited or returned later', () => {
      expect(coverage('const p = audit({}); return new Response()').coverage).toBe('conditional')
      expect(coverage('let p; p = audit({}); return new Response()').coverage).toBe('conditional')
      expect(coverage('const { ok } = audit({}); return new Response()').coverage).toBe('conditional')
      expect(coverage('const p = audit({}); r.later(async () => { await p }); return new Response()').coverage).toBe('conditional')
      expect(coverage('const p = audit({}); await r.work(); await p; return new Response()').coverage).toBe('mandatory')
      expect(coverage('const p = audit({}); return p').coverage).toBe('mandatory')
      expect(coverage('const p = audit({}).catch(() => {}); await p; return new Response()').coverage).toBe('mandatory')
      expect(coverage('const a = await audit({}); return new Response(String(a))').coverage).toBe('mandatory')
      const route = "import { auditMutation } from '@/lib/audit/route'\n"
      expect(auditHandlers(file, `${route}export async function POST() { const p = auditMutation({}, { afterResponse: true }); return new Response() }`)[0].coverage).toBe('mandatory')
    })

    it('a write nobody waits for is not certain to run', () => {
      expect(coverage('audit({}); return new Response()').coverage).toBe('conditional')
      expect(coverage('void audit({}); return new Response()').coverage).toBe('conditional')
      expect(coverage('audit({}).catch(() => {}); return new Response()').coverage).toBe('conditional')
      const route = "import { auditMutation } from '@/lib/audit/route'\n"
      const deferred = (args: string) => auditHandlers(file, `${route}export async function POST() { auditMutation(${args}); return new Response() }`)[0].coverage
      expect(deferred('{}, { afterResponse: true }')).toBe('mandatory')
      expect(deferred('{}')).toBe('conditional')
      expect(deferred('{}, { afterResponse: false }')).toBe('conditional')
      const helper = `${imp}async function record() { await audit({}) }\nexport async function POST() { record(); return new Response() }`
      expect(auditHandlers(file, helper)[0].coverage).toBe('conditional')
    })
  })

  describe('withAudit, which covers every path by construction', () => {
    const wrap = "import { withAudit } from '@/lib/audit/route'\n"

    it('is accepted around a handler, however early it returns, and inside another wrapper', () => {
      const early = `${wrap}export const POST = withAudit(spec, async (r) => { await supabaseServer().from('a').update({}); if (r.fast) return new Response(); return new Response() })`
      expect(auditHandlers(file, early)[0]).toMatchObject({ coverage: 'mandatory', audited: true })
      expect(auditHandlers(file, `${wrap}export const POST = withThing(withAudit(spec, impl))`)[0].coverage).toBe('mandatory')
      expect(auditHandlers(file, `${wrap}const h = withAudit(spec, impl)\nexport { h as POST }`)[0].coverage).toBe('mandatory')
      expect(auditHandlers(file, "import { withAudit as w } from '@/lib/audit/route'\nexport const POST = w(spec, impl)")[0].coverage).toBe('mandatory')
      expect(auditHandlers(file, "import * as a from '@/lib/audit/route'\nexport const POST = a.withAudit(spec, impl)")[0].coverage).toBe('mandatory')
    })

    it('is not trusted by name, or when it is not what the export runs', () => {
      expect(auditHandlers(file, "import { withAudit } from '@/lib/not-audit'\nexport const POST = withAudit(spec, impl)")[0].coverage).toBe('none')
      expect(auditHandlers(file, 'const withAudit = (s, h) => h\nexport const POST = withAudit(spec, impl)')[0].coverage).toBe('none')
      expect(auditHandlers(file, `${wrap}const unused = withAudit(spec, impl)\nexport async function POST() { return new Response() }`)[0].coverage).toBe('none')
    })

    it('is not accepted beside another handler, or with options that can turn it off', () => {
      expect(auditHandlers(file, `${wrap}export const POST = choose(plain, withAudit(spec, impl))`)[0].coverage).toBe('none')
      expect(auditHandlers(file, `${wrap}export const POST = withAudit(spec, impl, { enabled: false })`)[0].coverage).toBe('none')
      expect(auditHandlers(file, `${wrap}export const POST = withAudit(spec, impl, opts)`)[0].coverage).toBe('none')
      expect(auditHandlers(file, `${wrap}export const POST = withThing(withAudit(spec, impl, { enabled: flag }))`)[0].coverage).toBe('none')
      expect(auditHandlers(file, `${wrap}export const POST = withAudit(spec, impl, { afterResponse: false })`)[0].coverage).toBe('mandatory')
    })

    it('is not accepted around a spec that may answer with no event', () => {
      const cron = 'app/api/cron/x/route.ts'
      const noEvent: [string, string][] = [
        [file, `${wrap}export const POST = withAudit(() => null, impl)`],
        [file, `${wrap}export const POST = withAudit(() => undefined, impl)`],
        [file, `${wrap}export const POST = withAudit(() => (flag ? { action: 'a' } : null), impl)`],
        [file, `${wrap}export const POST = withAudit(function () { if (flag) return { action: 'a' } }, impl)`],
        [file, `${wrap}export const POST = withAudit(() => { if (flag) return null; return { action: 'a' } }, impl)`],
        [file, `${wrap}const quiet = () => null\nexport const POST = withAudit(quiet, impl)`],
        [file, `${wrap}function quiet() { return null }\nexport const POST = withAudit(quiet, impl)`],
        [file, `${wrap}const quiet = flag ? { action: 'a' } : null\nexport const POST = withAudit(quiet, impl)`],
        [file, `${wrap}export const POST = withAudit(flag ? spec : null, impl)`],
        [file, `${wrap}export const POST = withAudit(null, impl)`],
        [file, `${wrap}export const POST = withThing(withAudit(() => null, impl))`],
        // A helper whose answer the gate cannot read, whatever it is called.
        [cron, `${wrap}const cronRunAudit = () => () => null\nexport const GET = withAudit(cronRunAudit(), impl)`],
        [cron, `${wrap}import { cronRunAudit } from '@/lib/cron-audit'\nexport const GET = withAudit(cronRunAudit('x'), impl)`],
      ]
      for (const [f, src] of noEvent) expect(auditHandlers(f, src)[0], src).toMatchObject({ audited: false, coverage: 'none' })
    })

    it('is accepted around a spec that always answers with an event', () => {
      for (const spec of [
        "{ action: 'a' }",
        "{ action: 'a' } as const",
        "() => ({ action: 'a' })",
        "({ args }) => (args[0] ? { action: 'a' } : { action: 'b' })",
        "function () { const id = 1; if (id) return { action: 'a', id }; return { action: 'b' } }",
      ]) {
        expect(auditHandlers(file, `${wrap}export const POST = withAudit(${spec}, impl)`)[0], spec).toMatchObject({ audited: true, coverage: 'mandatory' })
      }
      const named = [
        `${wrap}const spec = { action: 'a' }\nexport const POST = withAudit(spec, impl)`,
        `${wrap}const spec = () => ({ action: 'a' })\nexport const POST = withAudit(spec, impl)`,
        `${wrap}import { SPEC } from './spec'\nexport const POST = withAudit(SPEC, impl)`,
      ]
      for (const src of named) expect(auditHandlers(file, src)[0], src).toMatchObject({ audited: true, coverage: 'mandatory' })
    })

    it("does not hide a cron's guard: the handler's first statement is the route's", () => {
      const first = (src: string) => [...analyzeRoute('app/api/cron/x/route.ts', src).handlers[0].firstStatementCalls]
      const guard = "import { guardCron } from '@/lib/cron-auth'\n"
      expect(first(`${wrap}${guard}export const GET = withAudit(spec, async (req) => { const denied = guardCron(req); return denied })`)).toContain('guardCron')
      expect(first(`${wrap}${guard}async function run(req) { const denied = guardCron(req); return denied }\nexport const GET = withAudit(spec, run)`)).toContain('guardCron')
      expect(first(`${wrap}${guard}export const GET = withAudit(spec, async (req) => { await work(); return guardCron(req) })`)).not.toContain('guardCron')
      expect(first(`import { withAudit } from '@/lib/not-audit'\n${guard}export const GET = withAudit(spec, async (req) => { return guardCron(req) })`)).not.toContain('guardCron')
    })
  })

  describe('withCronAudit, for a cron route only', () => {
    const wrap = "import { withCronAudit } from '@/lib/cron-audit'\n"
    const cron = 'app/api/cron/x/route.ts'

    it('is accepted around a cron handler, under a job named in the file', () => {
      expect(auditHandlers(cron, `${wrap}export const GET = withCronAudit('x', async (req) => { await supabaseServer().from('a').update({}); return new Response() })`)[0]).toMatchObject({ audited: true, coverage: 'mandatory' })
    })

    it('is not accepted outside a cron route, with a job it cannot read, or by name', () => {
      expect(auditHandlers(file, `${wrap}export const POST = withCronAudit('x', impl)`)[0].coverage).toBe('none')
      expect(auditHandlers(cron, `${wrap}export const GET = withCronAudit(job, impl)`)[0].coverage).toBe('none')
      expect(auditHandlers(cron, `${wrap}export const GET = withCronAudit('x', impl, opts)`)[0].coverage).toBe('none')
      expect(auditHandlers(cron, "import { withCronAudit } from '@/lib/not-audit'\nexport const GET = withCronAudit('x', impl)")[0].coverage).toBe('none')
      expect(auditHandlers(cron, "const withCronAudit = (j, h) => h\nexport const GET = withCronAudit('x', impl)")[0].coverage).toBe('none')
    })

    it("does not hide a cron's guard: the handler's first statement is the route's", () => {
      const first = (src: string) => [...analyzeRoute(cron, src).handlers[0].firstStatementCalls]
      const guard = "import { guardCron } from '@/lib/cron-auth'\n"
      expect(first(`${wrap}${guard}export const GET = withCronAudit('x', async (req) => { const denied = guardCron(req); return denied })`)).toContain('guardCron')
      expect(first(`${wrap}${guard}export const GET = withCronAudit('x', async (req) => { await work(); return guardCron(req) })`)).not.toContain('guardCron')
      expect(first(`import { withCronAudit } from '@/lib/not-audit'\n${guard}export const GET = withCronAudit('x', async (req) => { return guardCron(req) })`)).not.toContain('guardCron')
    })
  })

  it('an exempt handler is reported as exempt, not audited, and stays off the baseline', () => {
    const synth = 'app/api/zz-exempt/route.ts'
    const exemptions = AUDIT_EXEMPTIONS as Record<string, string>
    exemptions[`${synth}#POST`] = 'a synthetic exemption for this test only'
    try {
      expect(auditHandlers(synth, UNAUDITED_POST)[0]).toMatchObject({ coverage: 'exempt', audited: false })
      expect(auditBaseline(measure(new Map([[synth, UNAUDITED_POST]]))).mutations).toEqual([])
      expect(auditHandlers(synth, AUDITED_POST)[0]).toMatchObject({ coverage: 'mandatory', audited: true })
    } finally {
      delete exemptions[`${synth}#POST`]
    }
  })

  describe('a path that can answer success after a write, with no audit', () => {
    const imp = "import { audit } from '@/lib/audit/platform'\nimport { supabaseServer } from '@/lib/supabase'\nconst db = supabaseServer()\n"
    const coverage = (body: string, project?: Project) => auditHandlers(file, `${imp}export async function POST(r) { ${body} }`, project)[0].coverage
    const write = "await db.from('a').update({})"

    it('a write and return before the audit is not audited', () => {
      expect(coverage(`if (r.fast) { ${write}; return new Response() } await audit({}); return new Response()`)).toBe('conditional')
      expect(coverage(`if (r.fast) { ${write}; return NextResponse.json({ ok: true }) } await audit({})`)).toBe('conditional')
      expect(coverage(`${write}; if (r.done) return new Response(); await audit({})`)).toBe('conditional')
      expect(coverage(`${write}; if (r.done) return new Response(null, { status: 204 }); await audit({})`)).toBe('conditional')
    })

    it('a write through a same-file helper, or a closure, counts', () => {
      const helper = `${imp}async function save() { ${write} }\nexport async function POST(r) { await save(); if (r.done) return new Response(); await audit({}) }`
      expect(auditHandlers(file, helper)[0].coverage).toBe('conditional')
      expect(coverage(`const save = async () => { ${write} }; await save(); if (r.done) return new Response(); await audit({})`)).toBe('conditional')
      expect(coverage(`await Promise.all(r.xs.map(async () => { ${write} })); if (r.done) return new Response(); await audit({})`)).toBe('conditional')
      expect(coverage(`const t = db.from('a'); await t.insert({}); if (r.done) return new Response(); await audit({})`)).toBe('conditional')
    })

    it('a write in a loop counts on a later pass, and after the loop', () => {
      expect(coverage(`for (const x of r.xs) { if (x.done) return new Response(); ${write} } await audit({})`)).toBe('conditional')
      expect(coverage(`for (const x of r.xs) { ${write} } if (r.done) return new Response(); await audit({})`)).toBe('conditional')
      expect(coverage(`for (const x of r.xs) { ${write} } await audit({}); return new Response()`)).toBe('mandatory')
    })

    it('a branch that wrote is remembered on the way out, and audit in one branch is not audit in both', () => {
      expect(coverage(`if (r.x) { ${write} } if (r.done) return new Response(); await audit({})`)).toBe('conditional')
      expect(coverage(`switch (r.x) { case 1: { ${write}; return new Response() } default: break } await audit({})`)).toBe('conditional')
      expect(coverage(`${write}; if (r.x) { await audit({}) } if (r.done) return new Response(); await audit({})`)).toBe('conditional')
    })

    it('a call out that changes something counts, as a write does', () => {
      const clerk = `${imp}import { clerkClient } from '@clerk/nextjs/server'\nexport async function POST(r) { const c = await clerkClient(); await c.users.updateUser('x', {}); if (r.done) return new Response(); await audit({}) }`
      expect(auditHandlers(file, clerk)[0].coverage).toBe('conditional')
      const reading = clerk.replace('updateUser', 'getUser')
      expect(auditHandlers(file, reading)[0].coverage).toBe('mandatory')
      expect(coverage("await fetch('https://x.test', { method: 'POST' }); if (r.done) return new Response(); await audit({})")).toBe('conditional')
      expect(coverage("await fetch('https://x.test', { method: 'GET' }); if (r.done) return new Response(); await audit({})")).toBe('mandatory')
      expect(coverage("await fetch('https://x.test'); if (r.done) return new Response(); await audit({})")).toBe('mandatory')
    })

    it('a write through a helper in another module counts, re-exports and objects included', () => {
      const helpers = (lib: string, more: Record<string, string> = {}): Project => new Map([['lib/x.ts', lib], ...Object.entries(more)])
      const handler = (name: string) => `${imp}import { ${name} } from '@/lib/x'\nexport async function POST(r) { await ${name}(); if (r.done) return new Response(); await audit({}) }`
      const run = (src: string, project: Project) => auditHandlers(file, src, project)[0].coverage
      const writes = "export async function save(db) { await db.from('a').insert({}) }"
      expect(run(handler('save'), helpers(writes))).toBe('conditional')
      expect(run(handler('save'), helpers('export async function save(db) { await db.from(`a`).select() }'))).toBe('mandatory')
      expect(run(handler('save'), helpers("export { save } from './y'", { 'lib/y.ts': writes }))).toBe('conditional')
      expect(run(handler('save'), helpers("export * from './y'", { 'lib/y.ts': writes }))).toBe('conditional')
      expect(run(handler('save'), helpers("import { inner } from './y'\nexport async function save() { await inner() }", { 'lib/y.ts': "export async function inner(db) { await db.rpc('bump') }" }))).toBe('conditional')
      expect(run(handler('save'), helpers("function save(db) { return db.from('a').delete() }\nexport { save }"))).toBe('conditional')
      const dynamic = `${imp}export async function POST(r) { const m = await import('@/lib/x'); await m.save(); if (r.done) return new Response(); await audit({}) }`
      expect(run(dynamic, helpers(writes))).toBe('conditional')
      const object = `${imp}import { repo } from '@/lib/x'\nexport async function POST(r) { await repo.save(); if (r.done) return new Response(); await audit({}) }`
      expect(run(object, helpers("export const repo = { async save(db) { await db.from('a').insert({}) } }"))).toBe('conditional')
      const cycle = helpers("import { b } from './y'\nexport async function save() { await b() }", { 'lib/y.ts': "import { save } from './x'\nexport async function b() { await save() }" })
      expect(run(handler('save'), cycle)).toBe('mandatory')
    })

    it('a helper the audit lives in has its paths read too', () => {
      const helper = (body: string) => `${imp}async function record(r) { ${body} }\nexport async function POST(r) { await record(r); return new Response() }`
      expect(auditHandlers(file, helper(`if (r.fast) { ${write}; return } await audit({})`))[0].coverage).toBe('conditional')
      expect(auditHandlers(file, helper('if (!r.on) return; await audit({})'))[0].coverage).toBe('mandatory')
    })

    it('a refusal before any write is fine, in any order and any shape', () => {
      expect(coverage(`if (!r.ok) return new Response(); ${write}; await audit({}); return new Response()`)).toBe('mandatory')
      expect(coverage(`if (!r.ok) return forbidden(); ${write}; await audit({}); return new Response()`)).toBe('mandatory')
    })

    it('a failed write may return an error, not a success, without the audit', () => {
      for (const failure of [
        'return NextResponse.json({ error: 1 }, { status: 500 })',
        'return new Response(null, { status: 409 })',
        'return refuse(503, "try again")',
        'return r.a ? NextResponse.json({}, { status: 500 }) : NextResponse.json({}, { status: 400 })',
        'const res = refuse(503, "x"); res.headers.set("a", "b"); return res',
        'throw new Error("x")',
      ]) {
        expect(coverage(`const { error } = ${write}; if (error) { ${failure} } await audit({}); return new Response()`), failure).toBe('mandatory')
      }
      for (const unreadable of ['return r.fail()', 'return res', 'return NextResponse.json({}, { status: r.code })', 'return r.a ? NextResponse.json({}, { status: 500 }) : new Response()']) {
        expect(coverage(`const { error } = ${write}; if (error) { ${unreadable} } await audit({}); return new Response()`), unreadable).toBe('conditional')
      }
    })

    it('a try block: the last statement threw, an earlier one finished', () => {
      expect(coverage(`try { ${write} } catch { return new Response() } await audit({})`)).toBe('mandatory')
      expect(coverage(`try { ${write}; await r.next() } catch { return new Response() } await audit({})`)).toBe('conditional')
      expect(coverage(`try { ${write}; return new Response() } finally { await audit({}) }`)).toBe('mandatory')
      expect(coverage(`try { ${write}; return new Response() } catch { return new Response(null, { status: 500 }) } finally { await r.close() } await audit({})`)).toBe('conditional')
    })

    it('an audit before the write covers everything after it', () => {
      expect(coverage(`await audit({}); ${write}; if (r.done) return new Response(); return new Response()`)).toBe('mandatory')
    })
  })

  describe('a GET that writes through another module', () => {
    const project = (lib: string): Project => new Map([['lib/x.ts', lib]])
    const get = "import { load } from '@/lib/x'\nexport async function GET() { return load() }"
    const kinds = (lib: string) => auditHandlers(file, get, project(lib)).map((h) => h.kind)

    it('counts, and a read through the same helper does not', () => {
      expect(kinds("export async function load(db) { await db.from('a').update({}) }")).toEqual(['get_mutation'])
      expect(kinds("export async function load(db) { return db.from('a').select() }")).toEqual([])
      expect(kinds("export async function load(db) { return db.rpc('event_slug_row_counts') }")).toEqual([])
      expect(kinds("export async function load(db) { await db.storage.from('b').upload('p', 'x') }")).toEqual(['get_mutation'])
    })

    it('does not count a Map or a Set, even beside a query', () => {
      expect(kinds("export async function load(db, m) { await db.from('a').select(); m.delete(1); new Set([1]).delete(1) }")).toEqual([])
    })

    it('does not count writes the gate calls operational', () => {
      const logging = new Map([['lib/app-errors.ts', "export async function captureRequestError(db) { await db.from('app_errors').insert({}) }"]])
      const src = "import { captureRequestError } from '@/lib/app-errors'\nexport async function GET() { await captureRequestError() }"
      expect(auditHandlers(file, src, logging)).toEqual([])
    })

    it('reads no other file when it has no project, as a one-file check', () => {
      expect(auditHandlers(file, get)).toEqual([])
    })
  })

  describe('scripts/audit-cap.mjs: the list only falls', () => {
    const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'ignore' })
    const FILE = 'test/baselines/unaudited-mutations.json'
    const list = (mutations: string[], measuredBy: number | undefined = 2) => JSON.stringify({ measuredBy, mutations, crons: [], getMutations: [] })

    function repo(before: string, after: string) {
      const root = mkdtempSync(path.join(tmpdir(), 'audit-cap-'))
      git(root, 'init', '-q', '-b', 'base')
      git(root, 'config', 'user.email', 'ci@example.test')
      git(root, 'config', 'user.name', 'ci')
      mkdirSync(path.join(root, 'test/baselines'), { recursive: true })
      writeFileSync(path.join(root, FILE), before)
      git(root, 'add', '.')
      git(root, 'commit', '-qm', 'base')
      git(root, 'checkout', '-qb', 'work')
      writeFileSync(path.join(root, FILE), after)
      return root
    }

    function run(root: string, ref = 'base', grewOk = false) {
      const quiet = [vi.spyOn(console, 'log').mockImplementation(() => {}), vi.spyOn(console, 'error').mockImplementation(() => {})]
      vi.stubEnv('AUDIT_CAP_GROW_OK', grewOk ? 'true' : 'false')
      try {
        return checkSince(root, ref)
      } finally {
        quiet.forEach((s) => s.mockRestore())
        vi.unstubAllEnvs()
        rmSync(root, { recursive: true, force: true })
      }
    }

    it('finds what is new, and nothing else', () => {
      expect(capGrowth(JSON.parse(list(['a', 'b'])), JSON.parse(list(['a', 'c'])))).toEqual(['c'])
    })

    it('passes when the list shrinks or holds, fails on a handler it did not have before', () => {
      expect(run(repo(list(['a', 'b']), list(['a'])))).toBe(0)
      expect(run(repo(list(['a']), list(['a'])))).toBe(0)
      expect(run(repo(list(['a']), list(['a', 'b'])))).toBe(1)
    })

    it('a swap does not pay for itself', () => {
      expect(run(repo(list(['a', 'b']), list(['a', 'c'])))).toBe(1)
    })

    it('the label acknowledges growth', () => {
      expect(run(repo(list(['a']), list(['a', 'b'])), 'base', true)).toBe(0)
    })

    it('raising the rules version does not excuse growth: it needs the label too', () => {
      expect(run(repo(list(['a'], 1), list(['a', 'b'], 2)))).toBe(1)
      expect(run(repo(list(['a'], 1), list(['a', 'b'], 2)), 'base', true)).toBe(0)
      expect(run(repo(list(['a', 'b'], 1), list(['a'], 2)))).toBe(0)
      expect(run(repo(list(['a'], 2), JSON.stringify({ mutations: ['a', 'b'], crons: [], getMutations: [] })))).toBe(1)
    })

    it('only a merge base from before baselines had a version is not compared', () => {
      const unversioned = JSON.stringify({ mutations: ['a'], crons: [], getMutations: [] })
      expect(run(repo(unversioned, list(['a', 'b'], 2)))).toBe(0)
    })

    describe('as a command', () => {
      const script = path.resolve('scripts/audit-cap.mjs')
      const cli = (entry: string) => spawnSync(process.execPath, [entry, '--since', 'no-such-ref'], { cwd: process.cwd(), encoding: 'utf8' })

      it('fails on a bad ref', () => {
        expect(cli(script).status).toBe(1)
      })

      it('does not skip the check when run through a symlink, or from a path with a space', () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'audit cap '))
        try {
          const link = path.join(dir, 'link.mjs')
          symlinkSync(script, link)
          const result = cli(link)
          expect(result.status).toBe(1)
          expect(result.stderr).toContain('cannot find the merge base')
        } finally {
          rmSync(dir, { recursive: true, force: true })
        }
      })
    })

    it('fails closed on a ref it cannot resolve, or a baseline it cannot read', () => {
      expect(run(repo(list(['a']), list(['a'])), 'no-such-ref')).toBe(1)
      expect(run(repo(list(['a']), 'not json'))).toBe(1)
      expect(run(repo('not json', list(['a'])))).toBe(1)
      expect(run(repo(list(['a']), JSON.stringify({ mutations: ['a'] })))).toBe(1)
    })
  })

  it('only reads App Router route files', () => {
    expect(isRouteFile('app/route.ts')).toBe(true)
    expect(isRouteFile('app/api/a/b/route.ts')).toBe(true)
    expect(isRouteFile('app/api/a/route.jsx')).toBe(true)
    expect(isRouteFile('app/api/a/route.mts')).toBe(false)
    expect(isRouteFile('app/(stellr)/(public)/x/page.tsx')).toBe(false)
    expect(isRouteFile('lib/route.ts')).toBe(false)
    expect(auditHandlers('lib/route.ts', UNAUDITED_POST)).toEqual([])
  })

  it('the route extensions are Next defaults, because next.config sets no pageExtensions', () => {
    expect(readFileSync('next.config.mjs', 'utf8')).not.toContain('pageExtensions')
  })
})
