// Deciding who actually booked a call — the pure half.
//
// Motion has no webhooks and no booking API (checked Sep 2026: its endpoints
// cover tasks, projects, comments, schedules, statuses, users and workspaces,
// and its Zapier/Make apps expose only new-task and new-comment triggers). So
// the only trace a booking leaves is the event Motion writes onto Google
// Calendar, and this module turns such an event into "which contact booked".
//
// It matters because the landing-page form now redirects straight to the
// calendar: `lp_booking_click` fires on every stored submission and therefore
// says nothing about intent. This is the only thing left that separates a
// hand-off from an actual booking.
//
// Split out from the cron route so the attendee logic — the part that can
// silently stamp the wrong person — is testable without Google or HubSpot.

/** The subset of a Google Calendar event this needs. */
export interface CalendarEventLike {
  id?: string | null
  summary?: string | null
  start?: { dateTime?: string | null; date?: string | null } | null
  status?: string | null
  organizer?: { email?: string | null; self?: boolean | null } | null
  attendees?:
    | {
        email?: string | null
        self?: boolean | null
        organizer?: boolean | null
        resource?: boolean | null
        responseStatus?: string | null
      }[]
    | null
}

/**
 * The guest addresses on a booking — everyone who is not us and not a room.
 *
 * Getting this wrong is the expensive failure: the webhook route takes the
 * first email-shaped value it is given, so handing it a raw calendar event
 * would stamp "call booked" on whichever address appeared first, which is
 * usually the organiser. That is our own contact record.
 *
 * `excluded` should hold every address that is Stellr rather than a visitor —
 * the organiser, the calendar owner, any staff who get added to these events.
 * Matching is case-insensitive because Google is inconsistent about it.
 */
export function selectGuestEmails(
  event: CalendarEventLike,
  excluded: readonly string[] = [],
): string[] {
  const deny = new Set(excluded.map((e) => e.trim().toLowerCase()).filter(Boolean))
  const organiser = event.organizer?.email?.trim().toLowerCase()
  if (organiser) deny.add(organiser)

  const seen = new Set<string>()
  const guests: string[] = []

  for (const attendee of event.attendees ?? []) {
    // A room or a piece of equipment is not a lead.
    if (attendee.resource) continue
    // `self` is the calendar we are reading as; `organizer` is who created it.
    if (attendee.self || attendee.organizer) continue
    // Someone who said no did not book a call.
    if (attendee.responseStatus === 'declined') continue

    const email = attendee.email?.trim().toLowerCase()
    if (!email || !email.includes('@')) continue
    if (deny.has(email)) continue
    if (seen.has(email)) continue

    seen.add(email)
    guests.push(email)
  }

  return guests
}

/** A cancelled or declined booking is not a booking. */
export function isLiveBooking(event: CalendarEventLike): boolean {
  return event.status !== 'cancelled'
}

/**
 * Does this event look like one of our booking-link meetings?
 *
 * Substring, case-insensitive, on the title. The calendar also holds every
 * other meeting in the day, and stamping "booked an intro call" on someone
 * because they share a dentist appointment would be worse than missing one.
 */
export function matchesBookingTitle(event: CalendarEventLike, needle: string): boolean {
  if (!needle) return true
  return (event.summary ?? '').toLowerCase().includes(needle.toLowerCase())
}

/** Human-readable start time for the HubSpot note; falls back to the raw value. */
export function formatStart(event: CalendarEventLike): string | undefined {
  const raw = event.start?.dateTime ?? event.start?.date ?? undefined
  if (!raw) return undefined
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  return date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
}
