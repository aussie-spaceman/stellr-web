// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AGREEMENT_TITLE, planAgreement } from './plan'

afterEach(() => vi.useRealTimers())

describe('planAgreement', () => {
  it('puts the guardian first on a minor’s consent, and the student second, always', () => {
    const plan = planAgreement({
      type: 'minor',
      params: {
        minorFirstName: 'Sam', minorLastName: 'Rivera', minorEmail: 'SAM@Family.test', minorDateOfBirth: '2014-02-03',
        guardianName: 'Pat Rivera', guardianEmail: 'pat@family.test', eventTitle: 'Colorado SDC',
      },
    })
    expect(plan.signers.map((s) => [s.role, s.order, s.email])).toEqual([
      ['guardian', 1, 'pat@family.test'],
      ['student', 2, 'sam@family.test'],
    ])
    expect(plan.minorSubject).toBe(true)
    expect(plan.subjectBirthYear).toBe('2014')
    expect(plan.prefill.MinorDateOfBirth).toBe('03-Feb-2014')
  })

  it('has only the guardian sign when the student has no email', () => {
    const plan = planAgreement({
      type: 'minor',
      params: { minorFirstName: 'A', minorLastName: 'B', minorEmail: '', guardianName: 'P', guardianEmail: 'p@x.test', eventTitle: 'E' },
    })
    expect(plan.signers.map((s) => s.role)).toEqual(['guardian'])
    // The student's name still prints on the form.
    expect(plan.names.student).toBe('A B')
  })

  it('makes an adult’s membership agreement theirs alone', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-10-02T12:00:00Z'))
    const plan = planAgreement({
      type: 'membership',
      params: { memberId: 'm1', firstName: 'Ada', lastName: 'L', email: 'ada@x.test', dateOfBirth: '1990-01-01' },
    })
    expect(plan.templateKey).toBe('membership_adult')
    expect(plan.signers.map((s) => [s.role, s.memberId])).toEqual([['member', 'm1']])
    expect(plan.minorSubject).toBe(false)
  })

  it('has a Minor joining sign the Student / Minor agreement, parent first, and requires the parent', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-10-02T12:00:00Z'))
    const plan = planAgreement({
      type: 'membership',
      params: {
        memberId: 'm2', firstName: 'Kid', lastName: 'K', email: 'kid@x.test', dateOfBirth: '2012-06-01',
        grade: '9', guardianName: 'Parent K', guardianEmail: 'parent@x.test',
      },
    })
    // V2.3: one agreement covers membership and every event.
    expect(plan.templateKey).toBe('minor')
    expect(plan.label).toBe(AGREEMENT_TITLE.minor)
    expect(plan.signers.map((s) => [s.role, s.order, s.memberId])).toEqual([['guardian', 1, null], ['student', 2, 'm2']])
    expect(plan.prefill).toMatchObject({ MinorName: 'Kid K', MinorEmail: 'kid@x.test', MinorGrade: '9', MinorDateOfBirth: '01-Jun-2012' })

    expect(() => planAgreement({
      type: 'membership',
      params: { memberId: 'm3', firstName: 'Kid', lastName: 'K', email: 'kid@x.test', dateOfBirth: '2012-06-01' },
    })).toThrow(/parent or guardian/)
  })

  it('does not make Stellr a signer on the mentor agreement: it counter-signs automatically', () => {
    const plan = planAgreement({ type: 'volunteer', params: { firstName: 'M', lastName: 'N', email: 'm@x.test', eventTitle: 'E' } })
    expect(plan.templateKey).toBe('mentor')
    expect(plan.signers.map((s) => s.role)).toEqual(['mentor'])
  })

  it('adds a parent before a Mentor under the age of majority where they live (V2.3 §3A)', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-10-02T12:00:00Z'))
    const base = { firstName: 'M', lastName: 'N', email: 'm@x.test', eventTitle: 'E', dateOfBirth: '2008-01-01' }
    // 18 in Colorado: an adult, signs alone.
    expect(planAgreement({ type: 'mentor', params: { ...base, state: 'CO' } }).signers.map((s) => s.role)).toEqual(['mentor'])
    // 18 in Alabama, where majority is 19: a parent signs first.
    const al = planAgreement({
      type: 'mentor',
      params: { ...base, state: 'AL', guardianName: 'P N', guardianEmail: 'p@x.test', emergencyContactName: 'P N', emergencyContactPhone: '555' },
    })
    expect(al.signers.map((s) => [s.role, s.order])).toEqual([['guardian', 1], ['mentor', 2]])
    expect(al.minorSubject).toBe(true)
    expect(al.prefill).toMatchObject({ EmergencyContactName: 'P N', EmergencyContactPhone: '555' })
    expect(() => planAgreement({ type: 'mentor', params: { ...base, state: 'AL' } })).toThrow(/parent or guardian/)
  })
})
