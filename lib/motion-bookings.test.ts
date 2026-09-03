import { describe, expect, it } from 'vitest'
import {
  formatStart,
  isLiveBooking,
  matchesBookingTitle,
  selectGuestEmails,
  type CalendarEventLike,
} from './motion-bookings'

const ORGANISER = 'david.shaw@stellreducation.org'

function event(over: Partial<CalendarEventLike> = {}): CalendarEventLike {
  return {
    id: 'evt1',
    summary: 'Welcome To Stellr Events with David',
    status: 'confirmed',
    start: { dateTime: '2026-09-10T15:30:00Z' },
    organizer: { email: ORGANISER },
    attendees: [
      { email: ORGANISER, organizer: true, self: true },
      { email: 'alex@school.org', responseStatus: 'accepted' },
    ],
    ...over,
  }
}

describe('selectGuestEmails', () => {
  it('returns the visitor and not the organiser', () => {
    expect(selectGuestEmails(event())).toEqual(['alex@school.org'])
  })

  it('excludes the organiser even when not flagged as such on the attendee row', () => {
    // Google is inconsistent about setting `organizer`/`self` on attendees, so
    // the organiser address is denied on its own account. Without this the
    // webhook stamps "call booked" on our own contact record.
    const e = event({
      attendees: [
        { email: ORGANISER },
        { email: 'parent@example.com' },
      ],
    })
    expect(selectGuestEmails(e)).toEqual(['parent@example.com'])
  })

  it('is case-insensitive about exclusions', () => {
    const e = event({
      organizer: { email: 'David.Shaw@StellrEducation.org' },
      attendees: [{ email: 'DAVID.SHAW@stellreducation.ORG' }, { email: 'Alex@School.org' }],
    })
    expect(selectGuestEmails(e)).toEqual(['alex@school.org'])
  })

  it('honours extra excluded addresses', () => {
    const e = event({
      attendees: [
        { email: ORGANISER, organizer: true },
        { email: 'hello@stellreducation.org' },
        { email: 'alex@school.org' },
      ],
    })
    expect(selectGuestEmails(e, ['hello@stellreducation.org'])).toEqual(['alex@school.org'])
  })

  it('skips meeting rooms and equipment', () => {
    const e = event({
      attendees: [
        { email: ORGANISER, organizer: true },
        { email: 'room-4@resource.calendar.google.com', resource: true },
        { email: 'alex@school.org' },
      ],
    })
    expect(selectGuestEmails(e)).toEqual(['alex@school.org'])
  })

  it('skips someone who declined — that is not a booked call', () => {
    const e = event({
      attendees: [
        { email: ORGANISER, organizer: true },
        { email: 'nope@school.org', responseStatus: 'declined' },
        { email: 'alex@school.org', responseStatus: 'needsAction' },
      ],
    })
    expect(selectGuestEmails(e)).toEqual(['alex@school.org'])
  })

  it('deduplicates a repeated attendee', () => {
    const e = event({
      attendees: [{ email: 'alex@school.org' }, { email: 'Alex@school.org' }],
    })
    expect(selectGuestEmails(e)).toEqual(['alex@school.org'])
  })

  it('returns nothing for an event with no attendees at all', () => {
    expect(selectGuestEmails(event({ attendees: null }))).toEqual([])
    expect(selectGuestEmails(event({ attendees: [] }))).toEqual([])
  })

  it('ignores malformed addresses rather than passing them to HubSpot', () => {
    const e = event({ attendees: [{ email: 'not-an-address' }, { email: null }, { email: 'a@b.org' }] })
    expect(selectGuestEmails(e)).toEqual(['a@b.org'])
  })

  it('returns every guest when a booking has more than one', () => {
    const e = event({
      attendees: [
        { email: ORGANISER, organizer: true },
        { email: 'parent@example.com' },
        { email: 'student@example.com' },
      ],
    })
    expect(selectGuestEmails(e)).toEqual(['parent@example.com', 'student@example.com'])
  })
})

describe('isLiveBooking', () => {
  it('rejects a cancelled event', () => {
    // showDeleted is on so a cancellation comes back and can be filtered
    // deliberately, rather than looking like it never existed.
    expect(isLiveBooking(event({ status: 'cancelled' }))).toBe(false)
    expect(isLiveBooking(event({ status: 'confirmed' }))).toBe(true)
  })
})

describe('matchesBookingTitle', () => {
  it('matches case-insensitively on a substring', () => {
    expect(matchesBookingTitle(event(), 'stellr')).toBe(true)
    expect(matchesBookingTitle(event(), 'Welcome To Stellr')).toBe(true)
  })

  it('rejects an unrelated meeting on the same calendar', () => {
    // The calendar holds the whole working day. Stamping "booked an intro call"
    // because of a dentist appointment would be worse than missing one.
    expect(matchesBookingTitle(event({ summary: 'Dentist' }), 'stellr')).toBe(false)
    expect(matchesBookingTitle(event({ summary: null }), 'stellr')).toBe(false)
  })

  it('matches everything when no needle is configured', () => {
    expect(matchesBookingTitle(event({ summary: 'Anything' }), '')).toBe(true)
  })
})

describe('formatStart', () => {
  it('renders a timed start in UTC', () => {
    expect(formatStart(event())).toBe('2026-09-10 15:30 UTC')
  })

  it('handles an all-day event', () => {
    expect(formatStart(event({ start: { date: '2026-09-10' } }))).toBe('2026-09-10 00:00 UTC')
  })

  it('returns undefined rather than an invalid date string', () => {
    expect(formatStart(event({ start: null }))).toBeUndefined()
  })

  it('passes an unparseable value through instead of printing Invalid Date', () => {
    expect(formatStart(event({ start: { dateTime: 'whenever' } }))).toBe('whenever')
  })
})
