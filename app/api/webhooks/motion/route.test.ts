// @vitest-environment node
import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

// deep review TEST-1: the Motion webhook stamps "call booked" on a HubSpot
// contact — an open write to the CRM if unauthenticated. Pin fail-closed: unset
// secret → 503, unsigned/wrong HMAC → 401 with HubSpot never called, and a
// correctly signed request gets past the gate. MOTION_WEBHOOK_SECRET is read at
// module load, so each case re-imports through a fresh registry.

const getContactByEmail = vi.fn(async () => null)
const upsertContact = vi.fn(async () => ({ ok: true }))
const createNote = vi.fn(async () => ({ ok: true }))

vi.mock('@/lib/hubspot', () => ({ getContactByEmail, upsertContact, createNote }))
vi.mock('@/lib/hubspot-fields', () => ({ HS: { lpAudience: 'lp_audience', lpCallBooked: 'lp_call_booked' } }))

const SECRET = 'motion-secret'
const body = JSON.stringify({ email: 'known@lead.test', startTime: '2026-11-01T10:00:00Z' })

async function load(secret: string) {
  vi.resetModules()
  vi.stubEnv('MOTION_WEBHOOK_SECRET', secret)
  return import('./route')
}

function post(POST: (r: Request) => Promise<Response>, sig?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (sig !== undefined) headers['x-motion-signature'] = sig
  return POST(new Request('https://app.test/api/webhooks/motion', { method: 'POST', headers, body }))
}

const signWith = (key: string) => createHmac('sha256', key).update(body).digest('hex')

afterEach(() => {
  getContactByEmail.mockClear()
  upsertContact.mockClear()
  createNote.mockClear()
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('POST /api/webhooks/motion', () => {
  it('fails closed (503) when MOTION_WEBHOOK_SECRET is unset, never calling HubSpot', async () => {
    const { POST } = await load('')
    expect((await post(POST, signWith('motion-secret'))).status).toBe(503)
    expect(getContactByEmail).not.toHaveBeenCalled()
  })

  it('rejects an unsigned request', async () => {
    const { POST } = await load(SECRET)
    expect((await post(POST)).status).toBe(401)
    expect(getContactByEmail).not.toHaveBeenCalled()
  })

  it('rejects a signature made with another secret', async () => {
    const { POST } = await load(SECRET)
    expect((await post(POST, signWith('other'))).status).toBe(401)
    expect(getContactByEmail).not.toHaveBeenCalled()
  })

  it('accepts a correctly signed request (past the gate, into HubSpot lookup)', async () => {
    const { POST } = await load(SECRET)
    const res = await post(POST, signWith(SECRET))
    expect(res.status).toBe(200)
    // Got past the signature gate: it looked the contact up (unknown → no write).
    expect(getContactByEmail).toHaveBeenCalledWith('known@lead.test', ['lp_audience'])
  })
})
