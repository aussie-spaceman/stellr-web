// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'
import { ADULT, FIFTEEN, rosterDb, stellrGroup, tenantGroup, TENANT, THIRTEEN, type RosterDb } from './roster-db'

// S5 A8: the roster writers that start from an existing registration (the shared roster
// add behind the organiser's Teams page and the staff event roster, and the roster sheet
// import), traced for each kind of person against a database that holds Stellr's group
// and a tenant's. Everything Stellr-only these writers reach (member rows, the Member ID
// lookup, school links, event history, Stellr's agreement, payment links, billing,
// Stripe) is a spy that must stay untouched on the tenant's path.

const s = vi.hoisted(() => ({
  upsertMember: vi.fn(async () => 'member-new'),
  onFile: vi.fn(async () => null as Record<string, unknown> | null),
  linkSchool: vi.fn(async () => {}),
  recordParticipation: vi.fn(async () => {}),
  dispatchAgreement: vi.fn(async () => ({})),
  ensureIndividualPayments: vi.fn(async () => ({ charged: 0, waived: 0, skipped: 0 })),
  applyRosterChange: vi.fn(async () => ({ action: 'none', message: null, seatsAfter: 0 })),
  stripeClient: vi.fn(() => null),
  readSheet: vi.fn(async () => [] as Record<string, unknown>[]),
}))

vi.mock('@/lib/member-sync', () => ({ upsertMember: s.upsertMember }))
vi.mock('@/lib/member-onfile', () => ({ getMemberOnFileByMembershipId: s.onFile }))
vi.mock('@/lib/school-link', () => ({ linkMembersToRegistrationSchool: s.linkSchool }))
vi.mock('@/lib/event-participation-sync', () => ({ recordEventParticipationForRegistration: s.recordParticipation }))
vi.mock('@/lib/docusign-agreements', () => ({ dispatchAgreement: s.dispatchAgreement }))
vi.mock('@/lib/individual-payment', () => ({ ensureIndividualPayments: s.ensureIndividualPayments }))
vi.mock('@/lib/group-billing', () => ({ applyRosterChange: s.applyRosterChange }))
vi.mock('@/lib/stripe', () => ({ stripeClient: s.stripeClient }))
vi.mock('@/lib/field-crypto-shadow', () => ({ shadowSyncFields: () => {} }))
vi.mock('@/lib/google-sheets', () => ({ readSheetParticipants: s.readSheet }))
vi.mock('@/lib/esign/outbox', () => ({ batchInvites: (_db: unknown, fn: () => unknown) => fn() }))

const { addParticipantToGroup } = await import('@/lib/group-participant-add')
const { syncParticipantsFromSheet, SheetSyncRefused } = await import('@/lib/sheet-participant-sync')

const organiser = { memberId: 'member-org', label: 'organiser' }
const staff = { memberId: 'member-staff', label: 'admin' }
const person = (dob: string, extra: Record<string, unknown> = {}) => ({
  first_name: 'Sam', last_name: 'Lee', email: 'sam@example.com', date_of_birth: dob, event_role: 'participant', ...extra,
})
const ON_FILE = {
  memberId: 'member-9', first_name: 'Rec', last_name: 'Ord', member_last_name: 'Lee', nickname: null, email: 'rec@example.com',
  phone: '555-0100', date_of_birth: ADULT, grade: null, gender: 'Female', t_shirt_size: 'M', ethnicity: [], dietary_requirements: [],
  health_conditions: 'Asthma', event_role: 'adult',
}

let db: RosterDb
const stellrOnlySpies = () => [
  s.upsertMember, s.onFile, s.linkSchool, s.recordParticipation, s.dispatchAgreement, s.ensureIndividualPayments,
  s.applyRosterChange, s.stripeClient,
]
const participants = () => db.fake.table('participants')

beforeEach(() => {
  db = rosterDb()
  for (const f of Object.values(s)) f.mockClear()
  s.onFile.mockResolvedValue(null)
})
afterEach(() => vi.unstubAllEnvs())

