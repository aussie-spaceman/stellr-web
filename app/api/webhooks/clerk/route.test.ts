// @vitest-environment node
import { Webhook } from 'svix'
import { afterEach, describe, expect, it, vi } from 'vitest'

// deep review TEST-1: the Clerk webhook provisions, updates and soft-deletes
// member records off svix-signed events. Pin fail-closed: no secret → 500,
// missing/invalid svix signature → 400 with nothing written, and a correctly
// signed event gets past the gate. CLERK_WEBHOOK_SECRET is read per request.

const from = vi.fn()

vi.mock('next/headers', () => ({ headers: async () => ({ get: (k: string) => hdrs.get(k) ?? null }) }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ from }) }))
// Downstream helpers are irrelevant to the signature gate; a benign event type
// never reaches them anyway.
vi.mock('@/lib/member-enums', () => ({ normalizeEmail: (e: string) => e }))
vi.mock('@/lib/spaces', () => ({ claimPendingSpaceInvites: vi.fn() }))
vi.mock('@/lib/member-roles', () => ({ syncMemberClassificationRole: vi.fn() }))
vi.mock('@/lib/esign/retention', () => ({ startRetentionClock: vi.fn() }))

const hdrs = new Map<string, string>()
const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'
// An event type the handler does not act on: a verified request returns
// { received: true } without touching the DB, which isolates the signature gate.
const body = JSON.stringify({ type: 'session.created', data: { id: 'u_1' } })

async function load(secret: string) {
  vi.resetModules()
  vi.stubEnv('CLERK_WEBHOOK_SECRET', secret)
  return import('./route')
}

function sign(secret: string) {
  const id = 'msg_1'
  const timestamp = new Date()
  const signature = new Webhook(secret).sign(id, timestamp, body)
  hdrs.set('svix-id', id)
  hdrs.set('svix-timestamp', Math.floor(timestamp.getTime() / 1000).toString())
  hdrs.set('svix-signature', signature)
}

const post = (POST: (r: Request) => Promise<Response>) =>
  POST(new Request('https://app.test/api/webhooks/clerk', { method: 'POST', body }))

afterEach(() => {
  hdrs.clear()
  from.mockReset()
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('POST /api/webhooks/clerk', () => {
  it('fails closed (500) when CLERK_WEBHOOK_SECRET is unset, writing nothing', async () => {
    const { POST } = await load('')
    sign(SECRET)
    expect((await post(POST)).status).toBe(500)
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects a request with no svix headers', async () => {
    const { POST } = await load(SECRET)
    expect((await post(POST)).status).toBe(400)
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects a signature made with another secret and writes nothing', async () => {
    const { POST } = await load(SECRET)
    sign('whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA') // valid svix secret, wrong value
    expect((await post(POST)).status).toBe(400)
    expect(from).not.toHaveBeenCalled()
  })

  it('accepts a correctly signed event (past the gate)', async () => {
    const { POST } = await load(SECRET)
    sign(SECRET)
    expect((await post(POST)).status).toBe(200)
  })
})
