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
const from = vi.fn(() => {
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'update']) chain[m] = () => chain
  chain.maybeSingle = async () => ({ data: null, error: null })
  return chain
})

vi.mock('next/headers', () => ({ headers: async () => ({ get: (k: string) => hdrs.get(k) ?? null }) }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ from }) }))

async function load(key: string) {
  vi.resetModules()
  vi.stubEnv('DOCUSIGN_CONNECT_HMAC_KEY', key)
  return import('./route')
}

const body = JSON.stringify({ event: 'envelope-completed', data: { envelopeId: 'env-1' } })
const post = (POST: (r: Request) => Promise<Response>) =>
  POST(new Request('https://app.test/api/webhooks/docusign', { method: 'POST', body }))

afterEach(() => {
  hdrs.clear()
  from.mockClear()
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
