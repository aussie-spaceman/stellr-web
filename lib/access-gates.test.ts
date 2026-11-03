// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeSupabase, type FakeDb } from '@/test/fake-supabase'

// S0 (2 Nov 2026): lib/age presumes an unknown date of birth is a minor. The
// access gates used it bare, so a mentor or volunteer with a blank date of
// birth on their participant row (they sign at member level, so the row has no
// envelope) failed the DocuSign gate and was locked out of the event portal
// with ACCESS_GATES_ENFORCE on. These pin the role-aware rule: an adult by role
// is a minor only when a date of birth on file says so; a student, or anyone
// whose role says nothing about age, with no usable date is still presumed one.
//
// 3 Nov 2026: "an adult by role" is an allowlist (a subscriber or an unknown
// role is judged as a student), and the enrolment gate goes by date of birth
// alone, never by role: the youngest usable one on the member row or any of
// their participant rows, so a self-entered adult date on the member row does
// not outrank a minor one from a registration.

let db: FakeDb
const logActivity = vi.fn(async (..._args: unknown[]) => {})
vi.mock('@/lib/supabase', () => ({ supabaseServer: () => db.client }))
vi.mock('@/lib/activity-log', () => ({ logActivity: (...args: unknown[]) => logActivity(...args) }))

import { eventAccessGates, reportEnrollmentGate } from './access-gates'
import type { CommunityMember } from './community'

const SLUG = 'nevada-2026'
const MEMBER_ID = 'member-1'
const member = { id: MEMBER_ID } as CommunityMember

// Relative to today, so the fixtures do not age into adults.
const year = new Date().getFullYear()
const MINOR_DOB = `${year - 14}-01-15`
const ADULT_DOB = `${year - 40}-04-02`
// Not a usable date of birth. participants.date_of_birth is NOT NULL, so on a
// real participant row this is what "unknown" looks like.
const FUTURE_DOB = `${year + 1}-01-15`

const freeReg = { event_slug: SLUG, status: 'confirmed', amount_due_cents: 0, invoice_requested: false, invoice_paid_at: null }

function participant(eventRole: string | null, dateOfBirth: string | null, id = 'p-1') {
  return {
    id,
    member_id: MEMBER_ID,
    date_of_birth: dateOfBirth,
    event_role: eventRole,
    individual_payment_status: null,
    registrations: freeReg,
  }
}

beforeEach(() => {
  logActivity.mockClear()
})

describe('eventAccessGates — DocuSign gate with no envelope', () => {
  it('passes a mentor, volunteer or teacher with no date of birth on file', async () => {
    for (const role of ['mentor', 'volunteer', 'teacher']) {
      db = fakeSupabase({ participants: [participant(role, null)], agreements: [] })
      expect(await eventAccessGates(member, SLUG), role).toEqual({ payment: true, docusign: true, unlocked: true })
    }
  })

  it('still presumes a student, or a row with no role, with no date of birth is a minor', async () => {
    for (const role of ['participant', 'school_student_manager', null]) {
      db = fakeSupabase({ participants: [participant(role, null)], agreements: [] })
      expect(await eventAccessGates(member, SLUG), String(role)).toEqual({ payment: true, docusign: false, unlocked: false })
    }
  })

  it('holds an adult by role whose date of birth says under 18', async () => {
    db = fakeSupabase({ participants: [participant('mentor', MINOR_DOB)], agreements: [] })
    expect((await eventAccessGates(member, SLUG)).docusign).toBe(false)
  })

  it('passes anyone whose date of birth says adult', async () => {
    for (const role of ['participant', 'subscriber']) {
      db = fakeSupabase({ participants: [participant(role, ADULT_DOB)], agreements: [] })
      expect((await eventAccessGates(member, SLUG)).docusign, role).toBe(true)
    }
  })

  it('judges a subscriber, a legacy student spelling or an unknown role as a student', async () => {
    for (const role of ['subscriber', 'donor', 'student', 'School Student', 'coach']) {
      for (const dob of [FUTURE_DOB, null]) {
        db = fakeSupabase({ participants: [participant(role, dob)], agreements: [] })
        expect((await eventAccessGates(member, SLUG)).docusign, `${role} ${dob}`).toBe(false)
      }
    }
  })

  it('still passes an adult role in a legacy spelling with no usable date of birth', async () => {
    for (const role of ['Mentor', 'Teacher', 'Volunteer']) {
      db = fakeSupabase({ participants: [participant(role, FUTURE_DOB)], agreements: [] })
      expect((await eventAccessGates(member, SLUG)).docusign, role).toBe(true)
    }
  })
})

