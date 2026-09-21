import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHmac } from 'crypto'

// The Checkr adapter reads its env ONCE at module load (the ENV constant), so
// each test that needs different credentials re-imports the module after
// setting process.env. The fixtures below are the mock-candidate matrix from
// docs/CHECKR-TESTING-RUNBOOK.md §4, so a unit test failing here means the
// certification run would fail the same way.

const SAVED = { ...process.env }
const KEY = 'test_checkr_key'

async function load() {
  vi.resetModules()
  const mod = await import('./checkr')
  return mod.checkrProvider
}

beforeEach(() => {
  for (const k of Object.keys(process.env)) if (k.startsWith('CHECKR_')) delete process.env[k]
  process.env.CHECKR_API_KEY = KEY
  process.env.CHECKR_PACKAGE_SLUG = 'stellr_crimid'
})
afterEach(() => {
  process.env = { ...SAVED }
  vi.restoreAllMocks()
})

function envelope(type: string, object: Record<string, unknown>) {
  return JSON.stringify({ type, data: { object } })
}

function report(over: Record<string, unknown>) {
  return { id: 'rep_1', candidate_id: 'cand_1', status: 'complete', result: null, assessment: null, includes_canceled: false, ...over }
}

describe('parseWebhook — report.completed maps the matrix', () => {
  // Candidate → (result, assessment, includes_canceled) → expected status
  const MATRIX: [string, Record<string, unknown>, string][] = [
    ['Bud Richman — Clear', { result: 'clear' }, 'passed'],
    ['Judge Judy — Consider, no Assess', { result: 'consider' }, 'referred'],
    ['Consider but Assess eligible', { result: 'consider', assessment: 'eligible' }, 'passed'],
    ['Consider and Assess review', { result: 'consider', assessment: 'review' }, 'referred'],
    ['Vito Andolini — completed with everything canceled', { result: null, includes_canceled: true }, 'cancelled'],
    ['Vito with the Assess review tag a cancellation triggers', { result: null, assessment: 'review', includes_canceled: true }, 'cancelled'],
    ['Alex Taylor — Clear with canceled MVR', { result: 'clear', includes_canceled: true }, 'passed'],
    ['Alex with Assess review on the canceled screening', { result: 'clear', assessment: 'review', includes_canceled: true }, 'passed'],
    ['Complete with nothing usable', { result: null }, 'referred'],
    ['Assess-only eligible', { result: null, assessment: 'eligible' }, 'passed'],
  ]

  for (const [name, over, expected] of MATRIX) {
    it(name, async () => {
      const p = await load()
      const parsed = p.parseWebhook(envelope('report.completed', report(over)))
      expect(parsed?.status).toBe(expected)
      expect(parsed?.candidateRef).toBe('cand_1')
      expect(parsed?.reportRef).toBe('rep_1')
    })
  }

  it('a report that is not yet complete is in progress regardless of result', async () => {
    const p = await load()
    expect(p.parseWebhook(envelope('report.completed', report({ status: 'pending', result: 'clear' })))?.status).toBe('in_progress')
  })
})

describe('parseWebhook — lifecycle events', () => {
  const CASES: [string, Record<string, unknown>, string | null][] = [
    ['report.canceled', report({}), 'cancelled'],
    ['report.engaged', report({}), 'passed'],
    ['report.pre_adverse_action', report({}), 'referred'],
    ['report.post_adverse_action', report({}), 'referred'],
    ['report.disputed', report({}), 'referred'],
    ['report.suspended', report({ status: 'suspended' }), 'in_progress'],
    ['report.resumed', report({ status: 'pending' }), 'in_progress'],
    ['invitation.completed', { id: 'inv_1', candidate_id: 'cand_1', report_id: 'rep_1' }, 'in_progress'],
    ['invitation.expired', { id: 'inv_1', candidate_id: 'cand_1' }, 'expired'],
    ['invitation.deleted', { id: 'inv_1', candidate_id: 'cand_1' }, 'cancelled'],
    ['invitation.created', { id: 'inv_1', candidate_id: 'cand_1' }, null],
    ['candidate.created', { id: 'cand_1' }, null],
    ['report.created', { id: 'rep_1', candidate_id: 'cand_1', status: 'pending' }, 'in_progress'],
  ]
  for (const [type, object, expected] of CASES) {
    it(`${type} → ${expected ?? 'ignored'}`, async () => {
      const p = await load()
      const parsed = p.parseWebhook(envelope(type, object))
      if (expected === null) expect(parsed).toBeNull()
      else expect(parsed?.status).toBe(expected)
    })
  }

  it('invitation.completed captures the report id for later reconciliation', async () => {
    const p = await load()
    const parsed = p.parseWebhook(envelope('invitation.completed', { id: 'inv_1', candidate_id: 'cand_1', report_id: 'rep_9' }))
    expect(parsed?.reportRef).toBe('rep_9')
    expect(parsed?.invitationRef).toBe('inv_1')
  })

  it('malformed JSON is ignored, not thrown', async () => {
    const p = await load()
    expect(p.parseWebhook('{not json')).toBeNull()
  })
})

