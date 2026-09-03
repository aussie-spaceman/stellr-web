// Read-only Google Calendar access for the booking reconciliation cron.
//
// Deliberately its own JWT rather than an extra scope on lib/google-sheets.ts.
// That client impersonates a user (`subject`) so it can own Drive files, and
// widening its scopes would hand the Sheets integration calendar access it has
// no use for. This one asks for `calendar.readonly` and nothing else.
//
// Two ways to be allowed in, and the default needs no Workspace admin:
//
//   • **Shared calendar (default).** Share the booking calendar with
//     GOOGLE_SERVICE_ACCOUNT_EMAIL as "See all event details". No `subject`, so
//     no domain-wide delegation and no admin console.
//   • **Impersonation.** Set GOOGLE_CALENDAR_IMPERSONATE to a mailbox and the
//     client acts as that user — which requires `calendar.readonly` to be
//     authorised for this service account's client ID in the Workspace admin
//     console. Only worth it if you would rather not share the calendar.
import { google } from 'googleapis'
import type { CalendarEventLike } from './motion-bookings'

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly']

export function isCalendarConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY &&
      process.env.MOTION_CALENDAR_ID,
  )
}

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!email || !key) return null
  const subject = process.env.GOOGLE_CALENDAR_IMPERSONATE || undefined
  return new google.auth.JWT({ email, key, scopes: SCOPES, ...(subject ? { subject } : {}) })
}

export interface CalendarQuery {
  /** Only events created or changed since this instant. */
  updatedSince: Date
  /** Free-text search passed to Google, narrowing before we filter locally. */
  titleQuery?: string
}

/**
 * Events created or modified since `updatedSince`.
 *
 * Keyed on **updated**, not start time, which is the whole point: a booking
 * made this morning for a call three weeks out has to be picked up today. A
 * start-time window would miss it entirely and then miss it again once the
 * window had moved past.
 *
 * `showDeleted` is on so a cancelled booking still comes back and can be
 * filtered by status rather than silently looking like it never happened.
 */
export async function listUpdatedEvents({
  updatedSince,
  titleQuery,
}: CalendarQuery): Promise<CalendarEventLike[]> {
  const auth = getAuth()
  const calendarId = process.env.MOTION_CALENDAR_ID
  if (!auth || !calendarId) return []

  const calendar = google.calendar({ version: 'v3', auth })
  const events: CalendarEventLike[] = []
  let pageToken: string | undefined

  do {
    const res = await calendar.events.list({
      calendarId,
      updatedMin: updatedSince.toISOString(),
      // singleEvents expands a recurring series into instances, so `start` is
      // always a real time rather than a recurrence rule.
      singleEvents: true,
      orderBy: 'updated',
      showDeleted: true,
      maxResults: 250,
      ...(titleQuery ? { q: titleQuery } : {}),
      ...(pageToken ? { pageToken } : {}),
    })
    events.push(...((res.data.items ?? []) as CalendarEventLike[]))
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)

  return events
}
