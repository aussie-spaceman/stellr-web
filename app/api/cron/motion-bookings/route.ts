import { NextResponse } from 'next/server'
import { HS } from '@/lib/hubspot-fields'
import { createNote, getContactByEmail, upsertContact } from '@/lib/hubspot'
import { isCalendarConfigured, listUpdatedEvents } from '@/lib/google-calendar'
import {
  formatStart,
  isLiveBooking,
  matchesBookingTitle,
  selectGuestEmails,
} from '@/lib/motion-bookings'

// GET /api/cron/motion-bookings — runs daily at 12:00 UTC (see vercel.json).
//
// Daily, not hourly, because the Vercel account is on the Hobby plan, which
// rejects any cron expression that would run more than once a day — and it
// rejects it at deployment *validation*, so the build fails without producing a
// deployment record. An hourly schedule here silently blocked every deploy for
// three hours before that was spotted.
//
// Daily is honestly sufficient: this flag feeds funnel reporting and a
// follow-up list, neither of which needs to be fresh within the hour. When a
// booking needs reflecting immediately, call the route by hand with ?hours=.
//
// Closes the landing-page funnel. Everything up to "submitted" is recorded by
// the form; this is what records "booked".
//
// Why a cron and not a webhook
// ----------------------------
// Motion has no webhooks and no booking API — checked Sep 2026, its endpoints
// are tasks, projects, comments, schedules, statuses, users and workspaces, and
// its Zapier and Make apps expose only new-task and new-comment triggers. The
// only trace a booking leaves is the event Motion writes onto Google Calendar,
// so that is what this reads.
//
// (app/api/webhooks/motion still exists and still works. It is the path a
// native Motion webhook, or a Zap, would use. This route needs neither.)
//
// Why it matters more than it used to
// -----------------------------------
// The form now redirects straight to the calendar on success, so
// `lp_booking_click` fires on every stored submission and carries no signal
// about intent. Without this job the funnel reads "submitted" and stops.
//
// Why `updatedMin` and not a start-time window
// --------------------------------------------
// A booking made this morning can be for a call three weeks out. Filtering on
// start time would miss it today and keep missing it until the window moved
// past, at which point it is never picked up. Keying on when the event was
// *written* catches it on the next run.

/**
 * Hours of calendar history to reconcile on each run.
 *
 * Three days against a daily schedule, so a skipped run — or two — still
 * self-heals on the next one rather than leaving a permanent hole.
 */
const DEFAULT_LOOKBACK_HOURS = 72

