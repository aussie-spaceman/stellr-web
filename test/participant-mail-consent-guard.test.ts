// @vitest-environment node
//
// No participant-mail path sends to another tenant's minor whose guardian has not
// signed that tenant's consent form (S5 A16; wave 7, A10a). Each path below runs once
// with the student's consent pending, where nothing may be sent, and once with it
// signed, so a guard that sent nothing to anyone could not pass. Stellr's students make
// no consent read at all.
//
// A10a's paths: the credential email, and the team-profile invitation (the automatic
// send, the roster's resend and "send to everyone who hasn't answered"). A10b adds the
// survey invitations and the volunteer mail here.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID as STELLR } from '@/lib/tenancy/constants'
import { fakeChainDb, type ChainCall, type Row } from '@/test/helpers/fake-chain-db'

const CANARY = 'c0000000-0000-4000-8000-0000000000aa'
const PENDING = 'p-pending'
const SIGNED = 'p-signed'

const h = vi.hoisted(() => ({
  sendEmail: vi.fn(async (_m: unknown) => ({ id: 'email_1' })),
  // The tenant's participants whose consent is not signed: only PENDING.
  unconsented: vi.fn(async (_db: unknown, _tenantId: string) => new Set<string>(['p-pending'])),
}))

vi.mock('@/lib/env', async (orig) => ({ ...(await orig<Record<string, unknown>>()), SITE_URL: 'https://www.example.test' }))
vi.mock('@/lib/email', () => ({
  sendEmail: h.sendEmail,
  credentialIssuedEmail: () => ({ subject: 'Your credential', html: '<p>credential</p>' }),
  credentialsMadePrivateEmail: () => ({ subject: 'Private', html: '<p>private</p>' }),
}))
vi.mock('@/lib/docusign-agreements', () => ({ agreementValid: () => false }))
vi.mock('@/lib/credentials-link', () => ({ familyCredentialUrl: () => 'https://www.example.test/credentials/x' }))
vi.mock('@/lib/registration/tenant-guardian-consent', () => ({ unconsentedParticipantIds: h.unconsented }))
const event = (slug: string) => ({ slug, title: slug, date: '2099-05-01', endDate: null, lastDay: '2099-05-01', timeZone: 'UTC', state: null, cancelled: false, isCampaign: false })
vi.mock('@/lib/survey/events', () => ({
  loadAllSurveyEvents: async () => [event('the-event')],
  loadSurveyEvent: async (slug: string) => event(slug),
}))
vi.mock('@/lib/event-emails/send', () => ({ loadEventForEmail: async (slug: string) => ({ slug }) }))
vi.mock('@/lib/event-emails/render', () => ({
  EVENT_EMAIL_FROM: 'from@example.test',
  EVENT_EMAIL_REPLY_TO: 'reply@example.test',
  eventMergeVars: () => ({}),
  recipientMergeVars: () => ({}),
  renderEventEmail: () => ({ subject: 's', html: 'h', text: 't' }),
}))

const { sendCredentialIssuedEmail, holderConsentPending } = await import('@/lib/credentials-notify')
const { dispatchTeamProfiles, resendTeamProfile, resendOutstanding, HELD_FOR_CONSENT } = await import('@/lib/team-profile/store')

const consentReads = () => h.unconsented.mock.calls.length
const sentTo = () => h.sendEmail.mock.calls.map((c) => (c[0] as { to: string }).to)

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubEnv('SURVEY_TOKEN_SECRET', 'test-only-token-secret-not-used-anywhere-else')
  h.sendEmail.mockClear()
  h.unconsented.mockClear()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

// ── The credential email ──────────────────────────────────────────────────────

