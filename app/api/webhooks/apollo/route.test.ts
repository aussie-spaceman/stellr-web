// @vitest-environment node
import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

// deep review TEST-1: the Apollo webhook creates HubSpot contacts and deals, so
// an unauthenticated POST is an open write to the CRM. It authenticates by a
// shared secret header (primary) OR an HMAC signature (Zapier/Make fallback).
// Pin fail-closed: unset APOLLO_WEBHOOK_SECRET → 503, no/ wrong secret and wrong
// HMAC → 401 with HubSpot never called, and both a correct shared secret and a
// correct HMAC get past the gate. SECRET is read at module load.

const getContactByEmail = vi.fn()
const upsertContact = vi.fn()
const createNote = vi.fn()

// apollo-events is stubbed so a verified request lands on the no-op
// "connection test" branch (no email, unresolved tokens) without reaching
// HubSpot — isolating the auth gate.
vi.mock('@/lib/apollo-events', () => ({
  classify: () => undefined,
  findEmail: () => undefined,
  findString: () => undefined,
  hasUnresolvedTemplateTokens: () => true,
  normaliseEngagement: () => 'clicked',
}))
vi.mock('@/lib/hubspot', () => ({ getContactByEmail, upsertContact, createNote }))
vi.mock('@/lib/hubspot-deals', () => ({
  createDeal: vi.fn(), dealsForContact: vi.fn(), decideDealAction: vi.fn(), moveDealToStage: vi.fn(),
}))
vi.mock('@/lib/hubspot-companies', () => ({ associateDefault: vi.fn(), ensureCompany: vi.fn() }))

const SECRET = 'apollo-secret'
const body = JSON.stringify({ contact: '{{contact.email}}' })

async function load(secret: string) {
  vi.resetModules()
  vi.stubEnv('APOLLO_WEBHOOK_SECRET', secret)
  return import('./route')
}

function post(POST: (r: Request) => Promise<Response>, headers: Record<string, string> = {}) {
  return POST(new Request('https://app.test/api/webhooks/apollo?event=clicked', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body,
  }))
}

const hmac = (key: string) => createHmac('sha256', key).update(body).digest('hex')

afterEach(() => {
  getContactByEmail.mockReset()
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('POST /api/webhooks/apollo', () => {
  it('fails closed (503) when APOLLO_WEBHOOK_SECRET is unset, never calling HubSpot', async () => {
    const { POST } = await load('')
    expect((await post(POST, { 'x-apollo-webhook-secret': 'anything' })).status).toBe(503)
    expect(getContactByEmail).not.toHaveBeenCalled()
  })

  it('rejects a request with no credentials', async () => {
    const { POST } = await load(SECRET)
    expect((await post(POST)).status).toBe(401)
    expect(getContactByEmail).not.toHaveBeenCalled()
  })

  it('rejects a wrong shared secret', async () => {
    const { POST } = await load(SECRET)
    expect((await post(POST, { 'x-apollo-webhook-secret': 'wrong' })).status).toBe(401)
    expect(getContactByEmail).not.toHaveBeenCalled()
  })

  it('rejects a wrong HMAC signature', async () => {
    const { POST } = await load(SECRET)
    expect((await post(POST, { 'x-apollo-signature': hmac('other') })).status).toBe(401)
    expect(getContactByEmail).not.toHaveBeenCalled()
  })

  it('accepts a correct shared secret (past the gate)', async () => {
    const { POST } = await load(SECRET)
    expect((await post(POST, { 'x-apollo-webhook-secret': SECRET })).status).toBe(200)
  })

  it('accepts a correct HMAC signature (past the gate)', async () => {
    const { POST } = await load(SECRET)
    expect((await post(POST, { 'x-apollo-signature': hmac(SECRET) })).status).toBe(200)
  })
})