/** Ceiling for a manual backfill, so `?hours=` cannot ask for the whole calendar. */
const MAX_LOOKBACK_HOURS = 24 * 400

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // A missing dependency is a 200 with an explanation, matching the other
  // crons: an alarm every hour for something that is simply not wired yet is
  // noise that trains people to ignore alarms.
  if (!process.env.HUBSPOT_ACCESS_TOKEN) {
    return NextResponse.json({ skipped: 'HUBSPOT_ACCESS_TOKEN not set', booked: 0 })
  }
  if (!isCalendarConfigured()) {
    return NextResponse.json({
      skipped: 'Calendar not configured — needs GOOGLE_SERVICE_ACCOUNT_* and MOTION_CALENDAR_ID',
      booked: 0,
    })
  }

  // `?hours=` exists for the first run, which should reach back over the whole
  // campaign rather than three days, for re-reconciling after a fix, and for
  // picking up a booking now rather than at noon tomorrow.
  const requested = Number(new URL(req.url).searchParams.get('hours'))
  const hours =
    Number.isFinite(requested) && requested > 0
      ? Math.min(requested, MAX_LOOKBACK_HOURS)
      : DEFAULT_LOOKBACK_HOURS

  const titleNeedle = process.env.MOTION_BOOKING_TITLE ?? 'Stellr'
  // Addresses that are us rather than a visitor. The organiser is excluded
  // automatically; this covers a shared calendar and any staff on the invite.
  const excluded = [
    process.env.MOTION_CALENDAR_ID,
    process.env.GOOGLE_CALENDAR_IMPERSONATE,
    process.env.CONTACT_EMAIL,
    ...(process.env.MOTION_BOOKING_EXCLUDE_EMAILS ?? '').split(','),
  ].filter((e): e is string => Boolean(e && e.includes('@')))

  const updatedSince = new Date(Date.now() - hours * 60 * 60 * 1000)

  const stamped: string[] = []
  const alreadyBooked: string[] = []
  const unknown: string[] = []
  const notLandingPageLead: string[] = []
  const warnings: string[] = []
  let considered = 0

  try {
    const events = await listUpdatedEvents({ updatedSince, titleQuery: titleNeedle })

    for (const event of events) {
      if (!isLiveBooking(event)) continue
      if (!matchesBookingTitle(event, titleNeedle)) continue

      for (const email of selectGuestEmails(event, excluded)) {
        considered++

        // Only ever update someone we already know. Creating a contact here
        // would let any meeting on this calendar invent a landing-page lead.
        const contact = await getContactByEmail(email, [HS.lpCallBooked, HS.lpAudience])
        if (!contact) {
          unknown.push(email)
          continue
        }

        // Second guard, and the one that matters on a shared primary calendar:
        // only a contact who actually came from a landing page can be recorded
        // as having booked a landing-page call. `lp_call_booked` means nothing
        // otherwise.
        //
        // This exists because the title filter alone is not safe. Set to
        // "Stellr" against this calendar it matched 212 of 250 events —
        // curriculum reviews, partner introductions, colleagues — and every one
        // of those people who happens to be a HubSpot contact would have been
        // stamped. A booking-link rename would put us right back there, and a
        // wrong note on a real partner's record is not something a later fix
        // takes back.
        if (!contact.properties?.[HS.lpAudience]) {
          notLandingPageLead.push(email)
          continue
        }

        // Idempotent: re-running must not append a second note for the same
        // booking, and this job re-reads the same 72 hours every hour.
        if (contact.properties?.[HS.lpCallBooked] === 'true') {
          alreadyBooked.push(email)
          continue
        }

        const written = await upsertContact({ email, properties: { [HS.lpCallBooked]: 'true' } })
        if (!written.ok) {
          warnings.push(`write-failed:${email}`)
          continue
        }

        const when = formatStart(event)
        // The property makes it countable; the note makes it visible to whoever
        // picks up the call. Both, because they serve different people.
        await createNote(
          contact.id,
          `Booked an intro call${when ? ` for ${when}` : ''} (via the Motion booking link).`,
        )
        stamped.push(email)
      }
    }
  } catch (err) {
    // A Google 403 here almost always means the calendar was never shared with
    // the service account, so say so rather than logging a bare stack.
    console.error('[cron/motion-bookings] Failed:', err)
    return NextResponse.json(
      {
        error: 'Calendar read or HubSpot write failed',
        hint:
          'Three causes, in the order they bite: the Google Calendar API is not enabled on the ' +
          'Cloud project (the error names a console URL — Sheets and Drive being enabled says ' +
          'nothing about Calendar); MOTION_CALENDAR_ID is not shared with ' +
          'GOOGLE_SERVICE_ACCOUNT_EMAIL as "See all event details"; or calendar.readonly is not ' +
          'authorised for impersonation. Run scripts/probe-motion-calendar.ts to tell them apart.',
        detail: String(err),
      },
      { status: 500 },
    )
  }

  return NextResponse.json({
    lookbackHours: hours,
    considered,
    booked: stamped.length,
    stampedNow: stamped,
    alreadyBooked: alreadyBooked.length,
    notInHubspot: unknown.length,
    notLandingPageLead: notLandingPageLead.length,
    warnings,
  })
}
