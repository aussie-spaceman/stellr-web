import { describe, it, expect } from 'vitest'
import {
  BC_REQUIRED_ROLES,
  STUDENT_ROLES,
  deriveCompliance,
  requiresBackgroundCheck,
  type BackgroundCheck,
  type TeacherLicense,
} from './compliance'

// Who needs clearance, and what their pill says. The role list was narrowed on
// 21 Sept 2026 from "every non-student adult" to event-facing roles only, so
// the negative cases (subscriber, parent, unknown) are the point of this file.

const ADULT = '1983-02-10' // the runbook's mock-candidate DOB
const MINOR = new Date(Date.now() - 16 * 365.25 * 24 * 3600 * 1000).toISOString().slice(0, 10)

describe('requiresBackgroundCheck', () => {
  for (const role of BC_REQUIRED_ROLES) {
    it(`${role}: required when 18+, not when a minor`, () => {
      expect(requiresBackgroundCheck(role, ADULT)).toBe(true)
      expect(requiresBackgroundCheck(role, MINOR)).toBe(false)
    })
  }

  for (const role of STUDENT_ROLES) {
    it(`${role}: never required, even at 18+`, () => {
      expect(requiresBackgroundCheck(role, ADULT)).toBe(false)
    })
  }

  it('subscriber and parent are exempt (they do not attend events)', () => {
    expect(requiresBackgroundCheck('subscriber', ADULT)).toBe(false)
    expect(requiresBackgroundCheck('parent', ADULT)).toBe(false)
  })

  it('an unknown or empty role is NOT required (the rule is opt-in by role)', () => {
    expect(requiresBackgroundCheck(null, ADULT)).toBe(false)
    expect(requiresBackgroundCheck('', ADULT)).toBe(false)
    expect(requiresBackgroundCheck('wizard', ADULT)).toBe(false)
  })

  it('is case-insensitive on role', () => {
    expect(requiresBackgroundCheck('Mentor', ADULT)).toBe(true)
  })

  it('unknown DOB is treated as an adult (safer to require)', () => {
    expect(requiresBackgroundCheck('mentor', null)).toBe(true)
  })

  it('evaluates age as of the event date when given', () => {
    const turns18 = new Date()
    turns18.setFullYear(turns18.getFullYear() - 18)
    turns18.setDate(turns18.getDate() + 30) // 18 in 30 days
    const dob = turns18.toISOString().slice(0, 10)
    const eventIn60Days = new Date(Date.now() + 60 * 86400000).toISOString()
    expect(requiresBackgroundCheck('mentor', dob)).toBe(false)
    expect(requiresBackgroundCheck('mentor', dob, eventIn60Days)).toBe(true)
  })
})

function check(over: Partial<BackgroundCheck>): BackgroundCheck {
  return {
    id: 'c1',
    status: 'invited',
    result: null,
    assessment: null,
    includes_canceled: false,
    provider_report_ref: null,
    ordered_at: '2026-09-01T00:00:00Z',
    completed_at: null,
    expires_at: null,
    report_pdf_url: null,
    adjudicated_at: null,
    adjudication_outcome: null,
    adjudicated_label: null,
    adjudication_notes: null,
    provider_adjudication: null,
    ...over,
  }
}
function license(over: Partial<TeacherLicense>): TeacherLicense {
  return {
    id: 'l1',
    license_number: '123',
    licensing_state: 'UT',
    expiry_date: '2030-01-01',
    verified_at: null,
    verified_label: null,
    document_path: null,
    ...over,
  }
}
const inYears = (n: number) => {
  const d = new Date()
  d.setFullYear(d.getFullYear() + n)
  return d.toISOString()
}