function credential(participantId: string | null, over: Row = {}) {
  return {
    id: `cred-${participantId ?? 'member'}`, number: 'STL-2026-AAAAAAAA', source: 'event', member_id: participantId ? null : 'm-1',
    participant_id: participantId, module_id: null, event_slug: 'the-event', recipient_name: 'Sam Example', title: 'The Event — Participant',
    description: null, criteria: null, skills: [], issuer: 'Stellr Education', role_label: null, award: null, award_type: 'participation',
    theme: 'space', badge_path: null, pd_hours: null, standards: [], activity_title: null, activity_date: null, activity_location: null,
    issued_at: '2026-11-01T00:00:00Z', expires_at: null, status: 'issued', revoked_at: null, revoked_reason: null, tombstoned_at: null,
    visibility: 'private', is_minor: true,
    ...over,
  } as Parameters<typeof sendCredentialIssuedEmail>[1]
}

/** The credential's tenant, as the credentials table holds it; everything else reads as empty. */
function credentialDb(tenantId: string | null, opts: { failTenantRead?: boolean } = {}) {
  return fakeChainDb((call: ChainCall) => {
    if (call.table === 'credentials' && call.columns === 'tenant_id') {
      return opts.failTenantRead ? { data: null, error: { message: 'down' } } : { data: { tenant_id: tenantId }, error: null }
    }
    return { data: null, error: null }
  })
}

const to = { firstName: 'Sam', email: 'sam@example.test', guardianFirstName: 'Pat', guardianEmail: 'pat@example.test' }

describe('the credential email', () => {
  it("is not sent for another tenant's participant whose guardian has not signed", async () => {
    const { db } = credentialDb(CANARY)
    expect(await sendCredentialIssuedEmail(db, credential(PENDING), to)).toBe(false)
    expect(h.sendEmail).not.toHaveBeenCalled()
    expect(h.unconsented).toHaveBeenCalledWith(db, CANARY)
  })

  it("is sent for that tenant's participant once their guardian has signed", async () => {
    const { db } = credentialDb(CANARY)
    expect(await sendCredentialIssuedEmail(db, credential(SIGNED), to)).toBe(true)
    expect(h.sendEmail).toHaveBeenCalledTimes(1)
  })

  it('sends nothing when the tenant cannot be read', async () => {
    const { db } = credentialDb(CANARY, { failTenantRead: true })
    expect(await sendCredentialIssuedEmail(db, credential(PENDING), to)).toBe(false)
    expect(h.sendEmail).not.toHaveBeenCalled()
    await expect(holderConsentPending(db, credential(PENDING))).rejects.toThrow('Reading the credential tenant failed: down')
  })

  it("makes no consent read for Stellr's credentials, a NULL tenant included, and sends as before", async () => {
    for (const tenant of [STELLR, null]) {
      const { db, calls } = credentialDb(tenant)
      expect(await sendCredentialIssuedEmail(db, credential(PENDING), to)).toBe(true)
      expect(calls.some((c) => c.table === 'tenant_guardian_consents')).toBe(false)
    }
    expect(consentReads()).toBe(0)
    expect(h.sendEmail).toHaveBeenCalledTimes(2)
  })

  it("reads nothing more for a member's credential (a course, a mentor, PD hours)", async () => {
    const { db, calls } = credentialDb(CANARY)
    expect(await holderConsentPending(db, credential(null))).toBe(false)
    expect(calls).toEqual([])
    expect(consentReads()).toBe(0)
  })
})

// ── Team-profile invitations ──────────────────────────────────────────────────

function student(id: string, tenantId: string | null): Row {
  return {
    id,
    member_id: null,
    first_name: id,
    last_name: 'Example',
    email: `${id}@example.test`,
    date_of_birth: '2000-01-01', // no agreement to sign: forms complete
    event_role: 'participant',
    emergency_contact_email: null,
    emergency_contact_first_name: null,
    registrations: { event_slug: 'the-event', status: 'confirmed', tenant_id: tenantId },
  }
}

