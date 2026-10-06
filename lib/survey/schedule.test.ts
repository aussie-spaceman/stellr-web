import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  autoOpensAt,
  checkManualOpensAt,
  closesAtFor,
  dueReminder,
  effectiveStatus,
  eventLastDay,
  lateOpenDeadline,
  reconcileWithEvent,
  type CadenceInvitation,
  type ScheduleState,
} from './schedule'
import { eventTimeZone, localDate, zonedTimeToUtc } from './timezone'
import { ageOfMajority, isMinorPerPolicy, isSchoolGrade } from './minor'
import { hashToken, looksLikeToken, surveyToken } from './tokens'

const D = (s: string) => new Date(s)
const DAY = 86_400_000

describe('time zones', () => {
  it('derives the zone from the state, falling back to Denver', () => {
    expect(eventTimeZone({ state: 'Colorado' })).toBe('America/Denver')
    expect(eventTimeZone({ state: 'NE' })).toBe('America/Chicago')
    expect(eventTimeZone({ state: 'New York' })).toBe('America/New_York')
    expect(eventTimeZone({ state: 'Departamento de Maldonado', country: 'UY' })).toBe('America/Denver')
    expect(eventTimeZone({})).toBe('America/Denver')
  })

  it('finds local midnight across DST', () => {
    // Denver: MDT (UTC-6) in October, MST (UTC-7) in December.
    expect(zonedTimeToUtc('2026-10-10', 'America/Denver').toISOString()).toBe('2026-10-10T06:00:00.000Z')
    expect(zonedTimeToUtc('2026-12-05', 'America/Denver').toISOString()).toBe('2026-12-05T07:00:00.000Z')
    expect(zonedTimeToUtc('2026-11-01', 'America/New_York').toISOString()).toBe('2026-11-01T04:00:00.000Z')
    expect(localDate(D('2026-10-10T05:59:00Z'), 'America/Denver')).toBe('2026-10-09')
  })
})

describe('schedule', () => {
  it('goes live at 00:00 event-local on the last day of a multi-day event', () => {
    expect(eventLastDay({ date: '2026-10-09', endDate: '2026-10-10' })).toBe('2026-10-10')
    expect(eventLastDay({ date: '2026-10-09' })).toBe('2026-10-09')
    expect(eventLastDay({})).toBeNull()
    expect(autoOpensAt('2026-10-10', 'America/Chicago').toISOString()).toBe('2026-10-10T05:00:00.000Z')
  })

  it('closes exactly 30 days after go-live', () => {
    expect(closesAtFor(D('2026-10-10T06:00:00Z')).toISOString()).toBe('2026-11-09T06:00:00.000Z')
  })

  it('allows an earlier go-live, refuses a later one or one in the past', () => {
    const auto = D('2026-10-10T06:00:00Z')
    const now = D('2026-10-05T12:00:00Z')
    expect(checkManualOpensAt(D('2026-10-08T15:00:00Z'), auto, now)).toEqual({ ok: true, opensAt: D('2026-10-08T15:00:00Z') })
    expect(checkManualOpensAt(now, auto, now).ok).toBe(true) // "Send live now"
    expect(checkManualOpensAt(D('2026-10-11T00:00:00Z'), auto, now)).toEqual({ ok: false, error: 'later_than_event' })
    expect(checkManualOpensAt(D('2026-10-04T00:00:00Z'), auto, now)).toEqual({ ok: false, error: 'in_past' })
    expect(checkManualOpensAt(D('nonsense'), auto, now)).toEqual({ ok: false, error: 'invalid' })
  })

  const base: ScheduleState = {
    status: 'scheduled',
    opens_at: '2026-10-10T06:00:00.000Z',
    closes_at: '2026-11-09T06:00:00.000Z',
    opens_at_source: 'auto',
    event_date: '2026-10-10',
    event_time_zone: 'America/Denver',
    schedule_flag: null,
  }

  it('reschedules an automatic go-live when the event date moves', () => {
    expect(reconcileWithEvent(base, { lastDay: '2026-10-17', timeZone: 'America/Denver', cancelled: false })).toEqual({
      event_date: '2026-10-17',
      event_time_zone: 'America/Denver',
      opens_at: '2026-10-17T06:00:00.000Z',
    })
    expect(reconcileWithEvent(base, { lastDay: '2026-10-10', timeZone: 'America/Denver', cancelled: false })).toEqual({})
  })

  it('keeps a manual go-live and flags it when the event date moves', () => {
    const manual = { ...base, opens_at_source: 'manual' as const, opens_at: '2026-10-08T15:00:00.000Z' }
    expect(reconcileWithEvent(manual, { lastDay: '2026-10-17', timeZone: 'America/Denver', cancelled: false })).toEqual({
      event_date: '2026-10-17',
      event_time_zone: 'America/Denver',
      schedule_flag: 'event_date_changed',
    })
  })

  it('does not move a survey that is already open', () => {
    const open = { ...base, status: 'open' as const }
    expect(reconcileWithEvent(open, { lastDay: '2026-10-17', timeZone: 'America/Denver', cancelled: false })).not.toHaveProperty('opens_at')
  })

  it('pauses a scheduled survey for a cancelled event', () => {
    expect(reconcileWithEvent(base, { lastDay: '2026-10-10', timeZone: 'America/Denver', cancelled: true })).toEqual({
      status: 'paused',
      schedule_flag: 'event_cancelled',
    })
  })

  it('opens when due and closes when expired', () => {
    expect(effectiveStatus(base, D('2026-10-10T05:59:00Z'))).toBe('scheduled')
    expect(effectiveStatus(base, D('2026-10-10T06:00:00Z'))).toBe('open')
    expect(effectiveStatus({ ...base, status: 'open' }, D('2026-11-09T06:00:00Z'))).toBe('closed')
    expect(effectiveStatus({ ...base, status: 'paused' }, D('2026-10-20T00:00:00Z'))).toBe('paused')
  })
})

