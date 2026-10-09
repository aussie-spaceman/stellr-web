// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

// deep review TEST-1: pin that the Printful route actually wires its verifier in
// (verifyPrintfulWebhook) — an unauthenticated POST is rejected 401 and never
// touches the DB, a correctly authenticated one gets past the gate. The verifier
// itself is covered in lib/store/printful.test.ts.

const from = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ from }) }))

const SECRET = 'pf-secret-123'
async function load(secret: string) {
  vi.resetModules()
  vi.stubEnv('PRINTFUL_WEBHOOK_SECRET', secret)
  return import('./route')
}

function post(POST: (r: Request) => Promise<Response>, header?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (header !== undefined) headers['x-printful-secret'] = header
  // No `type` → handler returns { ok: true } right after the gate, no DB work.
  return POST(new Request('https://app.test/api/printful/webhook', { method: 'POST', headers, body: '{}' }))
}

afterEach(() => {
  from.mockReset()
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('POST /api/printful/webhook', () => {
  it('rejects an unauthenticated request and writes nothing', async () => {
    const { POST } = await load(SECRET)
    expect((await post(POST)).status).toBe(401)
    expect(from).not.toHaveBeenCalled()
  })

  it('fails closed when the secret is unset', async () => {
    const { POST } = await load('')
    expect((await post(POST, 'anything')).status).toBe(401)
    expect(from).not.toHaveBeenCalled()
  })

  it('accepts a correctly authenticated request (past the gate)', async () => {
    const { POST } = await load(SECRET)
    expect((await post(POST, SECRET)).status).toBe(200)
  })
})