describe('verifyWebhook', () => {
  const body = envelope('report.completed', report({ result: 'clear' }))
  const sign = (secret: string) => createHmac('sha256', secret).update(body).digest('hex')

  it('accepts a body signed with the API key (Checkr signs with the key)', async () => {
    const p = await load()
    expect(p.verifyWebhook(body, new Headers({ 'x-checkr-signature': sign(KEY) }))).toBe(true)
  })

  it('prefers CHECKR_WEBHOOK_SECRET when set', async () => {
    process.env.CHECKR_WEBHOOK_SECRET = 'separate'
    const p = await load()
    expect(p.verifyWebhook(body, new Headers({ 'x-checkr-signature': sign('separate') }))).toBe(true)
    expect(p.verifyWebhook(body, new Headers({ 'x-checkr-signature': sign(KEY) }))).toBe(false)
  })

  it('rejects a wrong or missing signature', async () => {
    const p = await load()
    expect(p.verifyWebhook(body, new Headers({ 'x-checkr-signature': sign('wrong') }))).toBe(false)
    expect(p.verifyWebhook(body, new Headers())).toBe(false)
  })

  it('fails CLOSED when no secret and no key are set', async () => {
    // This gates pass/fail for adults working with minors; an unconfigured
    // deployment must never accept an unauthenticated POST.
    delete process.env.CHECKR_API_KEY
    delete process.env.CHECKR_WEBHOOK_SECRET
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const p = await load()
    expect(p.verifyWebhook(body, new Headers({ 'x-checkr-signature': sign('') }))).toBe(false)
  })
})

describe('fetchStatus — polling a missed webhook', () => {
  function mockGet(routes: Record<string, unknown>) {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(url)
        const path = url.replace('https://api.checkr-staging.com/v1', '')
        const hit = routes[path]
        if (hit === undefined) return new Response('not found', { status: 404 })
        expect(init?.headers).toMatchObject({ Authorization: expect.stringMatching(/^Basic /) })
        return new Response(JSON.stringify(hit), { status: 200 })
      }),
    )
    return calls
  }

  it('goes straight to the report when we hold a report ref', async () => {
    const calls = mockGet({ '/reports/rep_1': report({ result: 'clear' }) })
    const p = await load()
    const out = await p.fetchStatus({ candidateRef: 'cand_1', invitationRef: 'inv_1', reportRef: 'rep_1' })
    expect(out?.status).toBe('passed')
    expect(calls).toEqual(['https://api.checkr-staging.com/v1/reports/rep_1'])
  })

  it('follows a completed invitation to its report', async () => {
    mockGet({
      '/invitations/inv_1': { id: 'inv_1', candidate_id: 'cand_1', status: 'completed', report_id: 'rep_2' },
      '/reports/rep_2': report({ id: 'rep_2', result: 'consider' }),
    })
    const p = await load()
    const out = await p.fetchStatus({ candidateRef: 'cand_1', invitationRef: 'inv_1', reportRef: null })
    expect(out).toMatchObject({ status: 'referred', reportRef: 'rep_2', candidateRef: 'cand_1', invitationRef: 'inv_1' })
  })

  it('reports an expired or deleted invitation', async () => {
    mockGet({
      '/invitations/inv_e': { id: 'inv_e', candidate_id: 'cand_1', status: 'expired' },
      '/invitations/inv_d': { id: 'inv_d', candidate_id: 'cand_1', status: 'deleted' },
    })
    const p = await load()
    expect((await p.fetchStatus({ candidateRef: 'cand_1', invitationRef: 'inv_e', reportRef: null }))?.status).toBe('expired')
    expect((await p.fetchStatus({ candidateRef: 'cand_1', invitationRef: 'inv_d', reportRef: null }))?.status).toBe('cancelled')
  })

  it('returns null while the invitation is still pending (nothing to apply)', async () => {
    mockGet({ '/invitations/inv_1': { id: 'inv_1', candidate_id: 'cand_1', status: 'pending' } })
    const p = await load()
    expect(await p.fetchStatus({ candidateRef: 'cand_1', invitationRef: 'inv_1', reportRef: null })).toBeNull()
  })

  it('honours adjudication and dispute on a polled report', async () => {
    mockGet({
      '/reports/eng': report({ id: 'eng', result: 'consider', adjudication: 'engaged' }),
      '/reports/adv': report({ id: 'adv', result: 'consider', adjudication: 'pre_adverse_action' }),
      '/reports/dis': report({ id: 'dis', status: 'dispute', result: 'consider' }),
      '/reports/can': report({ id: 'can', status: 'canceled', result: null }),
      '/reports/sus': report({ id: 'sus', status: 'suspended' }),
    })
    const p = await load()
    const at = async (id: string) => (await p.fetchStatus({ candidateRef: null, invitationRef: null, reportRef: id }))?.status
    expect(await at('eng')).toBe('passed')
    expect(await at('adv')).toBe('referred')
    expect(await at('dis')).toBe('referred')
    expect(await at('can')).toBe('cancelled')
    expect(await at('sus')).toBe('in_progress')
  })

  it('surfaces a vendor error rather than guessing', async () => {
    mockGet({})
    const p = await load()
    await expect(p.fetchStatus({ candidateRef: null, invitationRef: null, reportRef: 'missing' })).rejects.toThrow(/404/)
  })
})
