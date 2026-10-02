// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { planAgreement } from './plan'

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

  it('has a parent sign an under-18’s membership agreement first, and requires them', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-10-02T12:00:00Z'))
    const plan = planAgreement({
      type: 'membership',
      params: {
        memberId: 'm2', firstName: 'Kid', lastName: 'K', email: 'kid@x.test', dateOfBirth: '2012-06-01',
        guardianName: 'Parent K', guardianEmail: 'parent@x.test',
      },
    })
    expect(plan.templateKey).toBe('membership_minor')
    expect(plan.signers.map((s) => [s.role, s.order])).toEqual([['guardian', 1], ['member', 2]])

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
})