describe('deriveCompliance', () => {
  it('not_required short-circuits for exempt roles even with records on file', () => {
    const s = deriveCompliance(null, [check({ status: 'referred' })], 'subscriber', ADULT)
    expect(s.state).toBe('not_required')
  })

  it('nothing on file → invalid', () => {
    expect(deriveCompliance(null, [], 'mentor', ADULT).state).toBe('invalid')
  })

  it('passed + unexpired → valid_bc, with the canceled-screenings note when flagged', () => {
    const plain = deriveCompliance(null, [check({ status: 'passed', expires_at: inYears(2) })], 'mentor', ADULT)
    expect(plain.state).toBe('valid_bc')
    expect(plain.detail).not.toMatch(/canceled/)
    const alex = deriveCompliance(
      null,
      [check({ status: 'passed', expires_at: inYears(2), includes_canceled: true })],
      'mentor',
      ADULT,
    )
    expect(alex.state).toBe('valid_bc')
    expect(alex.detail).toMatch(/completed with canceled screenings/)
  })

  it('passed but expired → invalid (3-year validity is Stellr-enforced)', () => {
    expect(deriveCompliance(null, [check({ status: 'passed', expires_at: inYears(-1) })], 'mentor', ADULT).state).toBe('invalid')
  })

  it('verified unexpired license → valid_license; unverified → in_process; expired → invalid', () => {
    expect(deriveCompliance(license({ verified_at: '2026-01-01T00:00:00Z' }), [], 'teacher', ADULT).state).toBe('valid_license')
    expect(deriveCompliance(license({}), [], 'teacher', ADULT).state).toBe('in_process')
    expect(deriveCompliance(license({ verified_at: '2026-01-01T00:00:00Z', expiry_date: '2020-01-01' }), [], 'teacher', ADULT).state).toBe('invalid')
  })

  it('invited / in_progress → in_process; referred → invalid; cancelled and expired are their own states', () => {
    const at = (status: BackgroundCheck['status']) => deriveCompliance(null, [check({ status })], 'mentor', ADULT).state
    expect(at('invited')).toBe('in_process')
    expect(at('in_progress')).toBe('in_process')
    expect(at('referred')).toBe('flagged')
    expect(at('cancelled')).toBe('cancelled')
    expect(at('expired')).toBe('expired')
    expect(at('error')).toBe('invalid')
  })

  it('a flagged (Consider) check is NOT cleared and is its own state', () => {
    const s = deriveCompliance(null, [check({ status: 'referred' })], 'mentor', ADULT)
    expect(s.state).toBe('flagged')
    expect(s.detail).toMatch(/awaiting review/i)
  })

  it('adjudicated cleared makes them compliant, using the expiry on the row', () => {
    const s = deriveCompliance(
      null,
      [check({
        status: 'referred',
        adjudicated_at: '2026-09-22T00:00:00Z',
        adjudication_outcome: 'cleared',
        adjudicated_label: 'David Shaw',
        expires_at: inYears(3),
      })],
      'mentor',
      ADULT,
    )
    expect(s.state).toBe('valid_bc')
    expect(s.detail).toMatch(/cleared on review by David Shaw/i)
  })

  it('adjudicated cleared but past its expiry is not compliant', () => {
    const s = deriveCompliance(
      null,
      [check({ status: 'referred', adjudicated_at: '2020-01-01T00:00:00Z', adjudication_outcome: 'cleared', expires_at: inYears(-1) })],
      'mentor',
      ADULT,
    )
    expect(s.state).toBe('invalid')
  })

  it('adjudicated not_cleared is invalid and says who decided', () => {
    const s = deriveCompliance(
      null,
      [check({
        status: 'referred',
        adjudicated_at: '2026-09-22T00:00:00Z',
        adjudication_outcome: 'not_cleared',
        adjudicated_label: 'David Shaw',
      })],
      'mentor',
      ADULT,
    )
    expect(s.state).toBe('invalid')
    expect(s.detail).toMatch(/not cleared on review by David Shaw/i)
  })

  it('a verified license still clears someone whose check is flagged', () => {
    const s = deriveCompliance(
      license({ verified_at: '2026-01-01T00:00:00Z' }),
      [check({ status: 'referred' })],
      'teacher',
      ADULT,
    )
    expect(s.state).toBe('valid_license')
  })

  it('a valid clearance beats an in-process item, which beats a lapsed one', () => {
    const s = deriveCompliance(
      license({ verified_at: '2026-01-01T00:00:00Z' }),
      [check({ status: 'invited' })],
      'teacher',
      ADULT,
    )
    expect(s.state).toBe('valid_license')
  })

  it('uses the NEWEST check by ordered_at, not the array order', () => {
    const s = deriveCompliance(
      null,
      [
        check({ id: 'new', status: 'invited', ordered_at: '2026-09-10T00:00:00Z' }),
        check({ id: 'old', status: 'referred', ordered_at: '2026-01-01T00:00:00Z' }),
      ],
      'mentor',
      ADULT,
    )
    expect(s.check?.id).toBe('new')
    expect(s.state).toBe('in_process')
  })
})