describe('eventAccessGates — with an envelope', () => {
  it('a completed envelope passes whatever the role or date of birth says', async () => {
    for (const [role, dob] of [['participant', null], ['participant', MINOR_DOB], ['mentor', MINOR_DOB], [null, null]] as const) {
      db = fakeSupabase({
        participants: [participant(role, dob)],
        agreements: [{ participant_id: 'p-1', event_slug: SLUG, status: 'completed' }],
      })
      expect((await eventAccessGates(member, SLUG)).docusign, `${role} ${dob}`).toBe(true)
    }
  })

  it('an envelope still out for signature blocks, even for an adult by role', async () => {
    db = fakeSupabase({
      participants: [participant('mentor', null)],
      agreements: [{ participant_id: 'p-1', event_slug: SLUG, status: 'sent' }],
    })
    expect((await eventAccessGates(member, SLUG)).docusign).toBe(false)
  })
})

function memberRow(eventRole: string, dateOfBirth: string | null, ageBracket = 'adult') {
  return { id: MEMBER_ID, date_of_birth: dateOfBirth, event_role: eventRole, age_bracket: ageBracket }
}

/** A participant row for the enrolment gate, which reads only id and date of birth. */
function dobRow(dateOfBirth: string | null, id = 'p-1') {
  return { id, member_id: MEMBER_ID, date_of_birth: dateOfBirth }
}

const enrol = () => reportEnrollmentGate({ id: MEMBER_ID }, { kind: 'cohort', containerId: 'cohort-1', containerName: 'Rocketry' })

