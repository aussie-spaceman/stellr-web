// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fakeSupabase } from '@/test/fake-supabase'

// S5 wave 6: a guardian declining the consent for another organiser's event
// settles that consent (the registration is removed and the registrant told, in
// lib/registration/tenant-guardian-consent.ts). Any other decline does not.

const { settleDeclined } = vi.hoisted(() => ({ settleDeclined: vi.fn(async (_db: unknown, _env: unknown, _o?: unknown) => {}) }))
vi.mock('@/lib/registration/tenant-guardian-consent', () => ({ settleTenantGuardianConsentDeclined: settleDeclined }))
vi.mock('@/lib/esign/native/audit', async (orig) => ({
  ...(await orig<typeof import('@/lib/esign/native/audit')>()),
  appendAudit: vi.fn(async () => ({ id: 'a-1' })),
}))

const { declineAgreement } = await import('./flow')

const CANARY = 'c0000000-0000-4000-8000-0000000000aa'

function setup(envelopeType: string, tenantId: string | null) {
  const fake = fakeSupabase({
    agreements: [{ id: 'agr-1', status: 'sent', envelope_type: envelopeType, tenant_id: tenantId, participant_id: 'p-1' }],
    agreement_recipients: [{ id: 'r-1', envelope_row: 'agr-1', status: 'sent', token_version: 1 }],
  })
  const ctx = {
    recipient: { id: 'r-1', token_version: 1 },
    envelope: { id: 'agr-1', envelope_type: envelopeType, tenant_id: tenantId, participant_id: 'p-1' },
  } as never
  return { fake, ctx }
}

beforeEach(() => vi.clearAllMocks())

describe('declineAgreement and tenant guardian consent', () => {
  it('a declined tenant guardian consent is settled, after the agreement is marked declined', async () => {
    const { fake, ctx } = setup('tenant_guardian_consent', CANARY)
    await declineAgreement(fake.client, ctx, 'No thanks', { ip: null, userAgent: null })
    expect(settleDeclined).toHaveBeenCalledTimes(1)
    expect(settleDeclined.mock.calls[0][1]).toMatchObject({ id: 'agr-1', participant_id: 'p-1', tenant_id: CANARY })
  })

  it('a declined Stellr minor agreement settles nothing', async () => {
    const { fake, ctx } = setup('minor', null)
    await declineAgreement(fake.client, ctx, 'No thanks', { ip: null, userAgent: null })
    expect(settleDeclined).not.toHaveBeenCalled()
  })

  it('a decline that did not win (already finished) settles nothing', async () => {
    const { fake, ctx } = setup('tenant_guardian_consent', CANARY)
    await (fake.client as unknown as SupabaseClient).from('agreement_recipients').update({ status: 'completed' }).eq('id', 'r-1')
    await declineAgreement(fake.client, ctx, '', { ip: null, userAgent: null })
    expect(settleDeclined).not.toHaveBeenCalled()
  })
})
