// @vitest-environment node
import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { recordingStoragePath, recordingWithinSizeLimit } from './route'

// deep review TEST-1: the recording webhook has two authenticated paths, both of
// which drive a server-side fetch(recordingUrl) + write into the private bucket —
// an SSRF + arbitrary-overwrite vector if unauthenticated.
//   • JaaS path (X-Jaas-Signature, HMAC over "<t>.<body>", base64, ±300s skew):
//     unset JAAS_WEBHOOK_SECRET → 500, bad signature → 401, correct → past gate.
//   • Legacy shared-secret path (x-webhook-secret): unset LEGACY secret → 403,
//     wrong secret → 401.
// Both secrets are read at module load, so each case re-imports through a fresh
// registry. The DB/storage layer is mocked so nothing is written on a rejection.

const from = vi.fn(() => {
  const chain: Record<string, unknown> = {}
  for (const m of ['update', 'eq', 'select']) chain[m] = () => chain
  return chain
})
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => ({ from, storage: { from: () => ({ upload: async () => ({ error: null }) }) } }) }))
vi.mock('@/lib/community', () => ({ RESOURCES_BUCKET: 'resources' }))
vi.mock('@/lib/watermark/video-queue', () => ({ enqueueVideoWatermark: vi.fn() }))

async function load(jaas: string, legacy: string) {
  vi.resetModules()
  vi.stubEnv('JAAS_WEBHOOK_SECRET', jaas)
  vi.stubEnv('RECORDING_WEBHOOK_SECRET', legacy)
  return import('./route')
}

// A benign (non-upload) event so a verified JaaS request is acked without any
// offload — isolates the signature gate.
const jaasBody = JSON.stringify({ eventType: 'RECORDING_STARTED', fqn: 'app/stellr-sess-1' })

function jaasHeader(secret: string, body: string, ts = Math.floor(Date.now() / 1000)) {
  const sig = createHmac('sha256', secret).update(`${ts}.${body}`).digest('base64')
  return `t=${ts},v1=${sig}`
}

function post(POST: (r: Request) => Promise<Response>, headers: Record<string, string>, body: string) {
  return POST(new Request('https://app.test/api/webhooks/recording', { method: 'POST', headers, body }))
}

afterEach(() => {
  from.mockClear()
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('POST /api/webhooks/recording — JaaS path', () => {
  it('fails closed (500) when JAAS_WEBHOOK_SECRET is unset, writing nothing', async () => {
    const { POST } = await load('', 'legacy')
    const res = await post(POST, { 'x-jaas-signature': jaasHeader('whatever', jaasBody) }, jaasBody)
    expect(res.status).toBe(500)
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects a signature made with another key', async () => {
    const { POST } = await load('jaas-secret', 'legacy')
    const res = await post(POST, { 'x-jaas-signature': jaasHeader('other', jaasBody) }, jaasBody)
    expect(res.status).toBe(401)
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects a stale (replayed) signature outside the 5-minute window', async () => {
    const { POST } = await load('jaas-secret', 'legacy')
    const staleTs = Math.floor(Date.now() / 1000) - 600
    const res = await post(POST, { 'x-jaas-signature': jaasHeader('jaas-secret', jaasBody, staleTs) }, jaasBody)
    expect(res.status).toBe(401)
    expect(from).not.toHaveBeenCalled()
  })

  it('accepts a correctly signed request (past the gate)', async () => {
    const { POST } = await load('jaas-secret', 'legacy')
    const res = await post(POST, { 'x-jaas-signature': jaasHeader('jaas-secret', jaasBody) }, jaasBody)
    expect(res.status).toBe(200) // non-upload event acked without offload
  })
})

describe('POST /api/webhooks/recording — legacy shared-secret path', () => {
  const body = JSON.stringify({ sessionId: 's1', recordingUrl: 'https://rec.test/x.mp4' })

  it('fails closed (403) when the legacy secret is unset', async () => {
    const { POST } = await load('jaas-secret', '')
    const res = await post(POST, { 'x-webhook-secret': 'anything' }, body)
    expect(res.status).toBe(403)
    expect(from).not.toHaveBeenCalled()
  })

  it('rejects a wrong legacy secret', async () => {
    const { POST } = await load('jaas-secret', 'legacy-secret')
    const res = await post(POST, { 'x-webhook-secret': 'wrong' }, body)
    expect(res.status).toBe(401)
    expect(from).not.toHaveBeenCalled()
  })
})

// deep review INT-11: the storage path used to carry a Date.now() suffix, so
// every JaaS retry wrote a NEW object and orphaned the previous one. A
// deterministic path + upsert means a retry overwrites in place.
describe('recordingStoragePath is deterministic (no orphaning on retry)', () => {
  it('returns the same path for the same target across calls, with no timestamp', () => {
    const a = recordingStoragePath({ kind: 'session', id: 'sess-1' })
    const b = recordingStoragePath({ kind: 'session', id: 'sess-1' })
    expect(a).toBe(b)
    expect(a).toBe('recordings/sess-1.mp4')
    expect(a).not.toMatch(/\d{10,}/) // no epoch-ms suffix
  })

  it('namespaces training recordings', () => {
    expect(recordingStoragePath({ kind: 'training', id: 'item-9' })).toBe('recordings/train-item-9.mp4')
  })
})

// deep review INT-11: refuse to buffer an oversized recording into memory.
describe('recordingWithinSizeLimit guards the in-memory buffer', () => {
  it('rejects a file over the cap', () => {
    expect(recordingWithinSizeLimit(200, 100)).toBe(false)
  })
  it('accepts a file at or under the cap', () => {
    expect(recordingWithinSizeLimit(100, 100)).toBe(true)
    expect(recordingWithinSizeLimit(10, 100)).toBe(true)
  })
  it('allows an unknown size through (bounded by maxDuration)', () => {
    expect(recordingWithinSizeLimit(null, 100)).toBe(true)
  })
})
