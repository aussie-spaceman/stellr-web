// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { TENANT_ID_HEADER, TENANT_SLUG_HEADER } from '@/lib/tenancy/host'

// POST /api/consent/request: a self-registered minor resends their guardian
// consent form or corrects the address. Once an hour at most; never their own
// address; a correction voids the form already out.

const { state } = vi.hoisted(() => ({
  state: {
    pending: null as Record<string, unknown> | null,
    consented: false,
    /** Whether settling cleared the row in this call. */
    cleared: true,
    open: [] as Array<{ id: string; envelope_id: string; provider: string; event_slug: string }>,
    voided: [] as string[],
    reminded: [] as string[],
    sent: 0,
    opened: [] as Array<Record<string, unknown>>,
    /** Calls to markConsentRequestSent, and the order of sends and stamps. */
    stamped: 0,
    sequence: [] as string[],
    outcome: 'issued',
    voidFails: false,
    sendThrows: false,
    /** after() callbacks, run by the test once the response is in hand. */
    afters: [] as Array<() => Promise<unknown>>,
    /** platform_audit_append calls. */
    audits: [] as Array<Record<string, unknown>>,
    auditFails: false,
    tenantHeaders: null as Record<string, string> | null,
  },
}))

vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (task: () => Promise<unknown>) => { state.afters.push(task) },
}))
vi.mock('next/headers', () => ({
  headers: async () => {
    if (!state.tenantHeaders) throw new Error('no request')
    return new Headers(state.tenantHeaders)
  },
}))
vi.mock('@/lib/app-errors', () => ({ captureRequestError: async () => {} }))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/activity-log', () => ({ logActivity: async () => {} }))
vi.mock('@/lib/esign/operations', () => ({
  voidEnvelopeRow: async (_db: unknown, row: { envelope_id: string }) => {
    if (state.voidFails) throw new Error('void failed')
    state.voided.push(row.envelope_id)
  },
  remindEnvelopeRow: async (_db: unknown, row: { envelope_id: string }) => { state.reminded.push(row.envelope_id); return 1 },
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    rpc: async (_name: string, args: Record<string, unknown>) => {
      if (state.auditFails) throw new Error('audit write failed')
      state.audits.push(args)
      return { data: { id: state.audits.length, chain_seq: state.audits.length }, error: null }
    },
    from() {
      const eq: Record<string, unknown> = {}
      const chain: Record<string, unknown> = {
        select: () => chain, in: () => chain, update: () => chain,
        eq: (c: string, v: unknown) => { eq[c] = v; return chain },
        then: (f: (v: unknown) => unknown) => Promise.resolve({
          data: state.open.filter((r) => eq.event_slug === undefined || r.event_slug === eq.event_slug),
          error: null,
        }).then(f),
      }
      return chain
    },
  }),
}))
vi.mock('@/lib/pending-consent', async (orig) => ({
  ...(await orig<typeof import('@/lib/pending-consent')>()),
  signedInMemberForConsent: async () => ({
    id: '11111111-1111-4111-8111-111111111111', email: 'kid@example.test', clerkUserId: 'user_2kid',
  }),
  getPendingConsent: async () => state.pending,
  settlePendingConsentOutcome: async () => ({ onFile: state.consented, cleared: state.consented && state.cleared }),
  openPendingConsent: async (_db: unknown, input: Record<string, unknown>) => { state.opened.push(input) },
  sendConsentRequest: async () => {
    if (state.sendThrows) throw new Error('send failed')
    state.sent += 1
    state.sequence.push('send')
    return { outcome: state.outcome }
  },
  markConsentRequestSent: async () => { state.stamped += 1; state.sequence.push('stamp') },
}))

const { POST } = await import('./route')
const post = (body: unknown = {}) =>
  POST(new Request('http://localhost/api/consent/request', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  state.pending = { member_id: 'm-teen', band: 'teen', guardian_name: 'Pat Lee', guardian_email: 'pat@example.test', last_sent_at: null }
  state.consented = false
  state.cleared = true
  state.open = [{ id: 'a1', envelope_id: 'env-1', provider: 'native', event_slug: 'membership' }]
  state.voided = []
  state.reminded = []
  state.sent = 0
  state.opened = []
  state.stamped = 0
  state.sequence = []
  state.outcome = 'issued'
  state.voidFails = false
  state.sendThrows = false
  state.afters = []
  state.audits = []
  state.auditFails = false
  state.tenantHeaders = null
  vi.unstubAllEnvs()
  vi.stubEnv('PLATFORM_AUDIT_ENABLED', '')
  vi.stubEnv('TENANT_ROUTING_ENABLED', '')
})

