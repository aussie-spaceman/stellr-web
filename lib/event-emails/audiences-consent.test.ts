// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRecorder } from '@/test/registration/fixtures'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

// S5 wave 6: a tenant's event email leaves out its participants whose guardian has
// not signed the consent form, with their guardians and their consent-signing
// lines. Stellr's sends are resolved exactly as before, with no extra read.

const CANARY = 'c0000000-0000-4000-8000-0000000000aa'

const h = vi.hoisted(() => ({
  roster: vi.fn(async (_slug: string, _date?: string) => ({}) as unknown),
  unconsented: vi.fn(async (_db: unknown, _tenantId: string) => new Set<string>(['p-pending'])),
}))
vi.mock('@/lib/event-admin', () => ({ getEventRoster: h.roster }))
vi.mock('@/lib/registration/tenant-guardian-consent', () => ({ unconsentedParticipantIds: h.unconsented }))

const { resolveAudience } = await import('./audiences')

const person = (id: string, first: string, email: string, guardian: string) => ({
  id, first_name: first, last_name: 'Id', email, minor: true,
  emergency_contact_email: guardian, emergency_contact_first_name: 'Pat', emergency_contact_last_name: 'Id',
  docusign: 'outstanding', event_role: 'participant', team_profile_submitted: true, paid: true,
})
const ROSTER = {
  groups: [
    { registrationId: 'reg-1', type: 'individual', memberPaysIndividually: false, invoiceRequested: false, payLinkSendable: false,
      participants: [person('p-ok', 'Ana', 'ana@example.com', 'ana.parent@example.com')] },
    { registrationId: 'reg-2', type: 'individual', memberPaysIndividually: false, invoiceRequested: false, payLinkSendable: false,
      participants: [person('p-pending', 'Kit', 'kit@example.com', 'kit.parent@example.com')] },
  ],
}

const rec = createRecorder()
beforeEach(() => {
  vi.clearAllMocks()
  rec.reset()
  h.roster.mockResolvedValue(ROSTER)
  rec.respond((c) => {
    if (c.table === 'agreements') {
      return { data: [{ id: 'agr-k', provider: 'native', participant_id: 'p-pending', signer_email: 'kit.parent@example.com' }], error: null }
    }
    if (c.table === 'agreement_recipients') {
      return { data: [{ id: 'r-k', envelope_row: 'agr-k', email: 'kit.parent@example.com', role_name: 'Guardian', status: 'sent', token_version: 1, token_expires_at: null }], error: null }
    }
    return undefined
  })
})

const emails = (r: { recipients: { email: string }[] }) => r.recipients.map((x) => x.email).sort()

describe('resolveAudience and tenant guardian consent', () => {
  it('a tenant’s email leaves out the consent-pending participant and their guardian', async () => {
    const r = await resolveAudience(rec.client(), { slug: 'canary-cup' }, ['participants', 'guardians', 'docusign_outstanding'], { tenantId: CANARY })
    expect(h.unconsented).toHaveBeenCalledWith(expect.anything(), CANARY)
    expect(emails(r)).toEqual(['ana.parent@example.com', 'ana@example.com'])
    expect(r.docusignParticipantIds).toEqual(['p-ok'])
    expect(r.nativeParticipantIds).toEqual([])
  })

  it('Stellr’s email is unchanged and reads nothing more', async () => {
    const r = await resolveAudience(rec.client(), { slug: 'colorado' }, ['participants', 'guardians'])
    expect(h.unconsented).not.toHaveBeenCalled()
    expect(emails(r)).toEqual(['ana.parent@example.com', 'ana@example.com', 'kit.parent@example.com', 'kit@example.com'])
    const again = await resolveAudience(rec.client(), { slug: 'colorado' }, ['participants'], { tenantId: STELLR_TENANT_ID })
    expect(h.unconsented).not.toHaveBeenCalled()
    expect(emails(again)).toEqual(['ana@example.com', 'kit@example.com'])
  })

  it('All attendees (#605) leaves out a consent-pending participant even with a check-in on the row', async () => {
    // A check-in can predate the consent row: a date-of-birth correction opens one later.
    const checkedIn = {
      groups: ROSTER.groups.map((g) => ({ ...g, participants: g.participants.map((p) => ({ ...p, checked_in_at: '2040-06-01T15:00:00.000Z' })) })),
    }
    h.roster.mockResolvedValue(checkedIn)
    const tenant = await resolveAudience(rec.client(), { slug: 'canary-cup' }, ['attendees'], { tenantId: CANARY })
    expect(emails(tenant)).toEqual(['ana@example.com'])
    // Stellr's All attendees send reaches everyone checked in, as on dev.
    h.roster.mockResolvedValue(checkedIn)
    const stellr = await resolveAudience(rec.client(), { slug: 'colorado' }, ['attendees'])
    expect(emails(stellr)).toEqual(['ana@example.com', 'kit@example.com'])
  })

  it('a failed consent read fails the send rather than reaching a pending participant', async () => {
    h.unconsented.mockRejectedValueOnce(new Error('down'))
    await expect(resolveAudience(rec.client(), { slug: 'canary-cup' }, ['participants'], { tenantId: CANARY })).rejects.toThrow('down')
  })
})
