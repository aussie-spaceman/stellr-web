// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'

const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/email', async (orig) => ({ ...(await orig<typeof import('@/lib/email')>()), sendEmail }))

import { EmailSendError } from '@/lib/email'
import { batchInvites, sendInvites } from './outbox'

const recipient = (id: string, order: number, role = 'Guardian') => ({
  id: `00000000-0000-4000-8000-00000000000${id}`,
  envelope_row: 'env-1', recipient_id: id, role_name: role, name: `Signer ${id}`, email: `s${id}@x.test`,
  status: 'sent', routing_order: order, member_id: null, token_version: 1,
  token_expires_at: new Date(Date.now() + 86_400_000).toISOString(), invite_sent_at: null,
})

function setup(budget: number) {
  const db = fakeSupabase({
    docusign_envelopes: [{ id: 'env-1', envelope_type: 'minor', event_title: 'E', minor_name: 'Kid', status: 'sent', prefill: {} }],
    docusign_envelope_recipients: [recipient('1', 1), recipient('2', 2, 'Minor'), recipient('3', 1)],
  })
  let used = 0
  db.rpcs.esign_claim_email = () => (used < budget ? (used++, true) : false)
  db.rpcs.esign_append_audit = () => ({ id: 1 })
  return db
}

beforeEach(() => {
  vi.stubEnv('ESIGN_TOKEN_SECRET', 'k'.repeat(48))
  sendEmail.mockReset()
  sendEmail.mockResolvedValue({ id: 're_1' })
})
afterEach(() => vi.unstubAllEnvs())

describe('sendInvites', () => {
  it('sends guardians first and stops at the day’s budget, leaving the rest queued', async () => {
    const db = setup(2)
    const rows = db.table('docusign_envelope_recipients')
    const result = await sendInvites(db.client, rows as never)

    expect(result).toEqual({ sent: 2, deferred: 1, failed: 0 })
    // Both order-1 signers went; the order-2 signer waits.
    expect(sendEmail.mock.calls.map((c) => c[0].to).sort()).toEqual(['s1@x.test', 's3@x.test'])
    expect(rows.find((r) => r.recipient_id === '2')?.invite_sent_at).toBeNull()
    expect(rows.find((r) => r.recipient_id === '1')?.invite_sent_at).toBeTruthy()
  })

  it('puts a signing link, not an attachment, in the email', async () => {
    const db = setup(5)
    await sendInvites(db.client, [db.table('docusign_envelope_recipients')[0]] as never)
    const msg = sendEmail.mock.calls[0][0]
    expect(msg.text).toMatch(/\/sign#[0-9a-f-]{36}\.s1\.\d+\./)
    expect(msg.attachments).toBeUndefined()
  })

  it('stops the batch on Resend’s rate limit or quota, and records the failure', async () => {
    const db = setup(10)
    sendEmail.mockRejectedValueOnce(new EmailSendError('daily quota', 429))
    const result = await sendInvites(db.client, db.table('docusign_envelope_recipients') as never)
    expect(result).toEqual({ sent: 0, deferred: 2, failed: 1 })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const first = db.table('docusign_envelope_recipients').find((r) => r.recipient_id === '1')
    expect(first?.invite_error).toMatch(/daily quota/)
  })
})

describe('a parent with several forms', () => {
  // Siblings Luke and Lily, one parent address (in two spellings), plus Luke's own row.
  function siblings(budget: number) {
    const parent = (id: string, env: string) => ({ ...recipient(id, 1), envelope_row: env, email: id === '1' ? 'Pat@x.test' : 'pat@x.test', name: 'Pat Lee' })
    const db = fakeSupabase({
      docusign_envelopes: [
        { id: 'env-luke', envelope_type: 'minor', event_title: 'CO SDC', minor_name: 'Luke Lee', status: 'sent', prefill: { MinorName: 'Luke' } },
        { id: 'env-lily', envelope_type: 'minor', event_title: 'CO SDC', minor_name: 'Lily Lee', status: 'sent', prefill: { MinorName: 'Lily' } },
      ],
      docusign_envelope_recipients: [parent('1', 'env-luke'), parent('2', 'env-lily'), { ...recipient('3', 2, 'Minor'), envelope_row: 'env-luke' }],
    })
    const claims = { used: 0 }
    db.rpcs.esign_claim_email = () => (claims.used < budget ? (claims.used++, true) : false)
    db.rpcs.esign_append_audit = () => ({ id: 1 })
    return { db, claims }
  }

  it('gets one email with a link for each child, spending one send', async () => {
    const { db, claims } = siblings(5)
    const rows = db.table('docusign_envelope_recipients')
    const result = await sendInvites(db.client, rows.slice(0, 2) as never)

    expect(result).toEqual({ sent: 2, deferred: 0, failed: 0 })
    expect(claims.used).toBe(1)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const msg = sendEmail.mock.calls[0][0]
    expect(msg.to).toBe('Pat@x.test')
    expect(msg.subject).toBe('Parent/guardian signature needed: 2 forms for Luke and Lily for CO SDC')
    expect(msg.html).toContain('Review and sign for Luke')
    expect(msg.html).toContain('Review and sign for Lily')
    // Two different links, one per form.
    const links = [...msg.text.matchAll(/\/sign#([0-9a-f-]{36})\./g)].map((m) => m[1])
    expect(new Set(links)).toEqual(new Set([rows[0].id, rows[1].id]))
    expect(rows.slice(0, 2).every((r) => r.invite_sent_at)).toBe(true)
  })

  it('inside batchInvites, waits and sends once at the end', async () => {
    const { db, claims } = siblings(5)
    const rows = db.table('docusign_envelope_recipients')
    const during = await batchInvites(db.client, async () => {
      expect(await sendInvites(db.client, [rows[0]] as never)).toEqual({ sent: 0, deferred: 1, failed: 0 })
      expect(await sendInvites(db.client, [rows[1]] as never)).toEqual({ sent: 0, deferred: 1, failed: 0 })
      return sendEmail.mock.calls.length
    })
    expect(during).toBe(0)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(claims.used).toBe(1)
  })

  it('a student is never folded into their parent’s email', async () => {
    const { db } = siblings(5)
    const rows = db.table('docusign_envelope_recipients')
    await sendInvites(db.client, [rows[0], { ...rows[2], email: 'pat@x.test' }] as never)
    expect(sendEmail).toHaveBeenCalledTimes(2)
  })
})