describe('the shared roster add, on Stellr’s group', () => {
  it('an adult is added as before: member row, school link, agreement, billing, with Stellr’s tenant_id and no tenant read', async () => {
    const res = await addParticipantToGroup(db.client, stellrGroup, person(ADULT, { event_role: 'adult' }), organiser)
    expect(res.status).toBe(201)
    expect(participants()).toHaveLength(1)
    expect(participants()[0]).toMatchObject({ registration_id: stellrGroup.id, tenant_id: STELLR_TENANT_ID, member_id: 'member-new' })
    for (const f of [s.upsertMember, s.linkSchool, s.recordParticipation, s.dispatchAgreement, s.ensureIndividualPayments, s.applyRosterChange]) {
      expect(f).toHaveBeenCalled()
    }
    expect(db.reads).not.toContain('events')
    expect(db.reads).not.toContain('tenants')
  })

  it('a 13-year-old is still added (Stellr admits them with a parent), as a student', async () => {
    const res = await addParticipantToGroup(db.client, stellrGroup, person(THIRTEEN, { event_role: 'adult' }), organiser)
    expect(res.status).toBe(201)
    expect(participants()[0]).toMatchObject({ event_role: 'participant', age_bracket: 'high_school', tenant_id: STELLR_TENANT_ID })
  })

  it('a Member ID is looked up as before', async () => {
    s.onFile.mockResolvedValue(ON_FILE)
    const res = await addParticipantToGroup(db.client, stellrGroup, { membership_id: '0000271', linked: true, first_name: 'Sam', last_name: 'Lee' }, organiser)
    expect(res.status).toBe(201)
    expect(s.onFile).toHaveBeenCalledWith(expect.anything(), '0000271')
    expect(participants()[0]).toMatchObject({ member_id: 'member-9', details_from_member: true })
  })
})

describe('the shared roster add, on a tenant’s group', () => {
  it('an adult added by the organiser gets the participant row only, with the tenant’s tenant_id', async () => {
    const res = await addParticipantToGroup(db.client, tenantGroup, person(ADULT, { event_role: 'adult', membership_id: '0000271' }), organiser)
    expect(res.status).toBe(201)
    expect(participants()).toHaveLength(1)
    const row = participants()[0]
    expect(row).toMatchObject({ registration_id: tenantGroup.id, tenant_id: TENANT, first_name: 'Sam', email: 'sam@example.com' })
    expect(row).not.toHaveProperty('member_id')
    // A Stellr Member ID typed into the form is not stored on the tenant's row.
    expect(row).not.toHaveProperty('membership_id')
    expect(res.body.billing).toEqual({ message: null, action: 'none' })
    for (const f of stellrOnlySpies()) expect(f).not.toHaveBeenCalled()
  })

  it('a 13-year-old is refused under the tenant’s floor, and nothing is written', async () => {
    const res = await addParticipantToGroup(db.client, tenantGroup, person(THIRTEEN), organiser)
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('under_minimum_age')
    expect(res.body.error).toBe('Sam Lee must be 14 or older on the day of the event to take part.')
    expect(participants()).toHaveLength(0)
    for (const f of stellrOnlySpies()) expect(f).not.toHaveBeenCalled()
  })

  it.each([
    ['with the guardian-consent flag off', ''],
    ['with the guardian-consent flag on, since this path collects no consent', 'true'],
  ])('a 15-year-old with a parent named is refused in the approved words %s', async (_l, flag) => {
    vi.stubEnv('TENANT_GUARDIAN_CONSENT_ENABLED', flag)
    const res = await addParticipantToGroup(db.client, tenantGroup, person(FIFTEEN, {
      emergency_contact_first_name: 'Pat', emergency_contact_last_name: 'Lee', emergency_contact_email: 'pat@example.com',
      emergency_contact_relationship: 'Parent',
    }), staff)
    expect(res).toEqual({
      status: 400,
      body: { code: 'under_minimum_age', error: 'Sam Lee must be 18 or older to register for this event online. Please contact the event organiser.' },
    })
    expect(participants()).toHaveLength(0)
  })

  it('a Stellr Member ID gets the unknown ID’s answer from an organiser, and is never looked up (cross-tenant)', async () => {
    s.onFile.mockResolvedValue(ON_FILE)
    const sent = { membership_id: '0000271', linked: true, first_name: 'Sam', last_name: 'Lee' }
    const onTenant = await addParticipantToGroup(db.client, tenantGroup, sent, organiser)
    // The same submission naming an unknown ID on Stellr's own group.
    s.onFile.mockResolvedValue(null)
    const unknownOnStellr = await addParticipantToGroup(db.client, stellrGroup, sent, organiser)
    expect(onTenant).toEqual(unknownOnStellr)
    expect(onTenant.status).toBe(400)
    expect(s.onFile).toHaveBeenCalledTimes(1) // Stellr's call only
    const answered = JSON.stringify(onTenant.body)
    for (const v of ['Rec', 'Ord', 'rec@example.com', 'Asthma', 'member-9']) expect(answered).not.toContain(v)
    expect(participants()).toHaveLength(0)
  })

  it('staff naming a Member ID carry on with what they typed, as for an unknown ID, with no lookup', async () => {
    s.onFile.mockResolvedValue(ON_FILE)
    const res = await addParticipantToGroup(db.client, tenantGroup, { ...person(ADULT, { event_role: 'adult' }), membership_id: '0000271', linked: true }, staff)
    expect(res.status).toBe(201)
    expect(participants()[0]).toMatchObject({ first_name: 'Sam', email: 'sam@example.com', tenant_id: TENANT })
    expect(participants()[0]).not.toHaveProperty('member_id')
    expect(participants()[0]).not.toHaveProperty('details_from_member')
    for (const f of stellrOnlySpies()) expect(f).not.toHaveBeenCalled()
  })

  it.each([
    ['an invoice', { invoice_requested: true }],
    ['a card payment', { stripe_payment_intent_id: 'pi_123' }],
    ['an amount due', { amount_due_cents: 9700 }],
    ['a split invoice', { late_joiner_payer: 'self' }],
    ['a shared teacher’s cost', { share_estimate: 2500 }],
  ])('a group with %s is refused with the tenant payments answer before anything else', async (_l, money) => {
    const res = await addParticipantToGroup(db.client, { ...tenantGroup, ...money }, person(ADULT), organiser)
    expect(res).toEqual({
      status: 503,
      body: { code: 'tenant_payments_unavailable', error: 'Paid registration for this event isn’t available online yet. Please contact the event organiser.' },
    })
    expect(participants()).toHaveLength(0)
    for (const f of stellrOnlySpies()) expect(f).not.toHaveBeenCalled()
  })

  it('an event the mirror does not hold, or holds for another tenant, refuses with the eligibility answer', async () => {
    db.fake.tables.events = []
    const missing = await addParticipantToGroup(db.client, tenantGroup, person(ADULT), organiser)
    expect(missing.status).toBe(503)
    expect(missing.body.code).toBe('eligibility_unavailable')
    db.fake.tables.events = [{ slug: 'acme-day', tenant_id: STELLR_TENANT_ID, activity_type: 'live_event', starts_at: null, time_zone: 'America/Denver', min_participant_age: null }]
    const mismatched = await addParticipantToGroup(db.client, tenantGroup, person(ADULT), organiser)
    expect(mismatched.status).toBe(503)
    expect(mismatched.body.code).toBe('eligibility_unavailable')
    expect(participants()).toHaveLength(0)
  })

  it('a refusal from the database’s eligibility check answers as the eligibility check, not as a failed save', async () => {
    db.refuse = (op) => op === 'insert'
    const res = await addParticipantToGroup(db.client, tenantGroup, person(ADULT), organiser)
    expect(res.status).toBe(503)
    expect(res.body.code).toBe('eligibility_unavailable')
  })
})

