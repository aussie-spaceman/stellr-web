// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

// Threat model R4b: the Printful route takes its secret from the `x-printful-secret`
// header only. A request whose secret is in the URL (`?secret=`) is refused 401 and
// never reaches the database, even when the value is right; a wrong header is
// refused the same way; the right header gets past the gate. The verifier is
// covered in lib/store/printful.test.ts; this pins the route's wiring of it.

const from = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ from }) }))
vi.mock('@/lib/audit/route', () => ({ auditMutation: async () => {} }))

const SECRET = 'pf-route-placeholder-secret'

async function load() {
  vi.resetModules()
  vi.stubEnv('PRINTFUL_WEBHOOK_SECRET', SECRET)
  return (await import('./route')).POST
}

// No `type` in the body: past the gate the handler answers { ok: true } with no DB work.
function post(POST: (r: Request) => Promise<Response>, opts: { header?: string; query?: string }) {
  const url = opts.query !== undefined
    ? `https://app.test/api/printful/webhook?secret=${encodeURIComponent(opts.query)}`
    : 'https://app.test/api/printful/webhook'
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (opts.header !== undefined) headers['x-printful-secret'] = opts.header
  return POST(new Request(url, { method: 'POST', headers, body: '{}' }))
}

afterEach(() => {
  from.mockReset()
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('POST /api/printful/webhook: secret in the header only', () => {
  it('accepts the right secret in the header', async () => {
    const POST = await load()
    expect((await post(POST, { header: SECRET })).status).toBe(200)
  })

  it('refuses the right secret in the query string, and writes nothing', async () => {
    const POST = await load()
    const res = await post(POST, { query: SECRET })
    expect(res.status).toBe(401)
    expect(from).not.toHaveBeenCalled()
  })

  it('refuses a wrong header, even with the right secret also in the query', async () => {
    const POST = await load()
    expect((await post(POST, { header: 'wrong' })).status).toBe(401)
    expect((await post(POST, { header: 'wrong', query: SECRET })).status).toBe(401)
    expect(from).not.toHaveBeenCalled()
  })
})
