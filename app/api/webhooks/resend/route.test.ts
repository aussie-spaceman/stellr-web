// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Webhook } from 'svix'
import { fakeSupabase } from '@/test/fake-supabase'

const { db } = vi.hoisted(() => ({ db: { current: null as unknown } }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => db.current }))
vi.mock('@/lib/notify', () => ({ notifyCommunityAdmins: vi.fn(async () => {}) }))

import { POST } from './route'

const secret = `whsec_${Buffer.from('c'.repeat(32)).toString('base64')}`

function signed(body: string, opts: { secret?: string } = {}) {
  const id = 'msg_s1'
  const at = new Date()
  return new Request('http://localhost/api/webhooks/resend', {
    method: 'POST',
    body,
    headers: {
      'svix-id': id,
      'svix-timestamp': String(Math.floor(at.getTime() / 1000)),
      'svix-signature': new Webhook(opts.secret ?? secret).sign(id, at, body),
    },
  })
}

function setup() {
  const fake = fakeSupabase({ agreement_recipients: [], email_suppressions: [] })
  db.current = fake.client
  return fake
}

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('POST /api/webhooks/resend — suppression list', () => {
  it('refuses every call when RESEND_WEBHOOK_SECRET is unset', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', '')
    const fake = setup()
    const res = await POST(signed(JSON.stringify({ type: 'email.complained', data: { to: ['a@example.test'] } })))
    expect(res.status).toBe(500)
    expect(fake.table('email_suppressions')).toHaveLength(0)
  })

  it('refuses a missing or forged signature', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', secret)
    const fake = setup()
    const body = JSON.stringify({ type: 'email.complained', data: { to: ['a@example.test'] } })
    const unsigned = await POST(new Request('http://localhost/api/webhooks/resend', { method: 'POST', body }))
    expect(unsigned.status).toBe(400)
    const forged = await POST(signed(body, { secret: `whsec_${Buffer.from('d'.repeat(32)).toString('base64')}` }))
    expect(forged.status).toBe(400)
    expect(fake.table('email_suppressions')).toHaveLength(0)
  })

  it('records a complaint and a hard bounce, idempotently', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', secret)
    const fake = setup()
    const complaint = JSON.stringify({ type: 'email.complained', data: { email_id: 're_1', to: ['Parent@Example.test'] } })
    const first = await POST(signed(complaint))
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ received: true, suppressed: 1, bounced: 0 })
    // Resend redelivers: nothing changes.
    expect((await POST(signed(complaint))).status).toBe(200)
    const bounce = JSON.stringify({ type: 'email.bounced', data: { email_id: 're_2', to: ['gone@example.test'], bounce: { type: 'Permanent' } } })
    expect((await POST(signed(bounce))).status).toBe(200)
    expect(fake.table('email_suppressions').map((r) => [r.email, r.reason])).toEqual([
      ['parent@example.test', 'complaint'],
      ['gone@example.test', 'bounce'],
    ])
  })

  it('acknowledges events it does not act on', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', secret)
    const fake = setup()
    const res = await POST(signed(JSON.stringify({ type: 'email.delivered', data: { to: ['a@example.test'] } })))
    expect(await res.json()).toEqual({ received: true, suppressed: 0, bounced: 0 })
    expect(fake.table('email_suppressions')).toHaveLength(0)
  })

  it('rejects a signed body that is not an event', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', secret)
    setup()
    expect((await POST(signed('null'))).status).toBe(400)
  })
})
