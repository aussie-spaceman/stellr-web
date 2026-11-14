import { describe, expect, it } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'
import { buildContext, surveyEventYear, type SurveySession } from './access'

// hubspot-event-options.8: a survey response carries the school year of its
// event day (schoolYearFor, rolls over in August), not the calendar year, so
// it agrees with the event's HubSpot event_year and event_participations row.

describe('surveyEventYear', () => {
  it('keeps the year that is ending through 31 July', () => {
    expect(surveyEventYear('2026-07-31')).toBe(2026)
  })

  it('moves to the next school year on 1 August', () => {
    expect(surveyEventYear('2026-08-01')).toBe(2027)
  })

  it('files an autumn event under the year it finishes in', () => {
    expect(surveyEventYear('2026-10-24')).toBe(2027)
  })

  it('does not roll over at New Year', () => {
    expect(surveyEventYear('2026-12-31')).toBe(2027)
    expect(surveyEventYear('2027-01-01')).toBe(2027)
  })

  it('reads the day from a full timestamp', () => {
    expect(surveyEventYear('2026-08-01T23:30:00-07:00')).toBe(2027)
  })

  it('is null when there is no usable date', () => {
    expect(surveyEventYear(null)).toBeNull()
    expect(surveyEventYear('')).toBeNull()
    expect(surveyEventYear('soon')).toBeNull()
    expect(surveyEventYear('2026-13-45')).toBeNull()
  })
})

describe('buildContext event_year', () => {
  // An adult invitation with no member or participant behind it: buildContext
  // reads nothing from the database, so only the date decides the year.
  const session = (eventDate: string) =>
    ({
      invitation: {
        id: 'inv-1',
        member_id: null,
        participant_id: null,
        respondent_role: 'adult',
        is_minor: false,
        send_via: 'email',
        email: null,
        adult_relationship: null,
      },
      distribution: { id: 'dist-1', event_slug: 'evt', event_title: 'The Event', event_date: eventDate },
    }) as unknown as SurveySession

  it.each([
    ['2026-07-31', 2026],
    ['2026-08-01', 2027],
    ['2026-10-24', 2027],
    ['2027-03-14', 2027],
  ])('an event on %s is in school year %i', async (date, year) => {
    const ctx = await buildContext(fakeSupabase().client, session(date))
    expect(ctx.event_year).toBe(year)
  })
})
