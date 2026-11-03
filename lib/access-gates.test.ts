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
    db = fakeSupabase({ participants: [participant('participant', ADULT_DOB)], agreements: [] })
    expect((await eventAccessGates(member, SLUG)).docusign).toBe(true)
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

const enrol = () => reportEnrollmentGate({ id: MEMBER_ID }, { kind: 'cohort', containerId: 'cohort-1', containerName: 'Rocketry' })

describe('reportEnrollmentGate', () => {
  it('lets an adult by role with no date of birth enrol without an agreement', async () => {
    for (const role of ['mentor', 'volunteer', 'teacher', 'parent']) {
      db = fakeSupabase({ members: [memberRow(role, null)], participants: [], agreements: [] })
      expect(await enrol(), role).toEqual({ minorAgreement: true, unlocked: true })
    }
    expect(logActivity).not.toHaveBeenCalled()
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
        { id: 'a-1', participant_id: 'p-9', status: 'sent' },
        { id: 'a-2', participant_id: 'p-9', status: 'completed' },
      ],
    })
    expect(await enrol()).toEqual({ minorAgreement: true, unlocked: true })
    expect(logActivity).not.toHaveBeenCalled()
  })

  it('an agreement still out for signature is not on file', async () => {
    db = fakeSupabase({
      members: [memberRow('subscriber', null)],
      participants: [{ id: 'p-9', member_id: MEMBER_ID }],
      agreements: [{ id: 'a-1', participant_id: 'p-9', status: 'sent' }],
    })
    expect((await enrol()).unlocked).toBe(false)
  })

  it('lets anyone whose date of birth says adult enrol', async () => {
    db = fakeSupabase({ members: [memberRow('subscriber', ADULT_DOB)], participants: [], agreements: [] })
    expect((await enrol()).unlocked).toBe(true)
  })
})
