// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

// legal-credential-family-link.7: membership agreement selection reads "Minor"
// the way credentials do (holderMinorFacts + isMinorPerPolicy), with the
// member's state, and hands that state to the native plan.

const h = vi.hoisted(() => ({ dispatchTyped: vi.fn(async (..._a: unknown[]) => ({ outcome: 'issued' })) }))
vi.mock('@/lib/env', () => ({ SITE_URL: 'https://www.stellreducation.org' }))
vi.mock('@/lib/docusign-agreements', () => ({
  agreementValid: () => true,
  dispatchTyped: h.dispatchTyped,
}))

import { dispatchMembershipAgreement, membershipMinor } from './membership-agreement'
import { schoolYearOf } from './credentials'

interface Member {
  date_of_birth: string | null
  grade?: string | null
  age_bracket?: string | null
  updated_at?: string | null
  ec_email?: string | null
  ec_first_name?: string | null
  ec_last_name?: string | null
  ec_relationship?: string | null
}

function makeDb(member: Member, state: string | null | undefined, opts: { factsError?: boolean } = {}) {
  const full = {
    id: 'm1', first_name: 'Member', last_name: 'One', email: 'member@example.test', phone: null,
    grade: null, age_bracket: 'unknown', updated_at: null, ec_first_name: null, ec_last_name: null, ec_email: null,
    ec_phone: null, ec_relationship: null, ...member,
  }
  return {
    from(table: string) {
      const q: Record<string, unknown> = {}
      Object.assign(q, {
        select: () => q, eq: () => q, in: () => q, order: () => q,
        limit: () => {
          if (table === 'member_schools') {
            return Promise.resolve(opts.factsError
              ? { data: null, error: { message: 'down' } }
              : { data: state === undefined ? [] : [{ is_current: true, schools: { state } }], error: null })
          }
          return q
        },
        maybeSingle: async () => {
          if (table === 'members') return { data: full, error: null }
          // No agreement on file and none in flight.
          return { data: null, error: null }
        },
      })
      return q
    },
  } as unknown as Parameters<typeof dispatchMembershipAgreement>[0]
}

function bornYearsAgo(years: number): string {
  const d = new Date()
  d.setUTCFullYear(d.getUTCFullYear() - years)
  d.setUTCMonth(d.getUTCMonth() - 3)
  return d.toISOString().slice(0, 10)
}
const guardian = { ec_email: 'guardian@example.test', ec_first_name: 'Guardian', ec_last_name: 'One', ec_relationship: 'Parent' }
const lastSchoolYear = `${schoolYearOf(new Date()) - 1}-10-01T00:00:00Z`
const params = () => h.dispatchTyped.mock.calls[0][3] as Record<string, unknown>

beforeEach(() => h.dispatchTyped.mockClear())

describe('dispatchMembershipAgreement: Minor per the policy', () => {
  it('an 18-year-old at a Nebraska school signs as a Minor, with the parent and the state passed on', async () => {
    const out = await dispatchMembershipAgreement(makeDb({ date_of_birth: bornYearsAgo(18), ...guardian }, 'NE'), 'm1')
    expect(out).toEqual({ outcome: 'issued' })
    expect(params()).toMatchObject({ memberId: 'm1', state: 'NE', guardianName: 'Guardian One', guardianEmail: 'guardian@example.test' })
  })

  it('an 18-year-old in Nebraska with no guardian on file is not issued the adult document instead', async () => {
    expect(await dispatchMembershipAgreement(makeDb({ date_of_birth: bornYearsAgo(18) }, 'NE'), 'm1')).toEqual({ outcome: 'not_required' })
    expect(h.dispatchTyped).not.toHaveBeenCalled()
  })

  it('an 18-year-old in Colorado signs as an adult, with the state passed on', async () => {
    await dispatchMembershipAgreement(makeDb({ date_of_birth: bornYearsAgo(18), ...guardian }, 'CO'), 'm1')
    expect(params()).toMatchObject({ state: 'CO' })
    expect(params()).not.toHaveProperty('guardianEmail')
  })

  it('an 18-year-old still in school (grade recorded this school year) signs as a Minor', async () => {
    const now = new Date().toISOString()
    await dispatchMembershipAgreement(makeDb({ date_of_birth: bornYearsAgo(18), grade: 'grade_12', updated_at: now, ...guardian }, 'CO'), 'm1')
    expect(params()).toMatchObject({ guardianEmail: 'guardian@example.test', grade: '12' })
  })

  it('a grade from an earlier school year does not: the date of birth decides', async () => {
    await dispatchMembershipAgreement(makeDb({ date_of_birth: bornYearsAgo(25), grade: 'grade_12', updated_at: lastSchoolYear, ...guardian }, 'CO'), 'm1')
    expect(params()).not.toHaveProperty('guardianEmail')
  })
})

