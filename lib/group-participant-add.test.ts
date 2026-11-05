import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  inserted: [] as Record<string, unknown>[],
  onFile: null as Record<string, unknown> | null,
  /** What the duplicate guard finds on this roster. */
  dupe: null as { id: string } | null,
  orFilters: [] as string[],
}))

vi.mock('@/lib/member-sync', () => ({ upsertMember: async () => 'member-1' }))
vi.mock('@/lib/school-link', () => ({ linkMembersToRegistrationSchool: async () => {} }))
vi.mock('@/lib/event-participation-sync', () => ({ recordEventParticipationForRegistration: async () => {} }))
vi.mock('@/lib/docusign-agreements', () => ({ dispatchAgreement: async () => ({}) }))
vi.mock('@/lib/member-onfile', () => ({ getMemberOnFileByMembershipId: async () => h.onFile }))
vi.mock('@/lib/individual-payment', () => ({ ensureIndividualPayments: async () => {} }))
vi.mock('@/lib/field-crypto-shadow', () => ({ shadowSyncFields: () => {} }))
vi.mock('@/lib/group-billing', () => ({ applyRosterChange: async () => ({ action: 'none', message: null }) }))
vi.mock('@/lib/stripe', () => ({ stripeClient: () => null }))

import { addParticipantToGroup } from '@/lib/group-participant-add'

function db() {
  return {
    from: () => {
      let row: Record<string, unknown> | null = null
      const chain: Record<string, unknown> = {
        select: () => chain, eq: () => chain,
        or: (filter: string) => { h.orFilters.push(filter); return chain },
        maybeSingle: async () => ({ data: h.dupe, error: null }),
        insert: (r: Record<string, unknown>) => { h.inserted.push(r); row = { id: 'p-1', ...r }; return chain },
        single: async () => ({ data: row, error: null }),
      }
      return chain
    },
  } as never
}

const group = { id: 'reg-1', event_slug: 'nevada', event_title: 'Nevada', school_name: 'Rancho High School', school_address_state: 'NV' }
const actor = { memberId: 'staff-1', label: 'admin' }
const organiser = { memberId: 'org-1', label: 'organiser' }

beforeEach(() => { h.inserted = []; h.onFile = null; h.dupe = null; h.orFilters = [] })

describe('addParticipantToGroup — required roster columns (4 Nov 2026)', () => {

  it('fills the group school when the form sends none (the bug that left a member with no roster row)', async () => {
    const res = await addParticipantToGroup(db(), group, {
      first_name: 'Sam', last_name: 'Student', email: 'sam@example.com', date_of_birth: '2011-05-12',
      event_role: 'participant',
    }, actor)
    expect(res.status).toBe(201)
    expect(h.inserted[0]).toMatchObject({ school_name: 'Rancho High School', phone: '', gender: '', t_shirt_size: '', age_bracket: 'high_school' })
  })

  it('gives an adult the adult bracket and keeps a school the form did send', async () => {
    await addParticipantToGroup(db(), group, {
      first_name: 'Ada', last_name: 'Adult', email: 'ada@example.com', date_of_birth: '1985-04-01',
      event_role: 'adult', school_name: 'Other School',
    }, actor)
    expect(h.inserted[0]).toMatchObject({ school_name: 'Other School', age_bracket: 'adult' })
  })

  it('turns nulls copied from a Member ID link into empty strings', async () => {
    h.onFile = {
      memberId: 'm-9', first_name: 'Lin', last_name: 'Ked', nickname: null, email: 'lin@example.com', phone: null,
      date_of_birth: '2011-05-12', grade: null, gender: null, t_shirt_size: null, ethnicity: [], dietary_requirements: [],
      health_conditions: null, event_role: 'participant',
    }
    const res = await addParticipantToGroup(db(), group, { membership_id: '0000271', linked: true }, actor)
    expect(res.status).toBe(201)
    expect(h.inserted[0]).toMatchObject({ member_id: 'm-9', phone: '', gender: '', t_shirt_size: '', school_name: 'Rancho High School' })
  })
})

// A full record: every value is one the organiser did not send.
const ON_FILE = {
  memberId: 'm-9', first_name: 'Rec', last_name: 'Latest', member_last_name: 'Mitted', nickname: 'Nick',
  email: 'record@example.com', phone: '555-0100', date_of_birth: '2011-05-12', grade: '9', gender: 'Female',
  t_shirt_size: 'M', ethnicity: ['Asian'], dietary_requirements: ['Peanuts'], health_conditions: 'Asthma',
  emergency_contact_first_name: 'Par', emergency_contact_last_name: 'Ent', emergency_contact_email: 'parent@example.com',
  emergency_contact_phone: '555-0101', emergency_contact_relationship: 'Parent', event_role: 'participant',
}
const STORED_VALUES = [
  'Rec', 'Latest', 'Nick', 'record@example.com', '555-0100', '2011-05-12', 'Female', 'Asian', 'Peanuts', 'Asthma',
  'Par', 'Ent', 'parent@example.com', '555-0101', 'Parent', 'm-9',
]
const SENT = { membership_id: '0000271', linked: true, first_name: 'Sub', last_name: 'Mitted' }
const REFUSAL = {
  status: 400,
  body: {
    code: 'member_id_unusable',
    error: "We couldn't use the Stellr Member ID for Sub Mitted. Check the ID and last name, or enter their details by hand. If both are right, ask them to check their date of birth with Stellr.",
  },
}

