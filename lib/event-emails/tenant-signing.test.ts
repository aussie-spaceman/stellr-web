// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// S5 B14 follow-up: the checked call the tenant guardian-consent slice uses to
// send a tenant guardian their signing invitation. It runs the real outbox and
// loaders; only sendEmail is a spy.

const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn(async (_o: Record<string, unknown>) => ({ id: 're_1' })) }))
vi.mock('@/lib/email', async (orig) => ({ ...(await orig<typeof import('@/lib/email')>()), sendEmail }))
vi.mock('@/lib/esign/bounce-notices', () => ({ announceBounces: vi.fn(async () => 0) }))

const { sendTenantSigningInvitation, TENANT_SIGNING_FAILED } = await import('./tenant-signing')
const { TENANT_SENDER_REQUIRED } = await import('./tenant-mail')

const ROCKET = '11111111-1111-4111-8111-111111111111'
const ORBIT = '22222222-2222-4222-8222-222222222222'
const QUIET = '33333333-3333-4333-8333-333333333333'
const TENANTS = [
  { id: ROCKET, display_name: 'Rocket Club', branding: { reply_to: 'events@rocket.example.org' } },
  { id: ORBIT, display_name: 'Orbit League', branding: { reply_to: 'hello@orbit.example.org' } },
  { id: QUIET, display_name: 'Quiet Org', branding: {} },
]

const envelope = (tenant: string | null, over: Record<string, unknown> = {}) => ({
  id: 'env-1', envelope_id: 'native-1', provider: 'native', envelope_type: 'minor', event_title: 'Launch Day',
  minor_name: 'Sam', status: 'sent', prefill: { MinorName: 'Sam' }, tenant_id: tenant, ...over,
})
const guardian = (over: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-000000000001', envelope_row: 'env-1', recipient_id: '1', role_name: 'Guardian',
  name: 'Pat Lee', email: 'pat@x.test', status: 'sent', routing_order: 1, member_id: null, token_version: 1,
  token_expires_at: new Date(Date.now() + 86_400_000).toISOString(), invite_sent_at: null, ...over,
})
// The 15-year-old signs after their guardian: queued, not yet emailed.
const student = { ...guardian(), id: '00000000-0000-4000-8000-000000000002', recipient_id: '2', role_name: 'Minor', name: 'Sam Lee', email: 'sam@x.test', status: 'created', routing_order: 2 }

function setup(agreements: object[], recipients: object[] = [guardian(), student]) {
  const db = fakeSupabase({ agreements, agreement_recipients: recipients, tenants: TENANTS })
  const claims = { n: 0 }
  db.rpcs.esign_claim_email = () => (claims.n++, true)
  db.rpcs.esign_append_audit = () => ({ id: 1 })
  return { db, claims }
}

beforeEach(() => {
  vi.stubEnv('ESIGN_TOKEN_SECRET', 'k'.repeat(48))
  vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', 'true')
  sendEmail.mockClear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('sendTenantSigningInvitation', () => {
  it('sends the guardian their invitation from the tenant’s sender; the 15-year-old waits their turn', async () => {
    const { db, claims } = setup([envelope(ROCKET)])
    const out = await sendTenantSigningInvitation(db.client, { tenantId: ROCKET, envelopeRowId: 'env-1' })
    expect(out).toEqual({ ok: true, result: { sent: 1, deferred: 0, failed: 0 } })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail.mock.calls[0][0]).toMatchObject({
      to: 'pat@x.test',
      from: '"Rocket Club via Stellr" <no-reply@mail.stellreducation.org>',
      replyTo: 'events@rocket.example.org',
      critical: true,
    })
    expect(claims.n).toBe(1)
  })

  it('a repeat call sends nothing twice', async () => {
    const { db } = setup([envelope(ROCKET)])
    await sendTenantSigningInvitation(db.client, { tenantId: ROCKET, envelopeRowId: 'env-1' })
    const again = await sendTenantSigningInvitation(db.client, { tenantId: ROCKET, envelopeRowId: 'env-1' })
    expect(again).toEqual({ ok: true, result: { sent: 0, deferred: 0, failed: 0 } })
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it('flag off: refuses and sends nothing', async () => {
    vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', '')
    const { db } = setup([envelope(ROCKET)])
    expect(await sendTenantSigningInvitation(db.client, { tenantId: ROCKET, envelopeRowId: 'env-1' })).toEqual({ ok: false, reason: 'disabled' })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it.each([[STELLR_TENANT_ID], [null as unknown as string]])('refuses Stellr’s own tenant (%s): its envelopes keep Stellr’s sender', async (tenant) => {
    const { db } = setup([envelope(null)])
    expect(await sendTenantSigningInvitation(db.client, { tenantId: tenant, envelopeRowId: 'env-1' })).toEqual({ ok: false, reason: 'stellr' })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('refuses an envelope that belongs to another tenant, or to Stellr, whatever the caller says, with the same answer as a missing one', async () => {
    for (const owner of [ORBIT, null, STELLR_TENANT_ID]) {
      const { db } = setup([envelope(owner)])
      expect(await sendTenantSigningInvitation(db.client, { tenantId: ROCKET, envelopeRowId: 'env-1' })).toEqual({ ok: false, reason: 'not_found' })
    }
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('refuses a missing envelope, a DocuSign one, and one no longer out for signature', async () => {
    const missing = setup([])
    expect(await sendTenantSigningInvitation(missing.db.client, { tenantId: ROCKET, envelopeRowId: 'env-1' })).toEqual({ ok: false, reason: 'not_found' })
    const docusign = setup([envelope(ROCKET, { provider: 'docusign' })])
    expect(await sendTenantSigningInvitation(docusign.db.client, { tenantId: ROCKET, envelopeRowId: 'env-1' })).toEqual({ ok: false, reason: 'not_found' })
    const voided = setup([envelope(ROCKET, { status: 'voided' })])
    expect(await sendTenantSigningInvitation(voided.db.client, { tenantId: ROCKET, envelopeRowId: 'env-1' })).toEqual({ ok: false, reason: 'not_out_for_signature' })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('a tenant with no usable sender: refused with the approved text, nothing sent or claimed', async () => {
    const { db, claims } = setup([envelope(QUIET)])
    expect(await sendTenantSigningInvitation(db.client, { tenantId: QUIET, envelopeRowId: 'env-1' })).toEqual({
      ok: false, reason: 'no_sender', error: TENANT_SENDER_REQUIRED,
    })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(claims.n).toBe(0)
    expect(db.table('agreement_recipients')[0].invite_sent_at).toBeNull()
  })

  it('never throws: a failed read comes back as failed', async () => {
    const db = fakeSupabase({}, { failOn: (table) => (table === 'agreements' ? 'database gone' : null) })
    expect(await sendTenantSigningInvitation(db.client, { tenantId: ROCKET, envelopeRowId: 'env-1' })).toEqual({ ok: false, reason: 'failed', error: TENANT_SIGNING_FAILED })
  })
})
