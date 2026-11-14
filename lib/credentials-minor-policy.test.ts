// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/env', () => ({ SITE_URL: 'https://www.stellreducation.org' }))
vi.mock('@/lib/docusign-agreements', () => ({
  agreementValid: (row: { completed_at: string | null }) => !!row.completed_at,
}))

import {
  gradeIsCurrent,
  holderIsMinor,
  holderMinorFacts,
  issuedEmailRoute,
  readMinorConsent,
  consentForMinor,
  schoolYearOf,
  shareConsentFor,
  shareConsentOrUnreadable,
  unpublishCredentialsFor,
  type CredentialRow,
} from './credentials'

// legal-credential-family-link.5 (stale grade), .6 (held email) and the strict
// consent read the daily sweep uses (.4).

interface Person { date_of_birth?: string | null; grade?: string | null; age_bracket?: string | null; updated_at?: string | null; created_at?: string | null }
interface People { member?: Person; participant?: Person; state?: string | null; error?: boolean; agreement?: { completed_at: string; opt_out?: boolean } | 'error' }

function makeDb(people: People) {
  return {
    from(table: string) {
      const err = people.error ? { message: 'down' } : null
      const data =
        table === 'members' ? people.member ?? null
        : table === 'participants' ? people.participant ?? null
        : table === 'member_schools' ? (people.state === undefined ? [] : [{ is_current: true, schools: { state: people.state } }])
        : null
      const agreement = async () =>
        people.agreement === 'error'
          ? { data: null, error: { message: 'down' } }
          : { data: people.agreement ? { id: 'a1', completed_at: people.agreement.completed_at, credential_sharing_opt_out: !!people.agreement.opt_out, reused_from: null } : null, error: null }
      const q: Record<string, unknown> = {}
      Object.assign(q, {
        select: () => q, eq: () => q, or: () => q, order: () => q,
        // member_schools ends at limit(); agreements goes on to maybeSingle().
        limit: () => (table === 'agreements' ? q : Promise.resolve({ data: err ? null : data, error: err })),
        maybeSingle: async () => (table === 'agreements' ? agreement() : { data: err ? null : data, error: err }),
      })
      return q
    },
  } as unknown as Parameters<typeof holderMinorFacts>[0]
}

function bornYearsAgo(years: number): string {
  const d = new Date()
  d.setUTCFullYear(d.getUTCFullYear() - years)
  d.setUTCMonth(d.getUTCMonth() - 3)
  return d.toISOString().slice(0, 10)
}

const thisYear = schoolYearOf(new Date())
const lastSchoolYear = `${thisYear - 1}-10-01T00:00:00Z`
const now = new Date().toISOString()

function row(over: Partial<CredentialRow> = {}): CredentialRow {
  return {
    id: 'c1', number: 'STL-2026-7K3MQ8ZD', source: 'course', member_id: 'm1', participant_id: null,
    module_id: 'mod1', event_slug: null, recipient_name: 'Student', title: 'Course', description: null, criteria: null,
    skills: [], issuer: 'Stellr Academy', role_label: null, award: null, award_type: null, theme: 'space', badge_path: null,
    pd_hours: null, standards: [], activity_title: null, activity_date: null, activity_location: null,
    issued_at: '2026-09-01T00:00:00Z', expires_at: null, status: 'issued', revoked_at: null, revoked_reason: null,
    tombstoned_at: null, visibility: 'public', is_minor: false, ...over,
  }
}

describe('schoolYearOf / gradeIsCurrent', () => {
  it('starts the school year in July', () => {
    expect(schoolYearOf('2026-06-30')).toBe(2025)
    expect(schoolYearOf('2026-07-01T00:00:00Z')).toBe(2026)
    expect(schoolYearOf(new Date('2027-02-01T12:00:00Z'))).toBe(2026)
  })
  it('a grade recorded in an earlier school year is not current; none recorded keeps it', () => {
    const today = new Date('2026-11-14T12:00:00Z')
    expect(gradeIsCurrent('2026-08-20T10:00:00Z', today)).toBe(true)
    expect(gradeIsCurrent('2026-06-01T10:00:00Z', today)).toBe(false)
    expect(gradeIsCurrent(null, today)).toBe(true)
    expect(gradeIsCurrent('garbage', today)).toBe(true)
  })
})

describe('holderMinorFacts: a stale grade or bracket is unknown', () => {
  it('drops the member’s grade and bracket when the row was last written in an earlier school year', async () => {
    const db = makeDb({ member: { date_of_birth: '2000-01-01', grade: 'grade_12', age_bracket: 'high_school', updated_at: lastSchoolYear }, state: 'CO' })
    expect(await holderMinorFacts(db, { memberId: 'm1', participantId: null })).toEqual({
      dateOfBirth: '2000-01-01', grade: null, ageBracket: null, state: 'CO',
    })
  })
  it('keeps a grade written this school year, and a participant’s from a registration this year', async () => {
    const db = makeDb({
      member: { grade: null, age_bracket: 'unknown', updated_at: lastSchoolYear },
      participant: { grade: '12', age_bracket: 'high_school', created_at: now },
    })
    expect(await holderMinorFacts(db, { memberId: 'm1', participantId: 'p1' })).toMatchObject({ grade: '12', ageBracket: 'high_school' })
  })
  it('drops a participant’s grade from an earlier school year’s registration', async () => {
    const db = makeDb({ participant: { date_of_birth: null, grade: '12', age_bracket: 'high_school', created_at: lastSchoolYear } })
    expect(await holderMinorFacts(db, { memberId: null, participantId: 'p1' })).toMatchObject({ grade: null, ageBracket: null })
  })
})

