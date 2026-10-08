import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { matchByEmail, matchByNameAndDob, normaliseName, signCheckIn, verifyCheckIn, type CheckInCandidate } from './check-in'

const person = (over: Partial<CheckInCandidate>): CheckInCandidate => ({
  id: over.id ?? 'p',
  first_name: 'Alexander',
  last_name: 'Smith',
  nickname: null,
  date_of_birth: '2011-04-09',
  email: 'parent@example.com',
  ...over,
})

describe('normaliseName', () => {
  it('ignores case, accents, spaces and punctuation', () => {
    expect(normaliseName("  O'Brien-Núñez ")).toBe('obriennunez')
    expect(normaliseName('Van der Berg')).toBe('vanderberg')
    expect(normaliseName(null)).toBe('')
  })
})

describe('matchByNameAndDob', () => {
  const alex = person({ id: 'a' })

  it('matches exact name and DOB', () => {
    expect(matchByNameAndDob([alex], { firstName: 'Alexander', lastName: 'Smith', dob: '2011-04-09' })).toEqual({
      kind: 'match',
      candidate: alex,
    })
  })

  it('accepts a short form of the first name or the nickname, not a 1–2 letter prefix', () => {
    expect(matchByNameAndDob([alex], { firstName: 'alex', lastName: 'SMITH', dob: '2011-04-09' }).kind).toBe('match')
    const sasha = person({ id: 's', nickname: 'Sasha' })
    expect(matchByNameAndDob([sasha], { firstName: 'Sasha', lastName: 'Smith', dob: '2011-04-09' }).kind).toBe('match')
    expect(matchByNameAndDob([alex], { firstName: 'Al', lastName: 'Smith', dob: '2011-04-09' }).kind).toBe('none')
  })

  it('refuses a wrong DOB or wrong last name', () => {
    expect(matchByNameAndDob([alex], { firstName: 'Alexander', lastName: 'Smith', dob: '2011-04-10' }).kind).toBe('none')
    expect(matchByNameAndDob([alex], { firstName: 'Alexander', lastName: 'Smyth', dob: '2011-04-09' }).kind).toBe('none')
    expect(matchByNameAndDob([alex], { firstName: 'Alexander', lastName: 'Smith', dob: '9/4/2011' }).kind).toBe('none')
  })

  it('tells two people with the same name apart by DOB', () => {
    const other = person({ id: 'b', date_of_birth: '2010-01-01' })
    const m = matchByNameAndDob([alex, other], { firstName: 'Alexander', lastName: 'Smith', dob: '2010-01-01' })
    expect(m).toEqual({ kind: 'match', candidate: other })
  })

  it('sends the same person twice (same name and DOB) to the desk', () => {
    const twin = person({ id: 'b' })
    expect(matchByNameAndDob([alex, twin], { firstName: 'Alexander', lastName: 'Smith', dob: '2011-04-09' }).kind).toBe(
      'ambiguous'
    )
  })

  it('asks for the email when the matching name has no DOB on file', () => {
    const noDob = person({ id: 'n', date_of_birth: null })
    expect(matchByNameAndDob([noDob], { firstName: 'Alexander', lastName: 'Smith', dob: '2011-04-09' }).kind).toBe(
      'need_email'
    )
  })
})

describe('matchByEmail', () => {
  it('is case-insensitive and trims', () => {
    const a = person({ id: 'a', email: 'Parent@Example.com ' })
    expect(matchByEmail([a], ' parent@example.COM')?.id).toBe('a')
    expect(matchByEmail([a], 'nobody@example.com')).toBeNull()
  })
})

describe('check-in cookie', () => {
  const id = '3f1c2b9e-1d2a-4c5b-9e8f-0a1b2c3d4e5f'
  beforeEach(() => vi.stubEnv('CREDENTIAL_LINK_SECRET', 'x'.repeat(32)))
  afterEach(() => vi.unstubAllEnvs())

  it('round-trips for the same event only', () => {
    const v = signCheckIn('colorado', id)!
    expect(verifyCheckIn('colorado', v)).toBe(id)
    expect(verifyCheckIn('nevada', v)).toBeNull()
  })

  it('rejects tampering and junk', () => {
    const v = signCheckIn('colorado', id)!
    const other = '3f1c2b9e-1d2a-4c5b-9e8f-0a1b2c3d4e50'
    expect(verifyCheckIn('colorado', `${other}${v.slice(id.length)}`)).toBeNull()
    expect(verifyCheckIn('colorado', 'nonsense')).toBeNull()
    expect(verifyCheckIn('colorado', undefined)).toBeNull()
  })

  it('is off without a secret', () => {
    vi.stubEnv('CREDENTIAL_LINK_SECRET', '')
    vi.stubEnv('SURVEY_TOKEN_SECRET', '')
    vi.stubEnv('ESIGN_TOKEN_SECRET', '')
    expect(signCheckIn('colorado', id)).toBeNull()
    expect(verifyCheckIn('colorado', `${id}.abc`)).toBeNull()
  })
})
