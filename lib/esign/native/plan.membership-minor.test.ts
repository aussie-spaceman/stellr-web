// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { membershipIsMinor, planAgreement, type MembershipPlanParams } from './plan'

// legal-credential-family-link.7: the membership agreement reads "Minor" by the
// policy rule credentials use (under the age of majority in the member's state,
// or still in school), not under 18 alone.

afterEach(() => vi.useRealTimers())

const at = () => vi.useFakeTimers().setSystemTime(new Date('2026-11-14T12:00:00Z'))
const base = { memberId: 'm1', firstName: 'Kid', lastName: 'K', email: 'kid@example.test' }
const parent = { guardianName: 'Parent K', guardianEmail: 'parent@example.test' }
// 18 on 14 Nov 2026.
const EIGHTEEN = '2008-06-01'

function plan(p: Partial<MembershipPlanParams>) {
  return planAgreement({ type: 'membership', params: { ...base, ...p } as MembershipPlanParams })
}

describe('membership agreement: Minor per the policy', () => {
  it('an 18-year-old in Nebraska or Alabama signs the Student / Minor agreement, parent first', () => {
    at()
    for (const state of ['NE', 'Alabama']) {
      const out = plan({ dateOfBirth: EIGHTEEN, state, ...parent })
      expect(out.templateKey).toBe('minor')
      expect(out.signers.map((s) => s.role)).toEqual(['guardian', 'student'])
    }
  })

  it('and without a parent on the request, it is refused rather than sent as the adult document', () => {
    at()
    expect(() => plan({ dateOfBirth: EIGHTEEN, state: 'NE' })).toThrow(/parent or guardian/)
  })

  it('a 20-year-old in Mississippi is a Minor; at 21 they are not', () => {
    at()
    expect(membershipIsMinor({ ...base, dateOfBirth: '2006-06-01', state: 'MS' })).toBe(true)
    expect(membershipIsMinor({ ...base, dateOfBirth: '2005-06-01', state: 'MS' })).toBe(false)
  })

  it('an 18-year-old in Colorado signs the adult document, unless still in school', () => {
    at()
    expect(plan({ dateOfBirth: EIGHTEEN, state: 'CO' }).templateKey).toBe('adult')
    expect(membershipIsMinor({ ...base, dateOfBirth: EIGHTEEN, state: 'CO', grade: '12' })).toBe(true)
    expect(plan({ dateOfBirth: EIGHTEEN, state: 'CO', grade: '12', ...parent }).templateKey).toBe('minor')
  })

  it('guardian details on the request mean a Minor, as dispatchTyped records it', () => {
    at()
    expect(plan({ dateOfBirth: EIGHTEEN, ...parent }).templateKey).toBe('minor')
  })

  it('with no state, 18 is the age of majority, as before', () => {
    at()
    expect(plan({ dateOfBirth: EIGHTEEN }).templateKey).toBe('adult')
    expect(membershipIsMinor({ ...base, dateOfBirth: '2009-06-01' })).toBe(true)
  })
})
