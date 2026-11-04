// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// POST /api/consent/request: a self-registered minor resends their guardian
// consent form or corrects the address. Once an hour at most; never their own
// address; a correction voids the form already out.

const { state } = vi.hoisted(() => ({
  state: {
    pending: null as Record<string, unknown> | null,
    consented: false,
    open: [] as Array<{ id: string; envelope_id: string; provider: string }>,
    voided: [] as string[],
    reminded: [] as string[],
    sent: 0,
    opened: [] as Array<Record<string, unknown>>,
  },
}))

vi.mock('@/lib/community', () => ({
  getCurrentMember: async () => ({ id: 'm-teen', email: 'kid@example.test' }),
}))
vi.mock('@/lib/impersonation', () => ({ assertNotImpersonating: async () => null }))
vi.mock('@/lib/activity-log', () => ({ logActivity: async () => {} }))
vi.mock('@/lib/esign/operations', () => ({
  voidEnvelopeRow: async (_db: unknown, row: { envelope_id: string }) => { state.voided.push(row.envelope_id) },
  remindEnvelopeRow: async (_db: unknown, row: { envelope_id: string }) => { state.reminded.push(row.envelope_id); return 1 },
}))
vi.mock('@/lib/supabase', () => ({
  supabaseServer: () => ({
    from() {
      const chain: Record<string, unknown> = {
        select: () => chain, eq: () => chain, in: () => chain, update: () => chain,
        then: (f: (v: unknown) => unknown) => Promise.resolve({ data: state.open, error: null }).then(f),
      }
      return chain
    },
  }),
}))
vi.mock('@/lib/pending-consent', async (orig) => ({
  ...(await orig<typeof import('@/lib/pending-consent')>()),
  getPendingConsent: async () => state.pending,
  settlePendingConsent: async () => state.consented,
  openPendingConsent: async (_db: unknown, input: Record<string, unknown>) => { state.opened.push(input) },
  sendConsentRequest: async () => { state.sent += 1; return { outcome: 'issued' } },
  markConsentRequestSent: async () => {},
}))

const { POST } = await import('./route')
const post = (body: unknown = {}) =>
  POST(new Request('http://localhost/api/consent/request', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  state.pending = { member_id: 'm-teen', band: 'teen', guardian_name: 'Pat Lee', guardian_email: 'pat@example.test', last_sent_at: null }
  state.consented = false
  state.open = [{ id: 'a1', envelope_id: 'env-1', provider: 'native' }]
  state.voided = []
  state.reminded = []
  state.sent = 0
  state.opened = []
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

  it("refuses the member's own address or a malformed one", async () => {
    expect((await post({ guardian_email: 'kid@example.test' })).status).toBe(400)
    expect((await post({ guardian_email: 'nope' })).status).toBe(400)
    expect(state.voided).toEqual([])
  })
})