describe('reminder cadence', () => {
  const dist = { status: 'open' as const, opens_at: '2026-10-10T06:00:00.000Z', closes_at: '2026-11-09T06:00:00.000Z' }
  const opens = new Date(dist.opens_at).getTime()
  const at = (days: number) => new Date(opens + days * DAY + 3600_000)
  const inv = (over: Partial<CadenceInvitation> = {}): CadenceInvitation => ({
    status: 'sent',
    sent_at: dist.opens_at,
    reminder_count: 0,
    resume_reminder_count: 0,
    last_reminder_at: null,
    reminders_opted_out_at: null,
    ...over,
  })

  it('nudges on day 3 and day 7, then closing 3 days before close', () => {
    expect(dueReminder(inv(), dist, at(2))).toBeNull()
    expect(dueReminder(inv(), dist, at(3))).toBe('nudge')
    expect(dueReminder(inv({ reminder_count: 1, last_reminder_at: at(3).toISOString() }), dist, at(6))).toBeNull()
    expect(dueReminder(inv({ reminder_count: 1, last_reminder_at: at(3).toISOString() }), dist, at(7))).toBe('nudge')
    expect(dueReminder(inv({ reminder_count: 2, last_reminder_at: at(7).toISOString() }), dist, at(20))).toBeNull()
    expect(dueReminder(inv({ reminder_count: 2, last_reminder_at: at(7).toISOString() }), dist, at(27))).toBe('closing')
    expect(dueReminder(inv({ reminder_count: 3, last_reminder_at: at(27).toISOString() }), dist, at(29))).toBeNull()
  })

  it('stops for opted-out, submitted, bounced, and after close', () => {
    expect(dueReminder(inv({ reminders_opted_out_at: at(1).toISOString() }), dist, at(3))).toBeNull()
    expect(dueReminder(inv({ status: 'submitted' }), dist, at(3))).toBeNull()
    expect(dueReminder(inv({ status: 'bounced' }), dist, at(3))).toBeNull()
    expect(dueReminder(inv({ reminder_count: 2 }), dist, at(31))).toBeNull()
    expect(dueReminder(inv(), { ...dist, status: 'paused' }, at(3))).toBeNull()
  })

  it('counts from a late invitation, and goes straight to closing near the end', () => {
    const late = inv({ sent_at: at(10).toISOString() })
    expect(dueReminder(late, dist, at(12))).toBeNull()
    expect(dueReminder(late, dist, at(13))).toBe('nudge')
    const veryLate = inv({ sent_at: at(26).toISOString() })
    expect(dueReminder(veryLate, dist, at(26.5))).toBeNull() // invited less than a day ago
    expect(dueReminder(veryLate, dist, at(27.5))).toBe('closing')
  })

  it('reminds a started draft 48 h after the last save, at most twice', () => {
    const started = inv({ status: 'started' })
    expect(dueReminder(started, dist, at(5), at(4).toISOString())).toBeNull()
    expect(dueReminder(started, dist, at(6.1), at(4).toISOString())).toBe('resume')
    expect(dueReminder(inv({ status: 'started', resume_reminder_count: 1, last_reminder_at: at(6.1).toISOString() }), dist, at(7), at(4).toISOString())).toBeNull()
    expect(dueReminder(inv({ status: 'started', resume_reminder_count: 1, last_reminder_at: at(6.1).toISOString() }), dist, at(8.2), at(4).toISOString())).toBe('resume')
    expect(dueReminder(inv({ status: 'started', resume_reminder_count: 2 }), dist, at(20), at(4).toISOString())).toBeNull()
  })
})