describe('addParticipantToGroup — an organiser linking by Member ID', () => {
  it.each([
    ['an unknown ID', null],
    ['a last name that is not the member row’s', { ...ON_FILE, member_last_name: 'Other' }],
    ['a name that matches only the latest participant row', { ...ON_FILE, last_name: 'Mitted', member_last_name: 'Other' }],
    ['a member row with no last name', { ...ON_FILE, member_last_name: null }],
    ['no date of birth on file', { ...ON_FILE, date_of_birth: null }],
    ['an unusable date of birth on file', { ...ON_FILE, date_of_birth: '2999-01-01' }],
  ])('%s gets the one refusal, and nothing is written', async (_l, onFile) => {
    h.onFile = onFile
    const res = await addParticipantToGroup(db(), group, SENT, organiser)
    expect(res).toEqual(REFUSAL)
    expect(h.inserted).toEqual([])
  })

  it('no last name at all gets the same refusal, naming only what was sent', async () => {
    h.onFile = ON_FILE
    const res = await addParticipantToGroup(db(), group, { membership_id: '0000271', linked: true }, organiser)
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ code: 'member_id_unusable', error: REFUSAL.body.error.replace('Sub Mitted', 'one person') })
  })

  it('an ID on this roster is the one refusal until the last name matches', async () => {
    h.dupe = { id: 'p-existing' }
    h.onFile = { ...ON_FILE, member_last_name: 'Other' }
    expect(await addParticipantToGroup(db(), group, SENT, organiser)).toEqual(REFUSAL)
    h.onFile = ON_FILE
    expect((await addParticipantToGroup(db(), group, SENT, organiser)).status).toBe(409)
  })

  it('a match answers with the submitted name and links the member', async () => {
    h.onFile = ON_FILE
    const res = await addParticipantToGroup(db(), group, { ...SENT, last_name: '  mITTED ' }, organiser)
    expect(res.status).toBe(201)
    expect(res.body.participant).toEqual({ id: 'p-1', first_name: 'Sub', last_name: 'mITTED' })
    const answered = JSON.stringify(res.body)
    for (const value of STORED_VALUES) expect(answered).not.toContain(value)
    expect(h.inserted[0]).toMatchObject({
      member_id: 'm-9', first_name: 'Rec', last_name: 'Latest', email: 'record@example.com', date_of_birth: '2011-05-12',
      health_conditions: 'Asthma', emergency_contact_email: 'parent@example.com', details_from_member: true,
    })
  })

  it('details typed with no link answer with the row as saved', async () => {
    const res = await addParticipantToGroup(db(), group, {
      first_name: 'Ty', last_name: 'Ped', email: 'typed@example.com', date_of_birth: '2011-05-12', event_role: 'participant',
    }, organiser)
    expect(res.status).toBe(201)
    expect(res.body.participant).toMatchObject({ first_name: 'Ty', email: 'typed@example.com', date_of_birth: '2011-05-12' })
  })

  it('the duplicate guard compares the ID in its stored form', async () => {
    h.onFile = ON_FILE
    await addParticipantToGroup(db(), group, { ...SENT, membership_id: '271' }, organiser)
    expect(h.orFilters[0]).toContain('membership_id.eq.0000271,')
  })
})

describe('addParticipantToGroup — staff linking by Member ID', () => {
  it('needs no last name, and answers with the row as saved', async () => {
    h.onFile = ON_FILE
    const res = await addParticipantToGroup(db(), group, { membership_id: '0000271', linked: true }, actor)
    expect(res.status).toBe(201)
    expect(res.body.participant).toMatchObject({ id: 'p-1', email: 'record@example.com', health_conditions: 'Asthma' })
  })

  it('an unknown ID with details typed in goes ahead on what was typed', async () => {
    const res = await addParticipantToGroup(db(), group, {
      membership_id: '0000271', linked: true, first_name: 'Ty', last_name: 'Ped', email: 'typed@example.com', date_of_birth: '2011-05-12',
    }, actor)
    expect(res.status).toBe(201)
    expect(h.inserted[0]).toMatchObject({ first_name: 'Ty', email: 'typed@example.com', member_id: 'member-1' })
  })

  it('no date of birth on file is refused with a way forward', async () => {
    h.onFile = { ...ON_FILE, date_of_birth: null }
    const res = await addParticipantToGroup(db(), group, { membership_id: '0000271', linked: true }, actor)
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('dob_missing')
    expect(res.body.error).toMatch(/don't have a date of birth on file for this Stellr Member ID/)
    expect(h.inserted).toEqual([])
  })

  it('a date of birth on file that is wrong is asked to be corrected', async () => {
    h.onFile = { ...ON_FILE, date_of_birth: '2999-01-01' }
    const res = await addParticipantToGroup(db(), group, { membership_id: '0000271', linked: true }, actor)
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('dob_invalid')
    expect(res.body.error).toMatch(/date of birth on file for this Stellr Member ID doesn't look right/)
    expect(res.body.error).toMatch(/contact Stellr to correct it/)
    expect(h.inserted).toEqual([])
  })
})
