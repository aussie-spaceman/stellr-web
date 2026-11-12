// @vitest-environment node
//
// No participant-mail path sends to another tenant's minor whose guardian has not
// signed that tenant's consent form (S5 A16; wave 7, A10a). In this slice that holds
// because neither path sends anything for another tenant yet: the credential email
// goes for Stellr's credentials only (decisions W7-9 and W7-10: Stellr is not another
// tenant's issuer, and every link in it is Stellr's page), and a team-profile
// invitation is held for any non-Stellr row (its link is Stellr's host, where another
// tenant's link cannot be saved). Each path runs for a tenant's consent-pending
// student, where nothing may be sent, and for Stellr's students, who are sent to as
// before, so a guard that sent nothing to anyone could not pass. Neither path reads
// guardian consent at all, Stellr's included.
//
// A10a's paths: the credential email, and the team-profile invitation (the automatic
// send, the roster's resend and "send to everyone who hasn't answered"). A10b's: the
// survey invitation and its reminders. Another tenant's survey leaves a consent-pending
// student, and their guardian, out of the plan, and re-checks when it sends, so an
// invitation made before is never sent (decision W7-13); Stellr's surveys read no
// guardian consent and plan and send exactly as before. (Volunteer interest sends no
// mail, and is refused for another tenant's event: app/api/volunteer/interest.)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID as STELLR } from '@/lib/tenancy/constants'
import { fakeChainDb, type Answer, type ChainCall, type Row } from '@/test/helpers/fake-chain-db'

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
// Every minor here holds a current agreement that covers surveys, so the only thing that
// can leave one out is the tenant's guardian consent.
vi.mock('@/lib/survey/consent', async (orig) => {
  const real = await orig<typeof import('@/lib/survey/consent')>()
  return {
    ...real,
    loadMinorConsents: async (_db: unknown, subjects: { key: string }[]) =>
      new Map(subjects.map((s) => [s.key, { ...real.NO_CONSENT, agreementId: 'agr-1', agreementVersion: 'V2.3', coversSurveys: true }])),
  }
})
vi.mock('@/lib/event-emails/render', () => ({
  EVENT_EMAIL_FROM: 'from@example.test',
  EVENT_EMAIL_REPLY_TO: 'reply@example.test',
  eventMergeVars: () => ({}),
  recipientMergeVars: () => ({}),
  renderEventEmail: () => ({ subject: 's', html: 'h', text: 't' }),
}))

const { sendCredentialIssuedEmail, credentialIsStellrs } = await import('@/lib/credentials-notify')
const { dispatchTeamProfiles, resendTeamProfile, resendOutstanding, HELD_FOR_TENANT } = await import('@/lib/team-profile/store')
const { planFor } = await import('@/lib/survey/distributions')
const { sendQueued, sendReminders, emptyTally } = await import('@/lib/survey/send')

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