describe('POST /api/consent/request', () => {
  it('404 when nothing is pending', async () => {
    state.pending = null
    expect((await post()).status).toBe(404)
  })

  it('reports consent that has landed instead of sending again', async () => {
    state.consented = true
    expect(await (await post()).json()).toEqual({ state: 'consented' })
    expect(state.reminded).toEqual([])
  })

  it('reminds the guardian of the form already out', async () => {
    const res = await post()
    expect(await res.json()).toMatchObject({ state: 'sent', outcome: 'reminded' })
    expect(state.reminded).toEqual(['env-1'])
  })

  it('sends once an hour at most', async () => {
    state.pending!.last_sent_at = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    expect((await post()).status).toBe(429)
    expect(state.reminded).toEqual([])
  })

  it('a corrected address voids the open form and sends a new one', async () => {
    const res = await post({ guardian_email: 'New@Example.test' })
    expect(res.status).toBe(200)
    expect(state.voided).toEqual(['env-1'])
    expect(state.opened).toEqual([expect.objectContaining({ guardianEmail: 'new@example.test', band: 'teen' })])
    expect(state.sent).toBe(1)
  })

  // Review finding: the open-forms query had no event_slug filter, so a
  // correction voided the member's EVENT permission form too, and a resend
  // could remind the event form instead of the consent form.
  it('never voids or reminds an event permission form, only the membership consent form', async () => {
    state.open = [
      { id: 'ev', envelope_id: 'env-event', provider: 'native', event_slug: 'colorado-sdc-2026' },
      { id: 'a1', envelope_id: 'env-1', provider: 'native', event_slug: 'membership' },
    ]
    await post()
    expect(state.reminded).toEqual(['env-1'])
    state.reminded = []
    await post({ guardian_email: 'new@example.test' })
    expect(state.voided).toEqual(['env-1'])
  })

  it('409 while no parent or guardian has been named yet (opened at the age screen)', async () => {
    state.pending!.guardian_email = null
    const res = await post({ guardian_email: 'new@example.test' })
    expect(res.status).toBe(409)
    expect(state.voided).toEqual([])
    expect(state.sent).toBe(0)
  })

  it("refuses the member's own address or a malformed one", async () => {
    expect((await post({ guardian_email: 'kid@example.test' })).status).toBe(400)
    expect((await post({ guardian_email: 'nope' })).status).toBe(400)
    expect(state.voided).toEqual([])
  })
})

// Review (3 Nov 2026, verify pass): only an 'issued' envelope stamped
// last_sent_at, so any other answer left the hourly limit open.
describe('POST /api/consent/request — every send attempt starts the hourly clock', () => {
  it.each(['in_flight', 'failed', 'not_required'])("a fresh send answered '%s' is stamped, before the send", async (outcome) => {
    state.open = []
    state.outcome = outcome
    await post()
    expect(state.stamped).toBe(1)
    expect(state.sequence).toEqual(['stamp', 'send'])
  })

  it('a reminder is stamped', async () => {
    await post()
    expect(state.reminded).toEqual(['env-1'])
    expect(state.stamped).toBe(1)
  })

  it('a corrected address is stamped before the new form goes', async () => {
    await post({ guardian_email: 'parent2@example.test' })
    expect(state.sequence).toEqual(['stamp', 'send'])
  })

  it('a refusal (too soon, own address) is not an attempt and stamps nothing', async () => {
    await post({ guardian_email: 'kid@example.test' })
    state.pending = { ...state.pending, last_sent_at: new Date().toISOString() }
    await post()
    expect(state.stamped).toBe(0)
  })
})

