// @vitest-environment node
import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

// deep review TEST-1: the DocuSign Connect HMAC gate (lib/docusign.ts
// verifyConnectHmac) decides whether an envelope — e.g. a minor's consent form —
// flips to "completed". It once shipped fail-OPEN (any anonymous POST could drive
// status). Pin the fail-closed behaviour at the route so a regression to that
// shape is caught: reject unsigned / wrong-key / unset-secret, accept a correctly
// signed body, and never touch the database on a rejected request.
//
// ENV.connectHmacKey is read once at lib/docusign module load, so each case
// re-imports the route through a fresh module registry (the lib/cron.test.ts
// pattern) rather than mutating an already-evaluated constant.

const hdrs = new Map<string, string>()

// deep review DS-7: the webhook's own wiring — consult mayTransition and SKIP a
// stale/backwards event (no DB write, no side effects), 200 on an unknown
// envelope, and forward every completed event (including a replay) to the
// idempotent onEnvelopeCompleted — was untested; only the HMAC gate (TEST-1)
// was. `state.current` is the envelope the lookup finds; `state.updates` records
// every write so a skipped event can assert "nothing was written".
const { onEnvelopeCompleted, state } = vi.hoisted(() => ({
  onEnvelopeCompleted: vi.fn(async (_db?: unknown, _envelope?: unknown) => ({ notified: true })),
  state: {
    current: null as Record<string, unknown> | null,
    updated: null as Record<string, unknown> | null,
    updates: [] as Record<string, unknown>[],
  },
}))

const from = vi.fn((_table: string) => {
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.eq = () => chain
  // The envelope lookup: select(...).eq(...).eq(...).maybeSingle().
  chain.maybeSingle = async () => ({ data: state.current, error: null })
  chain.update = (payload: Record<string, unknown>) => {
    state.updates.push(payload)
    const u: Record<string, unknown> = {}
    u.eq = () => u
    u.select = () => u
    // Status update ends at .select(...).maybeSingle(); the signers_completed
    // update ends at .eq(...) and is awaited directly.
    u.maybeSingle = async () => ({ data: state.updated, error: null })
    u.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null })
    return u
  }
  return chain
})

vi.mock('next/headers', () => ({ headers: async () => ({ get: (k: string) => hdrs.get(k) ?? null }) }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ from }) }))
// The recipient sync makes live DocuSign calls; stub it out (it has its own tests).
vi.mock('@/lib/docusign-recipients', () => ({
  syncEnvelopeRecipients: vi.fn(async () => []),
  loadRecipientsByEnvelopeRows: vi.fn(async () => new Map()),
  alertOnNewBounces: vi.fn(async () => {}),
}))
// Keep the REAL mayTransition / COMPLETED_ENVELOPE_COLUMNS (the gate under test);
// only onEnvelopeCompleted's side effects are stubbed (idempotency is covered in
// lib/esign/completion.test.ts).
vi.mock('@/lib/esign/completion', async (orig) => ({
  ...(await orig<typeof import('@/lib/esign/completion')>()),
  onEnvelopeCompleted,
}))

async function load(key: string) {
  vi.resetModules()
  vi.stubEnv('DOCUSIGN_CONNECT_HMAC_KEY', key)
  return import('./route')
}

const body = JSON.stringify({ event: 'envelope-completed', data: { envelopeId: 'env-1' } })
const post = (POST: (r: Request) => Promise<Response>) =>
  POST(new Request('https://app.test/api/webhooks/docusign', { method: 'POST', body }))

// A correctly-signed request carrying an arbitrary event body.
async function signedEvent(event: string, envelopeId = 'env-1') {
  const key = 'k'.repeat(32)
  const { POST } = await load(key)
  const b = JSON.stringify({ event, data: { envelopeId } })
  hdrs.set('x-docusign-signature-1', createHmac('sha256', key).update(b).digest('base64'))
  return POST(new Request('https://app.test/api/webhooks/docusign', { method: 'POST', body: b }))
}

afterEach(() => {
  hdrs.clear()
  from.mockClear()
  onEnvelopeCompleted.mockClear()
  state.current = null
  state.updated = null
  state.updates = []
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('POST /api/webhooks/docusign', () => {
  it('rejects an unsigned request and writes nothing', async () => {
    const { POST } = await load('k'.repeat(32))
    expect((await post(POST)).status).toBe(401)
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects a signature made with another key and writes nothing', async () => {
    const { POST } = await load('k'.repeat(32))
    hdrs.set('x-docusign-signature-1', createHmac('sha256', 'other').update(body).digest('base64'))
    expect((await post(POST)).status).toBe(401)
    expect(from).not.toHaveBeenCalled()
  })

  it('fails closed when the key is unset, even with an empty-key signature', async () => {
    const { POST } = await load('')
    hdrs.set('x-docusign-signature-1', createHmac('sha256', '').update(body).digest('base64'))
    expect((await post(POST)).status).toBe(401)
    expect(from).not.toHaveBeenCalled()
  })

  it('accepts a correctly signed request (past the gate, into the handler)', async () => {
    const key = 'k'.repeat(32)
    const { POST } = await load(key)
    hdrs.set('x-docusign-signature-1', createHmac('sha256', key).update(body).digest('base64'))
    const res = await post(POST)
    expect(res.status).toBe(200)
    // Got past the signature check: the handler looked the envelope up.
    expect(from).toHaveBeenCalledWith('agreements')
  })
})

describe('POST /api/webhooks/docusign — event handling (DS-7)', () => {
  it('ignores an unknown envelope with 200 and writes nothing', async () => {
    state.current = null // no agreement row for this envelope id
    const res = await signedEvent('envelope-completed', 'env-unknown')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true })
    expect(state.updates).toEqual([])
    expect(onEnvelopeCompleted).not.toHaveBeenCalled()
  })

  it('drops a late "envelope-sent" that arrives after completion (stale ordering)', async () => {
    state.current = { id: 'r1', status: 'completed' }
    const res = await signedEvent('envelope-sent')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ skipped: 'stale sent after completed' })
    // mayTransition refused it: no status write, no completion side effects.
    expect(state.updates).toEqual([])
    expect(onEnvelopeCompleted).not.toHaveBeenCalled()
  })

  it('drops an "envelope-declined" that arrives after completion', async () => {
    state.current = { id: 'r1', status: 'completed' }
    const res = await signedEvent('envelope-declined')
    expect(await res.json()).toMatchObject({ skipped: 'stale declined after completed' })
    expect(state.updates).toEqual([])
    expect(onEnvelopeCompleted).not.toHaveBeenCalled()
  })

  it('forwards a replayed "envelope-completed" to the idempotent completion handler', async () => {
    // mayTransition allows completed→completed, so the route re-runs and relies
    // on onEnvelopeCompleted's completion_notified_at claim (tested in
    // completion.test.ts) not to send a second email — it never dedups itself.
    state.current = { id: 'r1', status: 'completed' }
    state.updated = { id: 'r1', provider: 'docusign', signers_total: 2 }
    const res = await signedEvent('envelope-completed')
    expect(res.status).toBe(200)
    expect(onEnvelopeCompleted).toHaveBeenCalledTimes(1)
    expect(onEnvelopeCompleted.mock.calls[0][1]).toMatchObject({ id: 'r1' })
  })
})
