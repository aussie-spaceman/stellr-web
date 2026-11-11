// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'

const { sendEmail, logActivity, recordOptOut, archiveEnvelope } = vi.hoisted(() => ({
  sendEmail: vi.fn(async (_o: unknown) => {}),
  logActivity: vi.fn(async (_e: unknown, _db: unknown) => {}),
  recordOptOut: vi.fn(async () => 'no_opt_out'),
  archiveEnvelope: vi.fn(async () => ({ kind: 'archived' })),
}))

vi.mock('@/lib/email', () => ({
  sendEmail,
  docusignCompletedToMinorEmail: () => ({ subject: 'minor-done', html: '', text: '' }),
  docusignCompletedToSignerEmail: () => ({ subject: 'signer-done', html: '', text: '' }),
}))
vi.mock('@/lib/activity-log', () => ({ logActivity }))
vi.mock('@/lib/docusign-optout', () => ({ recordCredentialOptOutFromForm: recordOptOut }))
vi.mock('@/lib/esign/archive', () => ({ archiveEnvelope }))
vi.mock('@/lib/docusign-agreements', () => ({
  AGREEMENT_LABEL: { minor: 'Parental Consent Form', adult: 'Participation Agreement' },
}))
const { settleSigned, dispatchTeamProfiles } = vi.hoisted(() => ({
  settleSigned: vi.fn(async (_db: unknown, _env: unknown) => true),
  dispatchTeamProfiles: vi.fn(async (_db: unknown, _o: unknown) => {}),
}))
vi.mock('@/lib/registration/tenant-guardian-consent', () => ({ settleTenantGuardianConsentSigned: settleSigned }))
vi.mock('@/lib/team-profile/store', () => ({ dispatchTeamProfiles }))

import { mayTransition, onEnvelopeCompleted, type CompletedEnvelope } from './completion'

const envelope: CompletedEnvelope = {
  id: 'row-1',
  envelope_id: 'env-1',
  provider: 'docusign',
  status: 'completed',
  envelope_type: 'minor',
  reused_from: null,
  member_id: 'm1',
  participant_id: 'p1',
  credential_sharing_opt_out: false,
  completed_at: '2026-10-02T10:00:00Z',
  archived_at: null,
  archive_attempts: 0,
  minor_name: 'Sam Lee',
  signer_name: 'Pat Lee',
  event_title: 'Colorado SDC',
}

beforeEach(() => vi.clearAllMocks())

describe('mayTransition', () => {
  it('lets an agreement move forward', () => {
    expect(mayTransition('sent', 'delivered')).toBe(true)
    expect(mayTransition('delivered', 'completed')).toBe(true)
    expect(mayTransition(null, 'sent')).toBe(true)
  })

  it('never moves a finished agreement backwards or sideways', () => {
    expect(mayTransition('completed', 'sent')).toBe(false)
    expect(mayTransition('completed', 'delivered')).toBe(false)
    expect(mayTransition('completed', 'voided')).toBe(false)
    expect(mayTransition('voided', 'completed')).toBe(false)
    expect(mayTransition('declined', 'sent')).toBe(false)
  })

  it('treats a repeat of a finished status as harmless', () => {
    expect(mayTransition('completed', 'completed')).toBe(true)
  })
})

describe('onEnvelopeCompleted', () => {
  function db() {
    return fakeSupabase({
      agreements: [{ id: 'row-1', completion_notified_at: null }],
      members: [{ id: 'm1', email: 'sam@example.test', first_name: 'Sam' }],
    })
  }

  it('reads the opt-out, archives, logs and emails the member once', async () => {
    const fake = db()
    expect(await onEnvelopeCompleted(fake.client, envelope)).toEqual({ notified: true })
    expect(recordOptOut).toHaveBeenCalledTimes(1)
    expect(archiveEnvelope).toHaveBeenCalledTimes(1)
    expect(logActivity).toHaveBeenCalledTimes(1)
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'sam@example.test', subject: 'minor-done' }))
    expect(fake.table('agreements')[0].completion_notified_at).toBeTruthy()
  })

  it('does not email or log again on a replayed completion, but still retries archive and opt-out', async () => {
    const fake = db()
    await onEnvelopeCompleted(fake.client, envelope)
    vi.clearAllMocks()

    expect(await onEnvelopeCompleted(fake.client, envelope)).toEqual({ notified: false })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(logActivity).not.toHaveBeenCalled()
    expect(recordOptOut).toHaveBeenCalledTimes(1)
    expect(archiveEnvelope).toHaveBeenCalledTimes(1)
  })

  it('never attaches the signed document to the email', async () => {
    await onEnvelopeCompleted(db().client, envelope)
    const sent = sendEmail.mock.calls[0][0] as Record<string, unknown>
    expect(sent.attachments).toBeUndefined()
  })
})