describe('shareConsentFor with a stale grade (.5)', () => {
  it('the DOB decides: a 25-year-old whose grade 12 is from last school year needs no consent', async () => {
    const db = makeDb({ member: { date_of_birth: bornYearsAgo(25), grade: 'grade_12', updated_at: lastSchoolYear }, state: 'CO' })
    expect(await shareConsentFor(db, row())).toBe('not_required')
  })
  it('a grade 12 recorded this school year still makes an 18-year-old a Minor (still in school)', async () => {
    const db = makeDb({ member: { date_of_birth: bornYearsAgo(18), grade: 'grade_12', updated_at: now }, state: 'CO' })
    expect(await shareConsentFor(db, row())).toBe('none')
  })
  it('with no DOB, a stale grade is unknown and the page stays private', async () => {
    const db = makeDb({ member: { date_of_birth: null, grade: 'grade_12', updated_at: lastSchoolYear } })
    expect(await shareConsentFor(db, row())).toBe('dob_unknown')
  })
})

describe('holderIsMinor with a stale grade (who the email goes to)', () => {
  it('a graduate with no DOB whose grade is from last school year hears directly', async () => {
    const db = makeDb({ member: { date_of_birth: null, grade: 'grade_12', age_bracket: 'high_school', updated_at: lastSchoolYear } })
    expect(await holderIsMinor(db, row())).toBe(false)
  })
  it('the same record written this school year still goes to the guardian', async () => {
    const db = makeDb({ member: { date_of_birth: null, grade: 'grade_12', updated_at: now } })
    expect(await holderIsMinor(db, row())).toBe(true)
  })
})

describe('the strict consent read for the sweep', () => {
  it('tells a failed consent read apart; consentForMinor still folds it into none', async () => {
    const db = makeDb({ agreement: 'error' })
    expect(await readMinorConsent(db, { memberId: 'm1', participantId: null })).toBe('unreadable')
    expect(await consentForMinor(db, { memberId: 'm1', participantId: null })).toBe('none')
  })
  it('answers unreadable for a failed records read or consent read, where shareConsentFor fails closed', async () => {
    const minor = { member: { date_of_birth: bornYearsAgo(16), updated_at: now } }
    expect(await shareConsentOrUnreadable(makeDb({ error: true }), row())).toBe('unreadable')
    expect(await shareConsentOrUnreadable(makeDb({ ...minor, agreement: 'error' }), row())).toBe('unreadable')
    expect(await shareConsentFor(makeDb({ ...minor, agreement: 'error' }), row())).toBe('none')
    expect(await shareConsentOrUnreadable(makeDb({ ...minor, agreement: { completed_at: now } }), row())).toBe('granted')
    expect(await shareConsentOrUnreadable(makeDb({ ...minor, agreement: { completed_at: now, opt_out: true } }), row())).toBe('declined')
    expect(await shareConsentOrUnreadable(makeDb({ member: { date_of_birth: bornYearsAgo(40) } }), row())).toBe('not_required')
  })
})

describe('unpublishCredentialsFor throwOnError', () => {
  function failing() {
    const q = {
      update: () => q, or: () => q, eq: () => q, is: () => q,
      select: async () => ({ data: null, error: { message: 'write failed' } }),
    }
    return { from: () => q } as unknown as Parameters<typeof unpublishCredentialsFor>[0]
  }
  it('throws for the sweep, and only logs for the opt-out path', async () => {
    await expect(unpublishCredentialsFor(failing(), { memberId: 'm1', participantId: null }, { throwOnError: true })).rejects.toThrow(/unpublish failed/)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(unpublishCredentialsFor(failing(), { memberId: 'm1', participantId: null })).resolves.toEqual([])
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })
})

describe('issuedEmailRoute (.6)', () => {
  const to = { email: 'student@example.test', guardianEmail: 'guardian@example.test', guardianFirstName: 'Guardian' }
  it('an adult hears directly', () => {
    expect(issuedEmailRoute(false, to)).toEqual({ kind: 'direct', to: 'student@example.test' })
  })
  it('a Minor’s guardian is the addressee, the Minor copied', () => {
    expect(issuedEmailRoute(true, to)).toEqual({ kind: 'guardian', to: 'guardian@example.test', cc: 'student@example.test' })
    expect(issuedEmailRoute(true, { ...to, email: null })).toEqual({ kind: 'guardian', to: 'guardian@example.test', cc: null })
  })
  it('a Minor with no guardian name or email is held, never written to directly', () => {
    expect(issuedEmailRoute(true, { ...to, guardianEmail: null })).toEqual({ kind: 'hold' })
    expect(issuedEmailRoute(true, { ...to, guardianFirstName: '' })).toEqual({ kind: 'hold' })
  })
  it('nobody to write to is none', () => {
    expect(issuedEmailRoute(false, { email: null })).toEqual({ kind: 'none' })
  })
})