describe('POST /api/consent/request — platform audit', () => {
  const MEMBER = '11111111-1111-4111-8111-111111111111'
  const STELLR = STELLR_TENANT_ID
  const flush = async () => {
    for (const task of state.afters.splice(0)) await task()
  }

  describe('with PLATFORM_AUDIT_ENABLED off, the default', () => {
    it('schedules nothing and writes nothing, on every path', async () => {
      await post()
      await post({ guardian_email: 'new@example.test' })
      state.consented = true
      await post()
      expect(state.afters).toEqual([])
      expect(state.audits).toEqual([])
    })

    it('gives the same answers', async () => {
      expect(await (await post()).json()).toEqual({ state: 'sent', outcome: 'reminded' })
      state.open = []
      expect(await (await post()).json()).toEqual({ state: 'sent', outcome: 'issued' })
    })
  })

  describe('with it on', () => {
    beforeEach(() => vi.stubEnv('PLATFORM_AUDIT_ENABLED', 'true'))

    it('writes nothing until the response has been given', async () => {
      const res = await post()
      expect(res.status).toBe(200)
      expect(state.audits).toEqual([])
      expect(state.afters).toHaveLength(1)
    })

    it('records a reminder against the member, as the signed-in user, on the Stellr chain', async () => {
      await post()
      await flush()
      expect(state.audits).toEqual([expect.objectContaining({
        p_action: 'consent.request.send',
        p_actor: 'user_2kid',
        p_actor_kind: 'user',
        p_tenant: STELLR,
        p_target_table: 'members',
        p_target_id: MEMBER,
        p_metadata: { status: 200, outcome: 'reminded', corrected: false },
      })])
    })

    it('records the outcome of a fresh send', async () => {
      state.open = []
      state.outcome = 'in_flight'
      await post()
      await flush()
      expect(state.audits[0].p_metadata).toEqual({ status: 200, outcome: 'in_flight', corrected: false })
    })

    it('keeps a corrected address, a name and the age band out of the row', async () => {
      await post({ guardian_email: 'new@example.test', guardian_name: 'Robin Lee' })
      await flush()
      expect(state.audits).toHaveLength(1)
      expect(state.audits[0].p_metadata).toEqual({ status: 200, outcome: 'issued', corrected: true })
      const row = JSON.stringify(state.audits[0])
      for (const held of ['new@example.test', 'pat@example.test', 'kid@example.test', 'Robin', 'Pat Lee', 'teen"']) {
        expect(row).not.toContain(held)
      }
    })

    it('records a request that was already settled as a settle, not a send', async () => {
      state.consented = true
      expect(await (await post()).json()).toEqual({ state: 'consented' })
      await flush()
      expect(state.audits.map((a) => a.p_action)).toEqual(['consent.request.settle'])
    })

    it('a settle says whether this request is the one that cleared the row, and the answer stands', async () => {
      state.consented = true
      await post()
      await flush()
      expect(state.audits[0].p_metadata).toEqual({ status: 200, cleared: true })
      state.audits = []
      state.cleared = false
      expect(await (await post()).json()).toEqual({ state: 'consented' })
      await flush()
      expect(state.audits[0].p_metadata).toEqual({ status: 200, cleared: false })
    })

    it('retyping the current address is a reminder, not a correction', async () => {
      const res = await post({ guardian_email: 'Pat@Example.test' })
      expect(await res.json()).toEqual({ state: 'sent', outcome: 'reminded' })
      expect(state.voided).toEqual([])
      expect(state.opened).toEqual([])
      expect(state.reminded).toEqual(['env-1'])
      await flush()
      expect(state.audits[0].p_metadata).toEqual({ status: 200, outcome: 'reminded', corrected: false })
    })

    it('records no event for a refusal', async () => {
      expect((await post({ guardian_email: 'nope' })).status).toBe(400)
      expect((await post({ guardian_email: 'kid@example.test' })).status).toBe(400)
      state.pending!.guardian_email = null
      expect((await post()).status).toBe(409)
      state.pending!.guardian_email = 'pat@example.test'
      state.pending!.last_sent_at = new Date().toISOString()
      expect((await post()).status).toBe(429)
      state.pending = null
      expect((await post()).status).toBe(404)
      expect(state.afters).toEqual([])
    })

    it('records a 500 from a void that failed part way, because the clock has been stamped', async () => {
      state.voidFails = true
      const res = await post({ guardian_email: 'new@example.test' })
      expect(res.status).toBe(500)
      await flush()
      expect(state.audits.map((a) => a.p_metadata)).toEqual([{ status: 500, corrected: true }])
    })

    it('records a send that threw, and the error still reaches the caller', async () => {
      state.open = []
      state.sendThrows = true
      await expect(post()).rejects.toThrow('send failed')
      await flush()
      expect(state.audits.map((a) => a.p_metadata)).toEqual([{ status: 500, corrected: false }])
    })

    it('a failed audit write changes nothing for the member', async () => {
      const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
      state.auditFails = true
      const res = await post()
      expect(await res.json()).toEqual({ state: 'sent', outcome: 'reminded' })
      await expect(flush()).resolves.toBeUndefined()
      expect(state.audits).toEqual([])
      quiet.mockRestore()
    })

    it('puts the event on the chain of the tenant the proxy named', async () => {
      const tenant = '22222222-2222-4222-8222-222222222222'
      vi.stubEnv('TENANT_ROUTING_ENABLED', 'true')
      state.tenantHeaders = { [TENANT_ID_HEADER]: tenant, [TENANT_SLUG_HEADER]: 'acme' }
      await post()
      await flush()
      expect(state.audits[0].p_tenant).toBe(tenant)
    })

    it('never guesses a tenant it cannot read: the platform chain, marked, and the answer stands', async () => {
      vi.stubEnv('TENANT_ROUTING_ENABLED', 'true')
      expect((await post()).status).toBe(200)
      await flush()
      expect(state.audits[0]).toMatchObject({ p_tenant: null, p_metadata: { tenant_unresolved: true } })
    })
  })
})
