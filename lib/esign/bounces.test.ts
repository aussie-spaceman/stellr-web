// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Webhook } from 'svix'
import { fakeSupabase } from '@/test/fake-supabase'

const { notify, db } = vi.hoisted(() => ({ notify: vi.fn(async () => {}), db: { current: null as unknown } }))
vi.mock('@/lib/notify', () => ({ notifyCommunityAdmins: notify }))
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => db.current }))

import { handleResendEvent } from './bounces'
import { POST } from '@/app/api/webhooks/resend/route'

function setup() {
  const fake = fakeSupabase({
    agreements: [{ id: 'env-1', event_title: 'CO SDC', minor_name: 'Luke Lee', signer_name: 'Pat Lee' }],
    agreement_recipients: [
      { id: 'r1', envelope_row: 'env-1', email: 'pat@example.test', status: 'sent', invite_email_id: 're_bundle' },
      { id: 'r2', envelope_row: 'env-2', email: 'pat@example.test', status: 'sent', invite_email_id: 're_bundle' },
      { id: 'r3', envelope_row: 'env-3', email: 'sam@example.test', status: 'completed', invite_email_id: 're_done' },
    ],
  })
  db.current = fake.client
  return fake
}

beforeEach(() => vi.clearAllMocks())

describe('handleResendEvent', () => {
  it('marks every form the bounced email carried, and tells the admins once', async () => {
    const fake = setup()
    const out = await handleResendEvent(fake.client, { type: 'email.bounced', data: { email_id: 're_bundle', bounce: { message: 'Mailbox does not exist' } } })
    expect(out).toEqual({ bounced: 2 })
    const rows = fake.table('agreement_recipients')
    expect(rows.filter((r) => r.status === 'autoresponded').map((r) => r.id)).toEqual(['r1', 'r2'])
    expect(rows[0].invite_error).toBe('Bounced: Mailbox does not exist')
    expect(notify).toHaveBeenCalledTimes(1)
    const body = (notify.mock.calls[0] as unknown as [{ body: string }])[0].body
    expect(body).toContain('2 forms for Luke Lee, CO SDC')
    expect(body).not.toContain('pat@example.test') // masked
  })

  it('ignores other events, other emails, and signers who already signed', async () => {
    const fake = setup()
    expect(await handleResendEvent(fake.client, { type: 'email.delivered', data: { email_id: 're_bundle' } })).toEqual({ bounced: 0 })
    expect(await handleResendEvent(fake.client, { type: 'email.bounced', data: { email_id: 're_paylink' } })).toEqual({ bounced: 0 })
    expect(await handleResendEvent(fake.client, { type: 'email.bounced', data: { email_id: 're_done' } })).toEqual({ bounced: 0 })
    expect(notify).not.toHaveBeenCalled()
  })
})

describe('POST /api/webhooks/resend', () => {
  const secret = `whsec_${Buffer.from('a'.repeat(32)).toString('base64')}`

  function signed(body: string, opts: { secret?: string; at?: Date } = {}) {
    const id = 'msg_1'
    const at = opts.at ?? new Date()
    const signature = new Webhook(opts.secret ?? secret).sign(id, at, body)
    return new Request('http://localhost/api/webhooks/resend', {
      method: 'POST',
      body,
      headers: { 'svix-id': id, 'svix-timestamp': String(Math.floor(at.getTime() / 1000)), 'svix-signature': signature },
    })
  }

  it('acts on a correctly signed bounce', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', secret)
    setup()
    const res = await POST(signed(JSON.stringify({ type: 'email.bounced', data: { email_id: 're_bundle' } })))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true, bounced: 2 })
  })

  it('refuses a wrong signature or a replayed old message', async () => {
    vi.stubEnv('RESEND_WEBHOOK_SECRET', secret)
    const fake = setup()
    const body = JSON.stringify({ type: 'email.bounced', data: { email_id: 're_bundle' } })
    const forged = await POST(signed(body, { secret: `whsec_${Buffer.from('b'.repeat(32)).toString('base64')}` }))
    expect(forged.status).toBe(400)
    const stale = await POST(signed(body, { at: new Date(Date.now() - 60 * 60_000) }))
    expect(stale.status).toBe(400)
    expect(fake.table('agreement_recipients').every((r) => r.status !== 'autoresponded')).toBe(true)
  })
})