const sheetRow = (dob: string, email: string, extra: Record<string, unknown> = {}) => ({
  membership_id: '', type: 'participant', first_name: 'Row', last_name: email.split('@')[0], email, phone: '', date_of_birth: dob,
  gender: '', t_shirt_size: '', grade: '', dietary_requirements: [], health_conditions: '', ec_first_name: '', ec_last_name: '',
  ec_email: '', ec_phone: '', ec_relationship: '', school_email: '', ...extra,
})

describe('the roster sheet import', () => {
  it('on Stellr’s group, an existing row whose update the eligibility check refuses is skipped and reported, with no paperwork', async () => {
    db.fake.tables.participants = [{ id: 'p-old', registration_id: stellrGroup.id, email: 'kid@example.com', details_from_member: false }]
    db.refuse = (op) => op === 'update'
    s.readSheet.mockResolvedValue([sheetRow(ADULT, 'kid@example.com')])
    const res = await syncParticipantsFromSheet(db.client, stellrGroup)
    expect(res).toMatchObject({ created: 0, updated: 0, skippedForDateOfBirth: ['Row kid'] })
    expect(s.dispatchAgreement).not.toHaveBeenCalled()
  })

  it('on Stellr’s group, an insert the eligibility check refuses is reported, never taken for the duplicate race', async () => {
    db.refuse = (op) => op === 'insert'
    s.readSheet.mockResolvedValue([sheetRow(ADULT, 'new@example.com')])
    const res = await syncParticipantsFromSheet(db.client, stellrGroup)
    expect(res).toMatchObject({ created: 0, updated: 0, skippedForDateOfBirth: ['Row new'] })
    // One existing-row read, and no re-read by email as the race path would make.
    expect(db.reads.filter((t) => t === 'participants')).toHaveLength(2) // the read, then the refused insert
    expect(s.dispatchAgreement).not.toHaveBeenCalled()
    expect(s.applyRosterChange).not.toHaveBeenCalled()
  })

  it('on Stellr’s group, the raced update refused by the eligibility check is reported too', async () => {
    // The insert loses the race (23505-like: any other error), the re-read finds the row,
    // and its update is refused.
    let inserts = 0
    db.refuse = (op) => {
      if (op === 'insert') { inserts++; db.fake.tables.participants.push({ id: 'p-raced', registration_id: stellrGroup.id, email: 'race@example.com', details_from_member: false }) }
      return op === 'update'
    }
    const base = db.client as unknown as { from(t: string): Record<string, (...a: unknown[]) => unknown> }
    const wrapped = {
      from(t: string) {
        const b = base.from(t)
        if (t !== 'participants') return b
        const orig = b.insert
        b.insert = (p: unknown) => {
          orig(p)
          return { select: () => ({ single: async () => ({ data: null, error: { code: '23505', message: 'duplicate key' } }) }) }
        }
        return b
      },
    }
    s.readSheet.mockResolvedValue([sheetRow(ADULT, 'race@example.com')])
    const res = await syncParticipantsFromSheet(wrapped as never, stellrGroup)
    expect(inserts).toBe(1)
    expect(res).toMatchObject({ created: 0, updated: 0, skippedForDateOfBirth: ['Row race'] })
    expect(s.dispatchAgreement).not.toHaveBeenCalled()
  })

  it('on Stellr’s group, rows are judged and written as before, with Stellr’s tenant_id on a new row', async () => {
    s.readSheet.mockResolvedValue([sheetRow(ADULT, 'a@example.com'), sheetRow(THIRTEEN, 'b@example.com'), sheetRow('', 'c@example.com')])
    const res = await syncParticipantsFromSheet(db.client, stellrGroup)
    expect(res).toMatchObject({ created: 2, skippedForDateOfBirth: ['Row c'] })
    expect(participants().map((p) => p.tenant_id)).toEqual([STELLR_TENANT_ID, STELLR_TENANT_ID])
    expect(s.upsertMember).toHaveBeenCalledTimes(2)
    expect(s.dispatchAgreement).toHaveBeenCalledTimes(2)
    expect(db.reads).not.toContain('tenants')
  })

  it('on a tenant’s group, a 13-year-old and a 15-year-old are skipped and reported, and an adult gets the row only', async () => {
    s.readSheet.mockResolvedValue([
      sheetRow(THIRTEEN, 'young@example.com'),
      sheetRow(FIFTEEN, 'teen@example.com', { ec_first_name: 'Pat', ec_email: 'pat@example.com', ec_relationship: 'Parent' }),
      sheetRow(ADULT, 'adult@example.com', { membership_id: '0000271' }),
    ])
    const res = await syncParticipantsFromSheet(db.client, tenantGroup)
    expect(res).toEqual({ created: 1, updated: 0, syncedMemberIds: [], paymentLinksSent: 0, skippedForDateOfBirth: ['Row young', 'Row teen'] })
    expect(participants()).toHaveLength(1)
    expect(participants()[0]).toMatchObject({ email: 'adult@example.com', tenant_id: TENANT, registration_id: tenantGroup.id })
    expect(participants()[0]).not.toHaveProperty('member_id')
    for (const f of stellrOnlySpies()) expect(f).not.toHaveBeenCalled()
  })

  it('on a tenant’s group that takes money, nothing is read from the sheet', async () => {
    s.readSheet.mockResolvedValue([sheetRow(ADULT, 'adult@example.com')])
    const err = await syncParticipantsFromSheet(db.client, { ...tenantGroup, invoice_requested: true }).catch((e) => e)
    expect(err).toBeInstanceOf(SheetSyncRefused)
    expect(err.status).toBe(503)
    expect(err.body.code).toBe('tenant_payments_unavailable')
    expect(s.readSheet).not.toHaveBeenCalled()
    expect(participants()).toHaveLength(0)
  })
})
