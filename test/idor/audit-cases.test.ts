// @vitest-environment node
//
// The audit check in the IDOR suite (auditCaseProblem, test/idor/harness.ts), run over
// handlers whose audit writes are known, so the proof that the check can fail does not
// depend on which real routes have adopted audit.
import './mocks'
import { describe, expect, it } from 'vitest'
import { audit } from '@/lib/audit/platform'
import { auditMutation, withAudit } from '@/lib/audit/route'
import { auditHandlers } from '@/lib/security/audit-coverage'
import { ROUTE_MANIFEST } from '@/lib/security/route-manifest'
import { AUDIT_CANARIES } from '../../scripts/idor-canary.mjs'
import { auditCaseProblem, harness, installNetworkGuard, resetHarness, runIdorCase, runCrewTarget, type CaseResult } from './harness'

installNetworkGuard()

const input = { segments: ['id'], query: [], body: [], urlPattern: '/api/fixture/[id]' }
const SPEC = { action: 'webhook.event.process', actor: { webhook: 'stripe' }, tenant: { stellr: true } } as const
const ok = () => new Response('{}')

const run = (handler: unknown, method = 'POST'): Promise<CaseResult> => runIdorCase({ [method]: handler }, input, method)

describe('what a case records', () => {
  it('sees an event written after the response', async () => {
    const r = await run(withAudit(SPEC, async () => ok()))
    expect(r).toMatchObject({ outcome: 'ok', status: 200, audits: ['webhook.event.process'] })
    expect(auditCaseProblem({ method: 'POST', audited: true, result: r })).toBeNull()
  })

  it('sees an event written in the handler, and starts each case empty', async () => {
    resetHarness()
    harness.audits.push('left.over')
    const r = await run(async () => {
      await auditMutation(SPEC)
      return ok()
    })
    expect(r.audits).toEqual(['webhook.event.process'])
  })
})

// What the generated suite runs for each tenant_crew and platform_admin route. No route
// has those classes yet (C15, C16), so this is the proof that the check is in that loop.
describe('runCrewTarget', () => {
  const noId = { segments: [], query: [], body: [], urlPattern: '/api/fixture' }
  const route = (source: string) => ({ file: 'app/api/fixture/route.ts', cls: 'tenant_crew' as const, methods: ['POST'], source })
  const AUDITED = "import { withAudit } from '@/lib/audit/route'\nexport const POST = withAudit(spec, impl)"
  const UNAUDITED = 'export async function POST() { return new Response() }'

  it('fails an audited route whose ok outcome wrote no event', async () => {
    const cases = await runCrewTarget(route(AUDITED), { POST: async () => ok() }, noId)
    expect(cases.length).toBeGreaterThan(0)
    for (const c of cases) expect(c.problem).toMatch(/wrote 0 events/)
  })

  it('passes one that wrote its event, and owes nothing for a route still on the baseline', async () => {
    for (const c of await runCrewTarget(route(AUDITED), { POST: withAudit(SPEC, async () => ok()) }, noId)) expect(c.problem).toBeNull()
    for (const c of await runCrewTarget(route(UNAUDITED), { POST: async () => ok() }, noId)) expect(c.problem).toBeNull()
  })

  it('still reports a scope problem first', async () => {
    const cases = await runCrewTarget(route(AUDITED), { POST: async () => ok() }, { ...noId, segments: ['id'], urlPattern: '/api/fixture/[id]' })
    expect(cases.some((c) => /never reached the id/.test(c.problem ?? ''))).toBe(true)
  })

  it('the harness honours enabled: false, as the real audit does', async () => {
    const r = await run(async () => {
      await audit({ tenantId: null, actor: 'system', action: 'webhook.event.process' }, { enabled: false })
      return ok()
    })
    expect(r.audits).toEqual([])
  })
})

describe("the canary's audit entries", () => {
  it('are handlers the gate calls audited, on a real route, or the canary would prove nothing', () => {
    for (const c of AUDIT_CANARIES) {
      expect(ROUTE_MANIFEST[c.file], c.file).toBeDefined()
      expect(auditHandlers(c.file, c.source).map((h) => h.audited), c.name).toEqual([true])
    }
  })
})

describe('auditCaseProblem', () => {
  it('fails an audited handler whose ok outcome wrote no event, or two', async () => {
    const none = await run(async () => ok())
    expect(auditCaseProblem({ method: 'POST', audited: true, result: none })).toMatch(/wrote 0 events/)
    const two = await run(async () => {
      await auditMutation(SPEC)
      await auditMutation(SPEC)
      return ok()
    })
    expect(auditCaseProblem({ method: 'POST', audited: true, result: two })).toMatch(/wrote 2 events/)
  })

  it('owes nothing for a handler still on the baseline, or for a read', async () => {
    const none = await run(async () => ok())
    expect(auditCaseProblem({ method: 'POST', audited: false, result: none })).toBeNull()
    expect(auditCaseProblem({ method: 'GET', audited: true, result: none })).toBeNull()
  })

  it('fails an action the catalogue does not list, on any handler', async () => {
    const r = await run(async () => {
      await audit({ tenantId: null, actor: 'system', action: 'made.up.name' })
      return ok()
    })
    expect(auditCaseProblem({ method: 'POST', audited: false, result: r })).toMatch(/made\.up\.name/)
  })

  it('a refusal writes no event: withAudit holds that, and a handler that breaks it fails', async () => {
    const wrapped = await run(withAudit(SPEC, async () => new Response(null, { status: 403 })))
    expect(wrapped.audits).toEqual([])
    expect(auditCaseProblem({ method: 'POST', audited: true, result: wrapped })).toBeNull()
    const broken = await run(async () => {
      await auditMutation(SPEC)
      return new Response(null, { status: 403 })
    })
    expect(auditCaseProblem({ method: 'POST', audited: true, result: broken })).toMatch(/refused with 403/)
  })
})
