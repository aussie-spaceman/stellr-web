import { describe, expect, it } from 'vitest'
import { pathForRole, planRecipients, type Person } from './recipients'
import { attributionFor, compareDocVersion, defaultAllowQuotes, meetsSurveyAgreement, NO_CONSENT, quoteEligibility, type MinorConsent, type QuoteFacts } from './consent'

const DAY = '2026-10-10'

function person(over: Partial<Person>): Person {
  return {
    source: 'participant',
    participantId: null,
    memberId: null,
    firstName: 'Sam',
    lastName: 'Lee',
    email: null,
    eventRole: 'participant',
    dateOfBirth: '2010-05-01',
    grade: null,
    ageBracket: null,
    state: 'CO',
    guardianEmail: null,
    guardianFirstName: null,
    ...over,
  }
}

const v23 = (over: Partial<MinorConsent> = {}): MinorConsent => ({
  ...NO_CONSENT,
  agreementId: 'a1',
  agreementVersion: 'V2.3',
  coversSurveys: true,
  guardianEmail: 'parent@example.com',
  ...over,
})

describe('role mapping (handover A1)', () => {
  it('maps every enum value', () => {
    expect(pathForRole('participant')).toEqual({ role: 'student', relationship: null })
    expect(pathForRole('mentor')?.role).toBe('mentor')
    expect(pathForRole('volunteer')?.role).toBe('mentor')
    expect(pathForRole('teacher')).toEqual({ role: 'adult', relationship: 'teacher' })
    expect(pathForRole('school_student_manager')).toEqual({ role: 'adult', relationship: 'teacher' })
    expect(pathForRole('parent')).toEqual({ role: 'adult', relationship: 'parent' })
    expect(pathForRole('adult')).toEqual({ role: 'adult', relationship: null })
    expect(pathForRole('donor')).toBeNull()
    expect(pathForRole('subscriber')).toBeNull()
  })
})

describe('planRecipients', () => {
  const all = ['student', 'mentor', 'adult'] as const

  it('holds minors without a V2.3 agreement, invites those with one', () => {
    const people = [
      person({ participantId: 'p1', email: 'a@example.com' }),
      person({ participantId: 'p2', email: 'b@example.com', firstName: 'Bo' }),
      person({ participantId: 'p3', email: 'c@example.com', firstName: 'Cy' }),
    ]
    const consents = new Map([
      ['participant:p1', v23()],
      ['participant:p2', v23({ agreementVersion: 'V2.2', coversSurveys: false })],
    ])
    const plan = planRecipients(people, consents, [...all], DAY)
    expect(plan.invitable.map((i) => i.participantId)).toEqual(['p1'])
    expect(plan.awaitingConsent.map((a) => [a.participantId, a.reason])).toEqual([
      ['p2', 'older_version'],
      ['p3', 'no_agreement'],
    ])
  })

  it('sends a minor\'s invitation to the guardian alone after a §4 opt-out', () => {
    const plan = planRecipients(
      [person({ participantId: 'p1', email: 'kid@example.com' })],
      new Map([['participant:p1', v23({ digitalCommsOptOut: true })]]),
      [...all],
      DAY,
    )
    expect(plan.invitable[0]).toMatchObject({ email: 'parent@example.com', sendVia: 'guardian', isMinor: true })
  })

  it('uses the guardian when the student has no address of their own, or shares the guardian\'s', () => {
    const none = planRecipients([person({ participantId: 'p1', email: null })], new Map([['participant:p1', v23()]]), [...all], DAY)
    expect(none.invitable[0]).toMatchObject({ email: 'parent@example.com', sendVia: 'guardian' })
    const shared = planRecipients([person({ participantId: 'p1', email: 'Parent@Example.com' })], new Map([['participant:p1', v23()]]), [...all], DAY)
    expect(shared.invitable[0]).toMatchObject({ sendVia: 'guardian' })
    const own = planRecipients([person({ participantId: 'p1', email: 'kid@example.com' })], new Map([['participant:p1', v23()]]), [...all], DAY)
    expect(own.invitable[0]).toMatchObject({ email: 'kid@example.com', sendVia: 'self' })
  })

  it('lists people with no deliverable address separately', () => {
    const plan = planRecipients(
      [
        person({ participantId: 'p1', email: null }),
        person({ source: 'teacher', eventRole: 'teacher', email: 'not-an-email', dateOfBirth: null }),
      ],
      new Map([['participant:p1', v23({ guardianEmail: null })]]),
      [...all],
      DAY,
    )
    expect(plan.unreachable.map((u) => u.reason).sort()).toEqual(['no_email', 'no_guardian_email'])
    expect(plan.invitable).toHaveLength(0)
  })

  it('does not gate adult students on the minors agreement', () => {
    const plan = planRecipients(
      [person({ participantId: 'p1', email: 'uni@example.com', dateOfBirth: '2005-01-01', grade: 'college_sophomore', ageBracket: 'college' })],
      new Map(),
      [...all],
      DAY,
    )
    expect(plan.invitable[0]).toMatchObject({ isMinor: false, sendVia: 'self' })
  })

  it('deduplicates by member, then email, keeping one invitation per person', () => {
    const plan = planRecipients(
      [
        person({ source: 'teacher', eventRole: 'teacher', memberId: 'm1', email: 'T@school.org', dateOfBirth: null }),
        person({ source: 'contact', eventRole: 'teacher', email: 't@school.org', dateOfBirth: null }),
        person({ source: 'volunteer', eventRole: 'volunteer', memberId: 'm2', email: 'm@co.com', dateOfBirth: '1980-01-01' }),
        person({ source: 'attendee', eventRole: 'mentor', memberId: 'm2', email: 'm@co.com', dateOfBirth: '1980-01-01' }),
      ],
      new Map(),
      [...all],
      DAY,
    )
    expect(plan.invitable.map((i) => [i.recipientKey, i.role, i.adultRelationship])).toEqual([
      ['member:m1', 'adult', 'teacher'],
      ['member:m2', 'mentor', null],
    ])
    expect(plan.invitable[0].sources).toEqual(['teacher', 'contact'])
  })

  it('filters by audience and skips donors', () => {
    const plan = planRecipients(
      [
        person({ source: 'teacher', eventRole: 'teacher', email: 't@school.org', dateOfBirth: null }),
        person({ source: 'attendee', eventRole: 'donor', memberId: 'm9', email: 'd@x.com' }),
      ],
      new Map(),
      ['student', 'mentor'],
      DAY,
    )
    expect(plan.invitable).toHaveLength(0)
    expect(plan.notSurveyed).toBe(1)
  })
})