/** Students with no team profile yet. A row comes back with the tenant the trigger stamps. */
function profileDb(people: Row[], opts: { existingFor?: string[] } = {}) {
  const tenantOf = new Map(people.map((p) => [p.id as string, (p.registrations as Row).tenant_id as string | null]))
  return fakeChainDb((call: ChainCall) => {
    if (call.table === 'participants') return { data: people, error: null }
    if (call.table === 'team_profiles' && call.op === 'insert') {
      const payload = call.payload as Row
      return { data: { id: payload.id, token_version: 1, prefilled_from: null, submitted_at: null, tenant_id: tenantOf.get(payload.participant_id as string) ?? null }, error: null }
    }
    if (call.table === 'team_profiles' && call.op === 'select' && call.single) {
      const pid = call.filters.find((f) => f.method === 'eq' && f.args[0] === 'participant_id')?.args[1] as string | undefined
      if (pid && opts.existingFor?.includes(pid)) {
        return { data: { id: `tp-${pid}`, token_version: 1, prefilled_from: null, submitted_at: null, tenant_id: tenantOf.get(pid) ?? null }, error: null }
      }
      return { data: null, error: null }
    }
    if (call.table === 'team_profiles' && call.op === 'select') return { data: [], error: null }
    if (call.table === 'agreements') return { data: [], error: null }
    return { data: null, error: null }
  })
}

const heldUpdates = (calls: ChainCall[]) =>
  calls.filter((c) => c.table === 'team_profiles' && c.op === 'update' && (c.payload as Row).last_send_error === HELD_FOR_CONSENT)

describe('team-profile invitations', () => {
  it("the automatic send holds a pending student's invitation, and sends the signed one's", async () => {
    const { db, calls } = profileDb([student(PENDING, CANARY), student(SIGNED, CANARY)])
    const result = await dispatchTeamProfiles(db, { participantIds: [PENDING, SIGNED] })
    expect(sentTo()).toEqual([`${SIGNED}@example.test`])
    expect(result).toMatchObject({ sent: 1, waiting: 1 })
    // Held: the row exists, so no later sweep sends it; only a staff resend can.
    expect(calls.some((c) => c.table === 'team_profiles' && c.op === 'insert' && (c.payload as Row).participant_id === PENDING)).toBe(true)
    expect(heldUpdates(calls)).toHaveLength(1)
    // One read of the tenant's unsigned consents for the whole run.
    expect(consentReads()).toBe(1)
  })

  it('the roster resend refuses while the consent is unsigned, and sends once it is signed', async () => {
    const pending = profileDb([student(PENDING, CANARY)], { existingFor: [PENDING] })
    const refused = await resendTeamProfile(pending.db, 'the-event', PENDING)
    expect(refused).toMatchObject({ ok: false, status: 409 })
    expect(h.sendEmail).not.toHaveBeenCalled()

    const signed = profileDb([student(SIGNED, CANARY)], { existingFor: [SIGNED] })
    expect(await resendTeamProfile(signed.db, 'the-event', SIGNED)).toEqual({ ok: true, email: `${SIGNED}@example.test` })
    expect(sentTo()).toEqual([`${SIGNED}@example.test`])
  })

  it('"send to everyone who hasn\'t answered" leaves the pending student waiting', async () => {
    const { db } = profileDb([student(PENDING, CANARY), student(SIGNED, CANARY)])
    const result = await resendOutstanding(db, 'the-event')
    expect(sentTo()).toEqual([`${SIGNED}@example.test`])
    expect(result).toMatchObject({ sent: 1, waiting: 1 })
  })

  it("makes no consent read for Stellr's students, a NULL tenant included, and sends to every one", async () => {
    const people = [student('s-1', STELLR), student('s-2', null)]
    const auto = profileDb(people)
    await dispatchTeamProfiles(auto.db, { participantIds: ['s-1', 's-2'] })
    const roster = profileDb(people, { existingFor: ['s-1'] })
    await resendTeamProfile(roster.db, 'the-event', 's-1')
    const outstanding = profileDb(people)
    await resendOutstanding(outstanding.db, 'the-event')
    expect(consentReads()).toBe(0)
    for (const { calls } of [auto, roster, outstanding]) {
      expect(calls.some((c) => c.table === 'tenant_guardian_consents')).toBe(false)
      expect(heldUpdates(calls)).toEqual([])
    }
    expect(sentTo()).toHaveLength(5)
  })
})