describe('reportEnrollmentGate', () => {
  it('holds an adult role with no date of birth anywhere: the role is not evidence of age', async () => {
    // The admin add-member form defaults to an adult teacher with the date of
    // birth optional; the cohort APIs do not check the member has onboarded.
    for (const role of ['teacher', 'mentor', 'volunteer', 'parent', 'adult']) {
      db = fakeSupabase({ members: [memberRow(role, null)], participants: [], agreements: [] })
      expect(await enrol(), role).toEqual({ minorAgreement: false, unlocked: false })
    }
    expect(logActivity).toHaveBeenCalledTimes(5)
  })

  it('falls back to the participant rows when the member row has no date of birth', async () => {
    // An existing member who joined through a registration link keeps a blank
    // member date of birth; their participant row has one.
    db = fakeSupabase({ members: [memberRow('subscriber', null)], participants: [dobRow(ADULT_DOB)], agreements: [] })
    expect(await enrol()).toEqual({ minorAgreement: true, unlocked: true })
    expect(logActivity).not.toHaveBeenCalled()
  })

  it('takes the youngest usable date of birth on the participant rows', async () => {
    db = fakeSupabase({
      members: [memberRow('teacher', null)],
      participants: [dobRow(ADULT_DOB, 'p-1'), dobRow(MINOR_DOB, 'p-2'), dobRow(FUTURE_DOB, 'p-3')],
      agreements: [],
    })
    expect((await enrol()).unlocked).toBe(false)
  })

  it('presumes a minor when no row has a usable date of birth', async () => {
    db = fakeSupabase({ members: [memberRow('teacher', FUTURE_DOB)], participants: [dobRow(FUTURE_DOB)], agreements: [] })
    expect((await enrol()).unlocked).toBe(false)
  })

  it("passes over an unusable date of birth on the member row to the participant rows'", async () => {
    db = fakeSupabase({ members: [memberRow('subscriber', FUTURE_DOB)], participants: [dobRow(ADULT_DOB)], agreements: [] })
    expect((await enrol()).unlocked).toBe(true)
  })

  it('a minor date of birth on the member row holds, whatever the participant rows say', async () => {
    db = fakeSupabase({ members: [memberRow('mentor', MINOR_DOB)], participants: [dobRow(ADULT_DOB)], agreements: [] })
    expect((await enrol()).unlocked).toBe(false)
  })

  it('an adult date of birth on the member row does not outrank a minor one on a participant row', async () => {
    // The member row is self-entered at onboarding; a registration wrote the
    // participant row. The younger reading wins, as for a login (mayLinkLogin),
    // so typing an adult date of birth into the profile changes nothing here.
    for (const [role, bracket] of [['participant', 'high_school'], ['parent', 'adult'], ['subscriber', 'adult']]) {
      logActivity.mockClear()
      db = fakeSupabase({ members: [memberRow(role, ADULT_DOB, bracket)], participants: [dobRow(MINOR_DOB)], agreements: [] })
      expect(await enrol(), role).toEqual({ minorAgreement: false, unlocked: false })
      expect(logActivity, role).toHaveBeenCalledTimes(1)
    }
  })

  it('still passes an adult on both rows, and ignores an unusable participant date of birth', async () => {
    db = fakeSupabase({
      members: [memberRow('teacher', ADULT_DOB)],
      participants: [dobRow(ADULT_DOB, 'p-1'), dobRow(FUTURE_DOB, 'p-2')],
      agreements: [],
    })
    expect(await enrol()).toEqual({ minorAgreement: true, unlocked: true })
  })

  it('lets that minor enrol once a completed agreement is on a participant row', async () => {
    db = fakeSupabase({
      members: [memberRow('parent', ADULT_DOB)],
      participants: [dobRow(MINOR_DOB, 'p-9')],
      agreements: [{ id: 'a-1', participant_id: 'p-9', envelope_type: 'minor', status: 'completed' }],
    })
    expect(await enrol()).toEqual({ minorAgreement: true, unlocked: true })
  })

  it('holds a student, or a placeholder subscriber, with no date of birth and no agreement', async () => {
    for (const [role, bracket] of [['participant', 'high_school'], ['school_student_manager', 'high_school'], ['subscriber', 'adult']]) {
      db = fakeSupabase({ members: [memberRow(role, null, bracket)], participants: [], agreements: [] })
      expect(await enrol(), role).toEqual({ minorAgreement: false, unlocked: false })
    }
    expect(logActivity).toHaveBeenCalledTimes(3)
  })

  it('does not take an adult role at its word when the bracket says high school', async () => {
    db = fakeSupabase({ members: [memberRow('mentor', null, 'high_school')], participants: [], agreements: [] })
    expect((await enrol()).unlocked).toBe(false)
  })

  it('holds an adult by role whose date of birth says under 18', async () => {
    db = fakeSupabase({ members: [memberRow('mentor', MINOR_DOB)], participants: [], agreements: [] })
    expect((await enrol()).unlocked).toBe(false)
  })

  it('holds a member with no row at all', async () => {
    db = fakeSupabase({ members: [], participants: [], agreements: [] })
    expect((await enrol()).unlocked).toBe(false)
  })

  it('lets a student with no date of birth enrol once a completed agreement is on file', async () => {
    db = fakeSupabase({
      members: [memberRow('participant', null, 'high_school')],
      participants: [{ id: 'p-9', member_id: MEMBER_ID }],
      agreements: [
        { id: 'a-1', participant_id: 'p-9', envelope_type: 'minor', status: 'sent' },
        { id: 'a-2', participant_id: 'p-9', envelope_type: 'minor', status: 'completed' },
      ],
    })
    expect(await enrol()).toEqual({ minorAgreement: true, unlocked: true })
    expect(logActivity).not.toHaveBeenCalled()
  })

  it('an agreement still out for signature is not on file', async () => {
    db = fakeSupabase({
      members: [memberRow('subscriber', null)],
      participants: [{ id: 'p-9', member_id: MEMBER_ID }],
      agreements: [{ id: 'a-1', participant_id: 'p-9', envelope_type: 'minor', status: 'sent' }],
    })
    expect((await enrol()).unlocked).toBe(false)
  })

  it("does not count a minor's own adult, mentor or educator agreement as a guardian's", async () => {
    // A child once sent an adult agreement to their own email and signed it has
    // given no guardian's consent (lib/guardian-consent, guardianAgreementOnFile).
    for (const type of ['adult', 'mentor', 'educator', 'volunteer']) {
      db = fakeSupabase({
        members: [memberRow('participant', MINOR_DOB, 'high_school')],
        participants: [dobRow(MINOR_DOB, 'p-9')],
        agreements: [{ id: 'a-1', participant_id: 'p-9', member_id: null, envelope_type: type, status: 'completed' }],
      })
      expect(await enrol(), type).toEqual({ minorAgreement: false, unlocked: false })
    }
  })

  it("lets a minor enrol on a guardian's membership agreement signed at member level", async () => {
    db = fakeSupabase({
      members: [memberRow('participant', MINOR_DOB, 'high_school')],
      participants: [],
      agreements: [{ id: 'a-1', participant_id: null, member_id: MEMBER_ID, envelope_type: 'minor', status: 'completed' }],
    })
    expect(await enrol()).toEqual({ minorAgreement: true, unlocked: true })
  })

  it("does not count another member's member-level agreement", async () => {
    db = fakeSupabase({
      members: [memberRow('participant', MINOR_DOB, 'high_school')],
      participants: [],
      agreements: [{ id: 'a-1', participant_id: null, member_id: 'member-2', envelope_type: 'minor', status: 'completed' }],
    })
    expect((await enrol()).unlocked).toBe(false)
  })

  it('lets anyone whose date of birth says adult enrol', async () => {
    db = fakeSupabase({ members: [memberRow('subscriber', ADULT_DOB)], participants: [], agreements: [] })
    expect((await enrol()).unlocked).toBe(true)
  })
})
