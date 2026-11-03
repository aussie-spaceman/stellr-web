import { describe, it, expect } from 'vitest'
import { appToday } from '@/lib/age'
import { guardianAgreementOnFile, mayLinkLogin, memberAgeFacts, youngestDob } from './guardian-consent'

// The COPPA rule for linking a login made outside the app (a self-serve Clerk
// sign-up) to a member row: the Clerk webhook and onboarding both ask this.

/** A date of birth `n` years before the app's today. */
const yearsAgo = (n: number) => {
  const d = appToday()
  d.setUTCFullYear(d.getUTCFullYear() - n)
  return d.toISOString().slice(0, 10)
}

/** participants and agreement types for one member; `failAgreements` makes the agreements read error. */
function fakeDb(participants: Array<{ id: string; date_of_birth: string | null }>, agreements: string[], failAgreements = false) {
  return {
    from(table: string) {
      let type: unknown
      const chain: Record<string, unknown> = {
        select: () => chain, or: () => chain,
        eq: (c: string, v: unknown) => { if (c === 'envelope_type') type = v; return chain },
        then: (f: (v: unknown) => unknown) => Promise.resolve(
          table === 'participants'
            ? { data: participants, error: null }
            : failAgreements
              ? { count: null, error: { message: 'down' } }
              : { count: agreements.filter((t) => t === type).length, error: null },
        ).then(f),
      }
      return chain
    },
  } as never
}

describe('youngestDob', () => {
  it('picks the latest usable date and ignores the rest', () => {
    expect(youngestDob(['1990-01-01', null, 'nope', '2014-06-01T00:00:00Z', '2999-01-01'])).toBe('2014-06-01')
    expect(youngestDob([null, '', undefined])).toBeNull()
  })
})

describe('memberAgeFacts', () => {
  const parts = [{ id: 'p-1', date_of_birth: yearsAgo(15) }, { id: 'p-2', date_of_birth: '2999-01-01' }]

  it("dateOfBirth prefers the member row's; youngestDateOfBirth takes the youngest of every row", async () => {
    expect(await memberAgeFacts(fakeDb(parts, []), { id: 'm', date_of_birth: yearsAgo(40) })).toEqual({
      dateOfBirth: yearsAgo(40),
      youngestDateOfBirth: yearsAgo(15),
      participantIds: ['p-1', 'p-2'],
    })
  })

  it('a minor member row is still the youngest when the participant rows say adult', async () => {
    const facts = await memberAgeFacts(fakeDb([{ id: 'p-1', date_of_birth: yearsAgo(40) }], []), { id: 'm', date_of_birth: yearsAgo(15) })
    expect(facts.youngestDateOfBirth).toBe(yearsAgo(15))
  })

  it('skips unusable dates, and is null when none is usable', async () => {
    expect((await memberAgeFacts(fakeDb(parts, []), { id: 'm', date_of_birth: null })).youngestDateOfBirth).toBe(yearsAgo(15))
    expect((await memberAgeFacts(fakeDb([{ id: 'p-1', date_of_birth: '2999-01-01' }], []), { id: 'm', date_of_birth: 'nope' })).youngestDateOfBirth).toBeNull()
  })
})

describe('mayLinkLogin', () => {
  it('allows 13 and over on the date of birth', async () => {
    expect(await mayLinkLogin(fakeDb([], []), { id: 'm', date_of_birth: yearsAgo(13) })).toEqual({ allowed: true, basis: 'dob' })
  })

  it('holds a child under 13, or an unknown age, until a guardian has signed', async () => {
    expect(await mayLinkLogin(fakeDb([], []), { id: 'm', date_of_birth: yearsAgo(12) })).toEqual({ allowed: false, reason: 'under_13' })
    expect(await mayLinkLogin(fakeDb([], []), { id: 'm', date_of_birth: null })).toEqual({ allowed: false, reason: 'age_unknown' })
    expect(await mayLinkLogin(fakeDb([], ['minor']), { id: 'm', date_of_birth: yearsAgo(12) })).toEqual({ allowed: true, basis: 'guardian_agreement' })
  })

  it('takes the younger of the date on file and the one just given', async () => {
    expect(await mayLinkLogin(fakeDb([], []), { id: 'm', date_of_birth: yearsAgo(30) }, yearsAgo(12))).toMatchObject({ allowed: false })
    expect(await mayLinkLogin(fakeDb([], []), { id: 'm', date_of_birth: yearsAgo(12) }, yearsAgo(30))).toMatchObject({ allowed: false })
  })

  it('with no member row, only the answer given counts and no agreement can be on file', async () => {
    expect(await mayLinkLogin(fakeDb([], ['minor']), null, yearsAgo(30))).toEqual({ allowed: true, basis: 'dob' })
    expect(await mayLinkLogin(fakeDb([], ['minor']), null, yearsAgo(12))).toEqual({ allowed: false, reason: 'under_13' })
  })
})

describe('guardianAgreementOnFile', () => {
  it("counts only a completed guardian's form, and a read error is a no", async () => {
    expect(await guardianAgreementOnFile(fakeDb([], ['adult', 'mentor']), { memberId: 'm' })).toBe(false)
    expect(await guardianAgreementOnFile(fakeDb([], ['minor']), { memberId: 'm' })).toBe(true)
    expect(await guardianAgreementOnFile(fakeDb([], ['minor'], true), { memberId: 'm' })).toBe(false)
    expect(await guardianAgreementOnFile(fakeDb([], ['minor']), {})).toBe(false)
  })
})
