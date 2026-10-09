// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { ownsTeam, teamViewerRole } from './team-access'

// deep review TEST-2: ownsTeam decides who can read/edit a group registration's
// full roster (minors' DOB, health, guardians). It grants the registrant and the
// nominated teacher POC, by member id OR by a case-insensitive email match. It
// had no test, so nothing proved it refuses a stranger, and — critically — that a
// null POC/teacher email does not match a member who also has no email.

const reg = {
  teacher_member_id: 'teacher-1',
  teacher_email: 'Teacher@School.test',
  teacher_poc_email: 'POC@School.test',
}

describe('ownsTeam', () => {
  it('grants the registrant by member id', () => {
    expect(ownsTeam({ id: 'teacher-1', email: 'other@x.test' }, reg)).toBe(true)
  })

  it('grants the registrant by email, case-insensitively', () => {
    expect(ownsTeam({ id: 'different-row', email: 'teacher@school.test' }, reg)).toBe(true)
  })

  it('grants the nominated teacher POC by email', () => {
    expect(ownsTeam({ id: 'poc-row', email: 'poc@school.test' }, reg)).toBe(true)
  })

  it('refuses a stranger who is neither the registrant nor the POC', () => {
    expect(ownsTeam({ id: 'stranger', email: 'someone@else.test' }, reg)).toBe(false)
  })

  it('does not treat a null teacher/POC email as matching a member with no email', () => {
    // The whole point of norm(): null === null must NOT read as ownership.
    const nullReg = { teacher_member_id: null, teacher_email: null, teacher_poc_email: null }
    expect(ownsTeam({ id: 'stranger', email: null }, nullReg)).toBe(false)
    expect(ownsTeam({ id: 'stranger', email: '' }, nullReg)).toBe(false)
  })

  it('does not treat a null member id as matching a null teacher_member_id', () => {
    const reg2 = { teacher_member_id: null, teacher_email: 't@x.test', teacher_poc_email: null }
    expect(ownsTeam({ id: 'stranger', email: 'nope@x.test' }, reg2)).toBe(false)
  })
})

describe('teamViewerRole', () => {
  it('labels the registrant teacher, the POC teacher_poc, and a stranger null', () => {
    expect(teamViewerRole({ id: 'teacher-1', email: null }, { ...reg, registrant_role: 'teacher' })).toBe('teacher')
    expect(teamViewerRole({ id: 'poc-row', email: 'poc@school.test' }, reg)).toBe('teacher_poc')
    expect(teamViewerRole({ id: 'stranger', email: 'x@y.test' }, reg)).toBe(null)
  })

  it('labels a student-manager registrant distinctly from a teacher', () => {
    expect(teamViewerRole({ id: 'teacher-1', email: null }, { ...reg, registrant_role: 'student_manager' }))
      .toBe('student_manager')
  })
})
