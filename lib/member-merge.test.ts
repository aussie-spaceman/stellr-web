import { describe, it, expect } from 'vitest'
import {
  defaultSurvivor,
  fieldsToWrite,
  proposeMerge,
  validateMergeChoice,
  type MergeMember,
} from '@/lib/member-merge'
import { isLikelySchoolEmail, primaryEmail, resolveEmailPair, showsSchoolEmail } from '@/lib/member-email'

// The shape of the case that prompted this (4 Nov 2026): a student added first
// under a school address (with a login, guardian and history), then again
// under a personal address with fewer details.
function older(over: Partial<MergeMember> = {}): MergeMember {
  return {
    id: 'a', membership_id: '0000001', clerk_user_id: 'user_a',
    created_at: '2026-10-30T07:52:32Z', updated_at: '2026-10-30T07:52:34Z',
    first_name: 'Sam', last_name: 'Student', date_of_birth: '2011-05-12', gender: 'female',
    email: 'sam.student@nv.ccsd.net', school_email: null, phone: '555-0100',
    ec_first_name: 'Pat', ec_last_name: 'Parent', ec_email: 'pat@example.com', ec_phone: '555-0101', ec_relationship: 'Parent',
    tshirt_size: 'S', grade: 'grade_10', event_role: 'participant', age_bracket: 'high_school',
    ...over,
  }
}
function newer(over: Partial<MergeMember> = {}): MergeMember {
  return {
    id: 'b', membership_id: '0000009', clerk_user_id: null,
    created_at: '2026-11-04T05:53:51Z', updated_at: '2026-11-04T05:53:51Z',
    first_name: 'Sam', last_name: 'Student', date_of_birth: '2011-05-12', gender: 'female',
    email: 'sam.student@gmail.com', school_email: null, phone: '555-0199',
    ec_first_name: null, ec_last_name: null, ec_email: null, ec_phone: null, ec_relationship: null,
    tshirt_size: 'S', grade: 'grade_10', event_role: 'participant', age_bracket: 'high_school',
    ...over,
  }
}

describe('defaultSurvivor', () => {
  it('keeps the older record whichever order they come in', () => {
    expect(defaultSurvivor(newer(), older()).keep.id).toBe('a')
    expect(defaultSurvivor(older(), newer()).drop.id).toBe('b')
  })
})

describe('proposeMerge', () => {
  const { fields } = proposeMerge(older(), newer())

  it('is additive: a blank field takes the other record\'s value', () => {
    expect(fields.ec_first_name).toMatchObject({ source: 'keep', value: 'Pat', reason: 'only_keep' })
    const reverse = proposeMerge(newer({ phone: null }), older()).fields
    expect(reverse.phone).toMatchObject({ source: 'drop', value: '555-0100', reason: 'only_drop' })
  })

  it('takes the more recently updated record when both have a value', () => {
    expect(fields.phone).toMatchObject({ source: 'drop', value: '555-0199', reason: 'newer' })
  })

  it('sorts the addresses: personal is primary, the school one goes to school_email', () => {
    expect(fields.email).toMatchObject({ value: 'sam.student@gmail.com', source: 'drop' })
    expect(fields.school_email).toMatchObject({ value: 'sam.student@nv.ccsd.net', source: 'keep' })
  })

  it('keeps the survivor\'s login, and inherits the other only when it has none', () => {
    expect(fields.clerk_user_id).toMatchObject({ source: 'keep', value: 'user_a' })
    const noLogin = proposeMerge(older({ clerk_user_id: null }), newer({ clerk_user_id: 'user_b' })).fields
    expect(noLogin.clerk_user_id).toMatchObject({ source: 'drop', value: 'user_b' })
  })

  it('uses the school address as primary when neither looks personal', () => {
    const f = proposeMerge(older(), newer({ email: 'sam@student.k12.nv.us' })).fields
    expect(f.email.value).toMatch(/@/)
    expect(f.school_email.value).not.toBe(f.email.value)
  })
})

describe('fieldsToWrite', () => {
  it('writes only what changes on the survivor, normalising emails', () => {
    const out = fieldsToWrite(older(), {
      first_name: 'Sam', email: ' Sam.Student@Gmail.com ', school_email: 'sam.student@nv.ccsd.net', phone: '555-0199',
    })
    expect(out).toEqual({ email: 'sam.student@gmail.com', school_email: 'sam.student@nv.ccsd.net', phone: '555-0199' })
  })

  it('never stores the same address as both personal and school', () => {
    const out = fieldsToWrite(older(), { email: 'sam.student@gmail.com', school_email: 'sam.student@gmail.com' })
    expect(out.school_email).toBeNull()
  })
})

describe('validateMergeChoice', () => {
  it('refuses a blank or malformed primary email and unknown columns', () => {
    expect(validateMergeChoice({ email: '' }, older()).ok).toBe(false)
    expect(validateMergeChoice({ email: 'nope' }, older()).ok).toBe(false)
    expect(validateMergeChoice({ membership_id: 'x' }, older()).ok).toBe(false)
    expect(validateMergeChoice({ email: 'ok@example.com' }, older()).ok).toBe(true)
  })
})

describe('member-email', () => {
  it('personal takes primacy; school is the fallback', () => {
    expect(primaryEmail(' P@x.com ', 's@school.edu')).toBe('p@x.com')
    expect(primaryEmail('', 'S@School.edu')).toBe('s@school.edu')
    expect(resolveEmailPair({ email: '', school_email: 's@school.edu' })).toEqual({ email: 's@school.edu', school_email: 's@school.edu' })
    expect(resolveEmailPair({ email: 'p@x.com', school_email: '' })).toEqual({ email: 'p@x.com', school_email: null })
  })

  it('asks for the pair only for a known date of birth under 18', () => {
    expect(showsSchoolEmail('2011-05-12')).toBe(true)
    expect(showsSchoolEmail('1990-01-01')).toBe(false)
    expect(showsSchoolEmail('')).toBe(false)
    expect(showsSchoolEmail(null)).toBe(false)
  })

  it('recognises common school domains, not personal ones', () => {
    for (const e of ['a@nv.ccsd.net', 'a@student.dpsk12.org', 'a@school.k12.co.us', 'a@uni.edu', 'a@x.edu.au', 'a@students.example.org']) {
      expect(isLikelySchoolEmail(e)).toBe(true)
    }
    for (const e of ['a@gmail.com', 'a@outlook.com', 'a@icloud.com', 'a@proton.me']) {
      expect(isLikelySchoolEmail(e)).toBe(false)
    }
  })
})
