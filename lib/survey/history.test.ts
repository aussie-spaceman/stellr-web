import { describe, expect, it } from 'vitest'
import {
  responseBelongsTo,
  surveyChipsByEvent,
  surveyRoleLabel,
  surveyStatusOf,
  toMemberSurveyItems,
  unloggedSubmissions,
  type MemberSurveyRow,
} from './history'

const NOW = new Date('2026-11-10T12:00:00Z')

const row = (over: Partial<MemberSurveyRow> = {}, dist: Partial<MemberSurveyRow['distribution']> = {}): MemberSurveyRow => ({
  invitationId: 'i1',
  status: 'sent',
  role: 'student',
  adultRelationship: null,
  sendVia: 'self',
  invitedAt: '2026-11-01T06:00:00Z',
  responseId: null,
  submittedAt: null,
  ...over,
  distribution: {
    id: 'd1',
    eventSlug: 'co-sdc-2026',
    eventTitle: 'Colorado SDC 2026',
    status: 'open',
    opensAt: '2026-11-01T06:00:00Z',
    closesAt: '2026-12-01T06:00:00Z',
    ...dist,
  },
})

describe('survey status on the admin member page', () => {
  it('follows the invitation while the survey is open', () => {
    expect(surveyStatusOf(row({ status: 'queued' }), NOW)).toBe('invited')
    expect(surveyStatusOf(row({ status: 'sent' }), NOW)).toBe('invited')
    expect(surveyStatusOf(row({ status: 'opened' }), NOW)).toBe('opened')
    expect(surveyStatusOf(row({ status: 'started' }), NOW)).toBe('started')
    expect(surveyStatusOf(row({ status: 'bounced' }), NOW)).toBe('bounced')
  })

  it('reads a submission as submitted, even after the survey closed', () => {
    expect(surveyStatusOf(row({ status: 'submitted', responseId: 'r1', submittedAt: '2026-11-05T00:00:00Z' }), NOW)).toBe('submitted')
    expect(surveyStatusOf(row({ status: 'started', responseId: 'r1', submittedAt: '2026-11-05T00:00:00Z' }, { status: 'closed' }), NOW)).toBe('submitted')
  })

  it('reads an unanswered survey as closed once it has closed or the invitation expired', () => {
    expect(surveyStatusOf(row({ status: 'started' }, { status: 'closed' }), NOW)).toBe('closed')
    // Past closes_at but the cron hasn't flipped it yet.
    expect(surveyStatusOf(row({ status: 'opened' }, { closesAt: '2026-11-09T00:00:00Z' }), NOW)).toBe('closed')
    expect(surveyStatusOf(row({ status: 'expired' }), NOW)).toBe('closed')
  })

  it('labels the role, and says when it went to a guardian', () => {
    expect(surveyRoleLabel(row())).toBe('Student')
    expect(surveyRoleLabel(row({ sendVia: 'guardian' }))).toBe('Student (sent to guardian)')
    expect(surveyRoleLabel(row({ role: 'mentor' }))).toBe('Mentor')
    expect(surveyRoleLabel(row({ role: 'adult', adultRelationship: 'parent' }))).toBe('Parent')
    expect(surveyRoleLabel(row({ role: 'adult', adultRelationship: 'teacher' }))).toBe('Teacher')
    expect(surveyRoleLabel(row({ role: 'adult' }))).toBe('Adult')
  })

  it('maps rows to panel items with a label', () => {
    const [item] = toMemberSurveyItems([row({ status: 'submitted', responseId: 'r1', submittedAt: '2026-11-05T00:00:00Z' })], NOW)
    expect(item).toEqual({
      invitationId: 'i1',
      eventTitle: 'Colorado SDC 2026',
      role: 'Student',
      status: 'submitted',
      statusLabel: 'Submitted',
      invitedAt: '2026-11-01T06:00:00Z',
      submittedAt: '2026-11-05T00:00:00Z',
      responseId: 'r1',
    })
    expect(toMemberSurveyItems([row({}, { eventTitle: null })], NOW)[0].eventTitle).toBe('co-sdc-2026')
  })
})

describe('survey chips on the account event history', () => {
  it('links a submitted survey to its answers', () => {
    expect(surveyChipsByEvent([row({ status: 'submitted', responseId: 'r1', submittedAt: '2026-11-05T00:00:00Z' })], NOW)).toEqual({
      'co-sdc-2026': { kind: 'submitted', responseId: 'r1' },
    })
  })

  it('offers an open survey, start or finish', () => {
    expect(surveyChipsByEvent([row()], NOW)['co-sdc-2026']).toEqual({ kind: 'open', invitationId: 'i1', started: false })
    expect(surveyChipsByEvent([row({ status: 'started' })], NOW)['co-sdc-2026']).toEqual({ kind: 'open', invitationId: 'i1', started: true })
  })

  it('shows nothing for a survey closed unanswered, not yet open, or expired', () => {
    expect(surveyChipsByEvent([row({}, { status: 'closed' })], NOW)).toEqual({})
    expect(surveyChipsByEvent([row({}, { status: 'scheduled', opensAt: '2026-11-20T06:00:00Z', closesAt: '2026-12-20T06:00:00Z' })], NOW)).toEqual({})
    expect(surveyChipsByEvent([row({ status: 'expired' })], NOW)).toEqual({})
  })

  it('prefers a submission over another open invitation for the same event', () => {
    const open = row({ invitationId: 'i2' })
    const done = row({ invitationId: 'i1', status: 'submitted', responseId: 'r1', submittedAt: '2026-11-05T00:00:00Z' })
    expect(surveyChipsByEvent([open, done], NOW)['co-sdc-2026']).toEqual({ kind: 'submitted', responseId: 'r1' })
    expect(surveyChipsByEvent([done, open], NOW)['co-sdc-2026']).toEqual({ kind: 'submitted', responseId: 'r1' })
  })

  it('keys each event separately', () => {
    const chips = surveyChipsByEvent([row(), row({ invitationId: 'i2' }, { id: 'd2', eventSlug: 'nv-sdc-2026' })], NOW)
    expect(Object.keys(chips).sort()).toEqual(['co-sdc-2026', 'nv-sdc-2026'])
  })
})

describe('response ownership', () => {
  it('matches on the account or on one of the member’s participant rows', () => {
    expect(responseBelongsTo({ memberId: 'm1', participantId: null }, 'm1', [])).toBe(true)
    expect(responseBelongsTo({ memberId: null, participantId: 'p1' }, 'm1', ['p1'])).toBe(true)
    expect(responseBelongsTo({ memberId: 'm2', participantId: 'p2' }, 'm1', ['p1'])).toBe(false)
    expect(responseBelongsTo({ memberId: null, participantId: null }, 'm1', [])).toBe(false)
  })
})

describe('late-linked submissions', () => {
  it('returns only the responses without a survey_submitted entry', () => {
    const responses = [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }]
    expect(unloggedSubmissions(responses, ['r2'])).toEqual([{ id: 'r1' }, { id: 'r3' }])
  })

  it('is idempotent: once logged, nothing is returned again', () => {
    const responses = [{ id: 'r1' }]
    const first = unloggedSubmissions(responses, [])
    expect(first).toEqual([{ id: 'r1' }])
    expect(unloggedSubmissions(responses, first.map((r) => r.id))).toEqual([])
  })
})