describe('agreement versions', () => {
  it('compares V-labels numerically', () => {
    expect(compareDocVersion('V2.3', 'V2.3')).toBe(0)
    expect(compareDocVersion('V2.10', 'V2.3')).toBe(1)
    expect(compareDocVersion('V3', 'V2.3')).toBe(1)
    expect(compareDocVersion('V2.2', 'V2.3')).toBe(-1)
    // agreements.agreement_version is recorded without the V (#280)
    expect(compareDocVersion('2.3', 'V2.3')).toBe(0)
    expect(meetsSurveyAgreement('2.3')).toBe(true)
    expect(meetsSurveyAgreement('2.2')).toBe(false)
    expect(meetsSurveyAgreement(null)).toBe(false)
    expect(meetsSurveyAgreement('V2.4')).toBe(true)
  })
})

describe('quote eligibility (V2.3 §1.7, §2)', () => {
  const minor = (over: Partial<QuoteFacts> = {}): QuoteFacts => ({
    isMinor: true,
    age: 16,
    state: 'NE',
    agreementVersion: 'V2.3',
    agreementRestricted: false,
    parentQuoteOptOut: false,
    studentAllowQuotes: null,
    noQuote: false,
    quoteConsent: null,
    withdrawn: false,
    ...over,
  })

  it('allows a V2.3 minor by default and formats the §2 attribution', () => {
    const d = quoteEligibility(minor())
    expect(d).toEqual({ eligible: true, attribution: 'minor' })
    if (d.eligible) {
      expect(attributionFor(d, { firstName: 'Jordan', lastName: 'Morales', grade: 'grade_11', school: null, state: 'Nebraska' })).toBe(
        'Jordan M., Grade 11, Nebraska',
      )
    }
  })

  it('blocks on every opt-out', () => {
    expect(quoteEligibility(minor({ agreementVersion: 'V2.2' })).eligible).toBe(false)
    expect(quoteEligibility(minor({ parentQuoteOptOut: true })).eligible).toBe(false)
    expect(quoteEligibility(minor({ studentAllowQuotes: false })).eligible).toBe(false)
    expect(quoteEligibility(minor({ noQuote: true })).eligible).toBe(false)
    expect(quoteEligibility(minor({ withdrawn: true })).eligible).toBe(false)
    expect(quoteEligibility(minor({ agreementRestricted: true })).eligible).toBe(false)
  })

  it('defaults NY/CO 13–17-year-olds to off until they turn it on', () => {
    expect(defaultAllowQuotes(15, 'Colorado')).toBe(false)
    expect(defaultAllowQuotes(15, 'NY')).toBe(false)
    expect(defaultAllowQuotes(18, 'NY')).toBe(true)
    expect(quoteEligibility(minor({ state: 'CO' })).eligible).toBe(false)
    expect(quoteEligibility(minor({ state: 'CO', studentAllowQuotes: true })).eligible).toBe(true)
  })

  it('quotes under-13s with nothing identifying', () => {
    const d = quoteEligibility(minor({ age: 12 }))
    expect(d).toEqual({ eligible: true, attribution: 'minor_under_13' })
    if (d.eligible) expect(attributionFor(d, { firstName: 'Kai', lastName: 'Ng', grade: 'grade_7', school: 'X', state: 'CO' })).toBe('')
  })

  it('needs an explicit yes from adults', () => {
    const adult = minor({ isMinor: false, quoteConsent: null })
    expect(quoteEligibility(adult).eligible).toBe(false)
    expect(quoteEligibility({ ...adult, quoteConsent: 'no' }).eligible).toBe(false)
    expect(quoteEligibility({ ...adult, quoteConsent: 'named' })).toEqual({ eligible: true, attribution: 'named' })
    expect(quoteEligibility({ ...adult, quoteConsent: 'anonymous' })).toEqual({ eligible: true, attribution: 'anonymous' })
  })
})