/** A credential row. `tenant` is the row's tenant_id as the select carried it; leave it out for a select that did not. */
function credential(participantId: string | null, tenant?: string | null) {
  return {
    id: `cred-${participantId ?? 'member'}`, number: 'STL-2026-AAAAAAAA', source: 'event', member_id: participantId ? null : 'm-1',
    participant_id: participantId, module_id: null, event_slug: 'the-event', recipient_name: 'Sam Example', title: 'The Event — Participant',
    description: null, criteria: null, skills: [], issuer: 'Stellr Education', role_label: null, award: null, award_type: 'participation',
    theme: 'space', badge_path: null, pd_hours: null, standards: [], activity_title: null, activity_date: null, activity_location: null,
    issued_at: '2026-11-01T00:00:00Z', expires_at: null, status: 'issued', revoked_at: null, revoked_reason: null, tombstoned_at: null,
    visibility: 'private', is_minor: true,
    ...(tenant === undefined ? {} : { tenant_id: tenant }),
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

const tenantReads = (calls: ChainCall[]) => calls.filter((c) => c.table === 'credentials' && c.columns === 'tenant_id')
const consentTableReads = (calls: ChainCall[]) => calls.filter((c) => c.table === 'tenant_guardian_consents')

const to = { firstName: 'Sam', email: 'sam@example.test', guardianFirstName: 'Pat', guardianEmail: 'pat@example.test' }

describe('the credential email', () => {
  it("is not sent for another tenant's participant whose guardian has not signed, and reads nothing to decide", async () => {
    const { db, calls } = credentialDb(CANARY)
    expect(await sendCredentialIssuedEmail(db, credential(PENDING, CANARY), to)).toBe(false)
    expect(h.sendEmail).not.toHaveBeenCalled()
    expect(calls).toEqual([])
    expect(consentReads()).toBe(0)
  })

  it("is not sent for any of another tenant's credentials: a signed participant's, or a member's", async () => {
    const { db } = credentialDb(CANARY)
    expect(await sendCredentialIssuedEmail(db, credential(SIGNED, CANARY), to)).toBe(false)
    expect(await sendCredentialIssuedEmail(db, credential(null, CANARY), to)).toBe(false)
    expect(h.sendEmail).not.toHaveBeenCalled()
    expect(consentReads()).toBe(0)
  })

  it('reads the tenant once for a row that came without it, and sends nothing for another tenant', async () => {
    const { db, calls } = credentialDb(CANARY)
    expect(await sendCredentialIssuedEmail(db, credential(PENDING), to)).toBe(false)
    expect(tenantReads(calls)).toHaveLength(1)
    expect(h.sendEmail).not.toHaveBeenCalled()
  })

  it('sends nothing when the tenant cannot be read', async () => {
    const { db } = credentialDb(CANARY, { failTenantRead: true })
    expect(await sendCredentialIssuedEmail(db, credential(PENDING), to)).toBe(false)
    expect(h.sendEmail).not.toHaveBeenCalled()
    await expect(credentialIsStellrs(db, credential(PENDING))).rejects.toThrow('Reading the credential tenant failed: down')
  })

  it("sends Stellr's credentials as before, a NULL tenant included, with no tenant or consent read", async () => {
    for (const tenant of [STELLR, null]) {
      for (const holder of [PENDING, null]) {
        const { db, calls } = credentialDb(tenant)
        expect(await sendCredentialIssuedEmail(db, credential(holder, tenant), to)).toBe(true)
        expect(tenantReads(calls)).toEqual([])
        expect(consentTableReads(calls)).toEqual([])
      }
    }
    expect(consentReads()).toBe(0)
    expect(h.sendEmail).toHaveBeenCalledTimes(4)
  })

  it('a row that came without its tenant is not taken for Stellr: undefined is not NULL', async () => {
    const { db } = credentialDb(STELLR)
    expect(await credentialIsStellrs(db, credential(PENDING))).toBe(true)
    const nobody = credentialDb(CANARY)
    expect(await credentialIsStellrs(nobody.db, credential(PENDING))).toBe(false)
    expect(tenantReads(nobody.calls)).toHaveLength(1)
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
  const answer: Answer = (call) => {
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
  }
  return { ...fakeChainDb(answer), answer }
}

const heldUpdates = (calls: ChainCall[]) =>
  calls.filter((c) => c.table === 'team_profiles' && c.op === 'update' && (c.payload as Row).last_send_error === HELD_FOR_TENANT)
const inserted = (calls: ChainCall[], pid: string) =>
  calls.some((c) => c.table === 'team_profiles' && c.op === 'insert' && (c.payload as Row).participant_id === pid)
/** Every table a run touched: the decision to hold reads nothing beyond the row it made. */
const tables = (calls: ChainCall[]) => [...new Set(calls.map((c) => c.table))].sort()

describe('team-profile invitations', () => {
  it("the automatic send holds another tenant's students, the consent-pending one included, and reads no consent", async () => {
    const { db, calls } = profileDb([student(PENDING, CANARY), student(SIGNED, CANARY)])
    const result = await dispatchTeamProfiles(db, { participantIds: [PENDING, SIGNED] })
    expect(h.sendEmail).not.toHaveBeenCalled()
    expect(result).toMatchObject({ sent: 0, failed: 0, waiting: 2 })
    // Held: the row exists, so no later sweep sends it; only a staff resend can.
    expect(inserted(calls, PENDING)).toBe(true)
    expect(heldUpdates(calls)).toHaveLength(2)
    // The hold is decided from the row's own tenant: nothing is read that could fail
    // between making the row and holding it.
    expect(consentReads()).toBe(0)
    expect(tables(calls)).toEqual(['agreements', 'participants', 'team_profiles'])
  })

  it('the daily sweep holds them the same way', async () => {
    const { db, calls } = profileDb([student(PENDING, CANARY)])
    const result = await dispatchTeamProfiles(db, {})
    expect(h.sendEmail).not.toHaveBeenCalled()
    expect(result).toMatchObject({ sent: 0, waiting: 1 })
    expect(heldUpdates(calls)).toHaveLength(1)
    expect(consentReads()).toBe(0)
  })

  it('a hold that cannot be recorded still sends nothing', async () => {
    const base = profileDb([student(PENDING, CANARY)])
    const { db } = fakeChainDb((call) =>
      call.table === 'team_profiles' && call.op === 'update' ? { data: null, error: { message: 'down' } } : base.answer(call),
    )
    expect(await dispatchTeamProfiles(db, { participantIds: [PENDING] })).toMatchObject({ sent: 0, waiting: 1 })
    expect(h.sendEmail).not.toHaveBeenCalled()
  })

  it("the roster resend refuses another tenant's student, signed or not", async () => {
    for (const pid of [PENDING, SIGNED]) {
      const { db, calls } = profileDb([student(pid, CANARY)], { existingFor: [pid] })
      expect(await resendTeamProfile(db, 'the-event', pid)).toMatchObject({ ok: false, status: 409 })
      expect(heldUpdates(calls)).toHaveLength(1)
    }
    expect(h.sendEmail).not.toHaveBeenCalled()
    expect(consentReads()).toBe(0)
  })

  it('"send to everyone who hasn\'t answered" leaves another tenant\'s students waiting', async () => {
    const { db } = profileDb([student(PENDING, CANARY), student(SIGNED, CANARY)])
    const result = await resendOutstanding(db, 'the-event')
    expect(h.sendEmail).not.toHaveBeenCalled()
    expect(result).toMatchObject({ sent: 0, waiting: 2 })
    expect(consentReads()).toBe(0)
  })

  it("sends to Stellr's students, a NULL tenant included, beside a held tenant student, with no consent read", async () => {
    const people = [student('s-1', STELLR), student('s-2', null)]
    const auto = profileDb([...people, student(PENDING, CANARY)])
    expect(await dispatchTeamProfiles(auto.db, { participantIds: ['s-1', 's-2', PENDING] })).toMatchObject({ sent: 2, waiting: 1 })
    const roster = profileDb(people, { existingFor: ['s-1'] })
    await resendTeamProfile(roster.db, 'the-event', 's-1')
    const outstanding = profileDb(people)
    await resendOutstanding(outstanding.db, 'the-event')
    expect(consentReads()).toBe(0)
    for (const { calls } of [auto, roster, outstanding]) expect(calls.some((c) => c.table === 'tenant_guardian_consents')).toBe(false)
    expect(heldUpdates(auto.calls)).toHaveLength(1)
    expect(heldUpdates(roster.calls)).toEqual([])
    expect(heldUpdates(outstanding.calls)).toEqual([])
    expect(sentTo()).toEqual(['s-1@example.test', 's-2@example.test', 's-1@example.test', 's-1@example.test', 's-2@example.test'])
  })
})

// ── Survey invitations and reminders ──────────────────────────────────────────

const GUARDIAN = 'guardian@example.test'

/** A participant on the event's one registration. Minors are born in 2012; the event is in 2099. */
function participant(id: string, opts: { role?: string; dob?: string; email?: string; member?: string | null; guardian?: string | null } = {}): Row {
  return {
    id,
    registration_id: 'reg-1',
    first_name: id,
    last_name: 'Example',
    email: opts.email ?? `${id}@example.test`,
    date_of_birth: opts.dob ?? '2087-01-01',
    grade: null,
    age_bracket: null,
    event_role: opts.role ?? 'participant',
    member_id: opts.member ?? null,
    emergency_contact_email: opts.guardian === undefined ? GUARDIAN : opts.guardian,
    emergency_contact_first_name: 'Pat',
  }
}

/**
 * The event's people: a consent-pending student (also known as a member, through an
 * event participation), a signed student, an adult student, the pending student's
 * guardian registered as a parent, and the teacher.
 */
const PEOPLE = [
  participant(PENDING, { member: 'm-pending' }),
  participant(SIGNED, { guardian: 'other-guardian@example.test' }),
  participant('p-adult', { dob: '2000-01-01', guardian: null }),
  participant('p-parent', { role: 'parent', dob: '1980-01-01', email: GUARDIAN, guardian: null }),
]

function distribution(tenant: string | null): Row {
  return {
    id: 'dist-1', definition_id: 'def-1', event_slug: 'the-event', event_title: 'The Event', event_date: '2099-05-01',
    event_time_zone: 'UTC', audiences: ['student', 'mentor', 'adult'], status: 'open', opens_at: '2099-05-01T00:00:00Z',
    closes_at: '2099-05-30T00:00:00Z', opens_at_source: 'auto', schedule_flag: null, minor_agreement_override: false, tenant_id: tenant,
  }
}

function invitation(id: string, participantId: string | null, email: string, sendVia: 'self' | 'guardian', status = 'queued'): Row {
  return {
    id, distribution_id: 'dist-1', recipient_key: `participant:${participantId ?? id}`, participant_id: participantId, member_id: null,
    respondent_role: 'student', adult_relationship: null, first_name: participantId, is_minor: true, email, send_via: sendVia,
    token_version: 1, status, sent_at: status === 'queued' ? null : '2099-05-02T00:00:00Z', send_attempts: 0, last_send_error: null,
    first_opened_at: null, last_activity_at: null, opened_from: null, reminder_count: 0, resume_reminder_count: 0, last_reminder_at: null,
    reminders_opted_out_at: null, created_at: '2099-05-01T00:00:00Z', survey_responses: null,
  }
}

/** The pending student's invitation to themselves and to their guardian, and the signed student's. */
const INVITATIONS = (status = 'queued') => [
  invitation('inv-pending', PENDING, `${PENDING}@example.test`, 'self', status),
  invitation('inv-pending-guardian', PENDING, GUARDIAN, 'guardian', status),
  invitation('inv-signed', SIGNED, `${SIGNED}@example.test`, 'self', status),
]

function surveyDb(invitations: Row[] = []) {
  return fakeChainDb(
    (call: ChainCall) => {
      if (call.table === 'registrations') {
        return { data: [{ id: 'reg-1', status: 'confirmed', teacher_first_name: 'Tess', teacher_last_name: 'Teacher', teacher_email: 'tess@example.test', teacher_member_id: null, teacher_poc_first_name: null, teacher_poc_last_name: null, teacher_poc_email: null, school_address_state: 'CO', adult_count: 1 }], error: null }
      }
      if (call.table === 'participants') return { data: PEOPLE, error: null }
      if (call.table === 'event_participations') return { data: [{ member_id: 'm-pending', role: 'participant' }], error: null }
      if (call.table === 'members') return { data: [{ id: 'm-pending', first_name: PENDING, last_name: 'Example', email: `${PENDING}@example.test`, date_of_birth: '2087-01-01', grade: null, age_bracket: null, event_role: 'participant', ec_email: GUARDIAN, ec_first_name: 'Pat' }], error: null }
      if (call.table === 'survey_invitations' && call.op === 'select') return { data: invitations, error: null }
      if (call.table === 'survey_invitations' && call.op === 'update') return { data: [{ id: 'claimed' }], error: null }
      return { data: [], error: null }
    },
    (fn) => (fn === 'survey_claim_email' ? { data: true, error: null } : { data: null, error: null }),
  )
}

const DEF = { targetMinutes: { student: 5, mentor: 5, adult: 5 } } as unknown as Parameters<typeof sendQueued>[2]
const asDistribution = (d: Row) => d as unknown as Parameters<typeof sendQueued>[1]
const expired = (calls: ChainCall[]) =>
  calls.filter((c) => c.table === 'survey_invitations' && c.op === 'update' && (c.payload as Row).status === 'expired').map((c) => c.filters.find((f) => f.args[0] === 'id')?.args[1])
const NOW = new Date('2099-05-10T12:00:00Z')

describe('survey invitations', () => {
  it("another tenant's plan leaves out the consent-pending student, through every source, and their guardian", async () => {
    const { db, calls } = surveyDb()
    const plan = await planFor(db, asDistribution(distribution(CANARY)) as never)
    const invited = plan.invitable.map((p) => p.email).sort()
    expect(invited).toEqual(['p-adult@example.test', 'p-signed@example.test', 'tess@example.test'])
    expect(plan.invitable.some((p) => p.participantId === PENDING || p.memberId === 'm-pending')).toBe(false)
    expect(invited).not.toContain(GUARDIAN)
    expect(h.unconsented.mock.calls.map((c) => c[1])).toEqual([CANARY])
    expect(consentTableReads(calls)).toEqual([]) // the read goes through unconsentedParticipantIds only
  })

  it("Stellr's plan, a NULL tenant included, reads no guardian consent and invites exactly as before", async () => {
    const plans = []
    for (const tenant of [STELLR, null]) {
      const { db, calls } = surveyDb()
      plans.push(await planFor(db, asDistribution(distribution(tenant)) as never))
      expect(consentTableReads(calls)).toEqual([])
      expect(tables(calls)).toEqual(['event_participations', 'member_schools', 'members', 'participants', 'registrations'])
    }
    expect(consentReads()).toBe(0)
    expect(plans[0]).toEqual(plans[1])
    expect(plans[0].invitable.map((p) => [p.recipientKey, p.email, p.sendVia, p.role, p.sources])).toEqual([
      ['email:p-adult@example.test', 'p-adult@example.test', 'self', 'student', ['participant']],
      ['email:guardian@example.test', GUARDIAN, 'self', 'adult', ['participant']],
      ['member:m-pending', 'p-pending@example.test', 'self', 'student', ['participant', 'attendee']],
      ['email:p-signed@example.test', 'p-signed@example.test', 'self', 'student', ['participant']],
      ['email:tess@example.test', 'tess@example.test', 'self', 'adult', ['teacher']],
    ])
  })

  it('a distribution read without its tenant plans nothing', async () => {
    const { db } = surveyDb()
    const { tenant_id: _dropped, ...withoutTenant } = distribution(STELLR)
    expect(() => planFor(db, asDistribution(withoutTenant) as never)).toThrow('read without its tenant_id')
  })

  it("another tenant's queued invitations: the pending student's, and their guardian's, are never sent", async () => {
    const { db, calls } = surveyDb(INVITATIONS())
    const tally = emptyTally()
    const still = new Set(INVITATIONS().map((i) => i.recipient_key as string))
    await sendQueued(db, asDistribution(distribution(CANARY)), DEF, still, tally, Date.now() + 60_000, NOW)
    expect(sentTo()).toEqual(['p-signed@example.test'])
    expect(expired(calls).sort()).toEqual(['inv-pending', 'inv-pending-guardian'])
    expect(tally.invited).toBe(1)
    expect(consentReads()).toBe(1)
  })

  it("another tenant's reminders skip them too", async () => {
    const { db } = surveyDb(INVITATIONS('sent'))
    const still = new Set(INVITATIONS().map((i) => i.recipient_key as string))
    const tally = emptyTally()
    await sendReminders(db, asDistribution(distribution(CANARY)), DEF, still, tally, Date.now() + 60_000, NOW)
    expect(sentTo()).toEqual(['p-signed@example.test'])
    expect(tally.reminded).toBe(1)
  })

  it('nothing is sent when the consent cannot be read', async () => {
    h.unconsented.mockRejectedValueOnce(new Error('Reading guardian consents failed: down'))
    const { db } = surveyDb(INVITATIONS())
    const still = new Set(INVITATIONS().map((i) => i.recipient_key as string))
    await expect(sendQueued(db, asDistribution(distribution(CANARY)), DEF, still, emptyTally(), Date.now() + 60_000, NOW)).rejects.toThrow('down')
    expect(h.sendEmail).not.toHaveBeenCalled()
  })

  it("Stellr's invitations and reminders, a NULL tenant included, send to everyone as before, with no consent read", async () => {
    const still = new Set(INVITATIONS().map((i) => i.recipient_key as string))
    for (const tenant of [STELLR, null]) {
      const queued = surveyDb(INVITATIONS())
      await sendQueued(queued.db, asDistribution(distribution(tenant)), DEF, still, emptyTally(), Date.now() + 60_000, NOW)
      expect(expired(queued.calls)).toEqual([])
      const reminders = surveyDb(INVITATIONS('sent'))
      await sendReminders(reminders.db, asDistribution(distribution(tenant)), DEF, still, emptyTally(), Date.now() + 60_000, NOW)
      for (const { calls } of [queued, reminders]) expect(tables(calls)).toEqual(['survey_invitations'])
    }
    expect(consentReads()).toBe(0)
    const once = ['p-pending@example.test', GUARDIAN, 'p-signed@example.test']
    expect(sentTo()).toEqual([...once, ...once, ...once, ...once])
  })
})