describe('dispatchMembershipAgreement: the emergency contact must be a parent or guardian', () => {
  const warn = () => vi.spyOn(console, 'warn').mockImplementation(() => {})

  it('an 18-year-old at a Nebraska school whose emergency contact is a spouse is not issued anything', async () => {
    const log = warn()
    const out = await dispatchMembershipAgreement(makeDb({ date_of_birth: bornYearsAgo(18), ...guardian, ec_relationship: 'Spouse' }, 'NE'), 'm1')
    expect(out).toEqual({ outcome: 'not_required' })
    expect(h.dispatchTyped).not.toHaveBeenCalled()
    // members.id only: no name or email in the log.
    expect(log.mock.calls[0][0]).toContain('m1')
    expect(log.mock.calls[0][0]).not.toMatch(/@|Guardian/)
    log.mockRestore()
  })

  it('a 20-year-old at a Mississippi school whose emergency contact is a friend, or not given, is not issued anything', async () => {
    const log = warn()
    for (const ec_relationship of ['Friend', 'Grandparent', null]) {
      expect(await dispatchMembershipAgreement(makeDb({ date_of_birth: bornYearsAgo(20), ...guardian, ec_relationship }, 'MS'), 'm1'))
        .toEqual({ outcome: 'not_required' })
    }
    expect(h.dispatchTyped).not.toHaveBeenCalled()
    log.mockRestore()
  })

  it('a Minor whose parent contact email is their own address is not issued anything', async () => {
    const log = warn()
    expect(await dispatchMembershipAgreement(makeDb({ date_of_birth: bornYearsAgo(20), ...guardian, ec_email: ' Member@Example.test ' }, 'MS'), 'm1'))
      .toEqual({ outcome: 'not_required' })
    expect(h.dispatchTyped).not.toHaveBeenCalled()
    log.mockRestore()
  })

  it('a 20-year-old in Mississippi with a parent contact, and a 15-year-old with a legal guardian, are issued the Minor document', async () => {
    await dispatchMembershipAgreement(makeDb({ date_of_birth: bornYearsAgo(20), ...guardian }, 'MS'), 'm1')
    expect(params()).toMatchObject({ state: 'MS', guardianEmail: 'guardian@example.test', relationship: 'Parent' })
    h.dispatchTyped.mockClear()
    await dispatchMembershipAgreement(makeDb({ date_of_birth: bornYearsAgo(15), ...guardian, ec_relationship: 'Legal Guardian' }, 'CO'), 'm1')
    expect(params()).toMatchObject({ guardianEmail: 'guardian@example.test', relationship: 'Legal Guardian' })
  })

  it('an adult’s emergency contact is never asked to sign: the adult document goes to the member', async () => {
    await dispatchMembershipAgreement(makeDb({ date_of_birth: bornYearsAgo(30), ...guardian, ec_relationship: 'Spouse' }, 'MS'), 'm1')
    expect(params()).not.toHaveProperty('guardianEmail')
  })
})

describe('membershipMinor', () => {
  it('falls back to under 18 by the date of birth when the records cannot be read', async () => {
    expect(await membershipMinor(makeDb({ date_of_birth: bornYearsAgo(18) }, 'NE', { factsError: true }), { id: 'm1', date_of_birth: bornYearsAgo(18) }))
      .toEqual({ minor: false, state: null })
    expect(await membershipMinor(makeDb({ date_of_birth: null }, 'NE', { factsError: true }), { id: 'm1', date_of_birth: null }))
      .toEqual({ minor: true, state: null })
  })
  it('a 20-year-old at a Mississippi school is a Minor', async () => {
    expect(await membershipMinor(makeDb({ date_of_birth: bornYearsAgo(20) }, 'MS'), { id: 'm1', date_of_birth: bornYearsAgo(20) }))
      .toEqual({ minor: true, state: 'MS' })
  })
})