describe('opening after the event', () => {
  const tz = 'America/Denver'
  const lastDay = '2026-10-04' // 00:00 MDT = 06:00Z

  it('is allowed from the last day until its automatic window would have closed', () => {
    expect(lateOpenDeadline(lastDay, tz, D('2026-10-04T05:59:00Z'))).toBeNull()
    expect(lateOpenDeadline(lastDay, tz, D('2026-10-06T18:00:00Z'))?.toISOString()).toBe('2026-11-03T06:00:00.000Z')
    expect(lateOpenDeadline(lastDay, tz, D('2026-11-03T05:59:00Z'))).not.toBeNull()
    expect(lateOpenDeadline(lastDay, tz, D('2026-11-03T06:00:00Z'))).toBeNull()
  })

  it('gives a full 30 days from the late opening', () => {
    const now = D('2026-10-06T18:00:00Z')
    expect(closesAtFor(now).getTime() - now.getTime()).toBe(30 * DAY)
  })
})

describe('minor rule', () => {
  it('uses the state age of majority', () => {
    expect(ageOfMajority('Alabama')).toBe(19)
    expect(ageOfMajority('NE')).toBe(19)
    expect(ageOfMajority('Mississippi')).toBe(21)
    expect(ageOfMajority('CO')).toBe(18)
    expect(ageOfMajority(null)).toBe(18)
    const on = '2026-10-10'
    expect(isMinorPerPolicy({ dateOfBirth: '2008-01-01', state: 'CO' }, on)).toBe(false) // 18
    expect(isMinorPerPolicy({ dateOfBirth: '2008-01-01', state: 'NE' }, on)).toBe(true) // 18 < 19
    expect(isMinorPerPolicy({ dateOfBirth: '2006-01-01', state: 'MS' }, on)).toBe(true) // 20 < 21
  })

  it('counts anyone still in school, and presumes students with no DOB are minors', () => {
    expect(isMinorPerPolicy({ dateOfBirth: '2007-01-01', state: 'CO', grade: 'grade_12' }, '2026-10-10')).toBe(true)
    expect(isMinorPerPolicy({ dateOfBirth: '2007-01-01', state: 'CO', ageBracket: 'high_school' }, '2026-10-10')).toBe(true)
    expect(isMinorPerPolicy({ dateOfBirth: null, state: 'CO', presumeMinorIfUnknown: true })).toBe(true)
    expect(isMinorPerPolicy({ dateOfBirth: null, state: 'CO' })).toBe(false)
    expect(isMinorPerPolicy({ dateOfBirth: '1990-01-01', state: 'CO', isWard: true })).toBe(true)
    expect(isSchoolGrade('11')).toBe(true)
    expect(isSchoolGrade('11th')).toBe(true)
    expect(isSchoolGrade('college_freshman')).toBe(false)
  })
})

describe('tokens', () => {
  const prev = process.env.SURVEY_TOKEN_SECRET
  beforeEach(() => {
    process.env.SURVEY_TOKEN_SECRET = 'x'.repeat(40)
  })
  afterEach(() => {
    process.env.SURVEY_TOKEN_SECRET = prev
  })

  it('derives a stable token per invitation and version, stores only a hash', () => {
    const t1 = surveyToken('11111111-1111-1111-1111-111111111111', 1)
    expect(looksLikeToken(t1)).toBe(true)
    expect(surveyToken('11111111-1111-1111-1111-111111111111', 1)).toBe(t1)
    expect(surveyToken('11111111-1111-1111-1111-111111111111', 2)).not.toBe(t1)
    expect(hashToken(t1)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashToken(t1)).not.toContain(t1)
    expect(looksLikeToken('../../etc')).toBe(false)
  })

  it('refuses a short secret', () => {
    process.env.SURVEY_TOKEN_SECRET = 'short'
    const prevEsign = process.env.ESIGN_TOKEN_SECRET
    delete process.env.ESIGN_TOKEN_SECRET
    expect(() => surveyToken('a', 1)).toThrow()
    if (prevEsign !== undefined) process.env.ESIGN_TOKEN_SECRET = prevEsign
  })
})