// S5 B14 follow-up: Stellr signing's completion emails for another tenant's
// envelope go from that tenant's sender, or not at all; Stellr's are unchanged.
describe('onEnvelopeCompleted, Stellr signing, by tenant', () => {
  const ROCKET = '11111111-1111-4111-8111-111111111111'
  const QUIET = '33333333-3333-4333-8333-333333333333'
  const native = (tenant: string | null): CompletedEnvelope => ({
    ...envelope, provider: 'native', member_id: null, participant_id: null, tenant_id: tenant,
  })
  function db() {
    return fakeSupabase({
      agreements: [{ id: 'row-1', completion_notified_at: null }],
      agreement_recipients: [{ id: 'r-1', envelope_row: 'row-1', name: 'Pat Lee', email: 'pat@x.test', member_id: null, token_version: 1 }],
      tenants: [
        { id: ROCKET, display_name: 'Rocket Club', branding: { reply_to: 'events@rocket.example.org' } },
        { id: QUIET, display_name: 'Quiet Org', branding: {} },
      ],
    })
  }
  const sent = () => sendEmail.mock.calls.map((c) => c[0] as Record<string, unknown>)
  beforeEach(() => {
    vi.stubEnv('ESIGN_TOKEN_SECRET', 'k'.repeat(48))
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it.each([[false], [true]])('Stellr’s envelope, flag %s: the signer is emailed from Stellr’s sender', async (on) => {
    vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', on ? 'true' : '')
    await onEnvelopeCompleted(db().client, native(null))
    expect(sent()).toHaveLength(1)
    expect(sent()[0]).not.toHaveProperty('from')
    expect(sent()[0]).not.toHaveProperty('replyTo')
  })

  it('a tenant’s envelope, flag on: from the tenant’s sender with its Reply-To', async () => {
    vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', 'true')
    await onEnvelopeCompleted(db().client, native(ROCKET))
    expect(sent()).toHaveLength(1)
    expect(sent()[0]).toMatchObject({
      to: 'pat@x.test', from: '"Rocket Club via Stellr" <no-reply@mail.stellreducation.org>', replyTo: 'events@rocket.example.org',
    })
  })

  it.each([
    ['the flag is off', '', ROCKET],
    ['the tenant has no sender', 'true', QUIET],
  ])('a tenant’s envelope when %s: no email at all, never one as Stellr', async (_what, value, tenant) => {
    vi.stubEnv('TENANT_EVENT_MAIL_ENABLED', value)
    expect(await onEnvelopeCompleted(db().client, native(tenant))).toEqual({ notified: true })
    expect(sendEmail).not.toHaveBeenCalled()
  })
})

// S5 wave 6: a guardian's consent for another organiser's event.
describe('onEnvelopeCompleted, tenant guardian consent', () => {
  const ROCKET = '11111111-1111-4111-8111-111111111111'
  const consent: CompletedEnvelope = {
    ...envelope, provider: 'native', envelope_type: 'tenant_guardian_consent', member_id: null, participant_id: 'p-tgc', tenant_id: ROCKET,
  }
  const db = () => fakeSupabase({ agreements: [{ id: 'row-1', completion_notified_at: null }], agreement_recipients: [], tenants: [] })

  it('settles the consent (the participant becomes registered) and opens no team profile', async () => {
    await onEnvelopeCompleted(db().client, consent)
    expect(settleSigned).toHaveBeenCalledTimes(1)
    expect(settleSigned.mock.calls[0][1]).toMatchObject({ id: 'row-1', participant_id: 'p-tgc', envelope_type: 'tenant_guardian_consent' })
    expect(dispatchTeamProfiles).not.toHaveBeenCalled()
  })

  it('a Stellr minor agreement settles no tenant consent and still opens the team profile', async () => {
    await onEnvelopeCompleted(db().client, { ...envelope, participant_id: 'p1' })
    expect(settleSigned).not.toHaveBeenCalled()
    expect(dispatchTeamProfiles).toHaveBeenCalledWith(expect.anything(), { participantIds: ['p1'] })
  })

  it('a failed settle does not fail the completion', async () => {
    settleSigned.mockRejectedValueOnce(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await onEnvelopeCompleted(db().client, consent)).toEqual({ notified: true })
    vi.restoreAllMocks()
  })
})
