/**
 * Dry-run the booking cron: same query, same filters, no writes.
 *
 *   npx tsx scripts/probe-motion-calendar.ts [days] [titleNeedle]
 *   npx tsx scripts/probe-motion-calendar.ts 90 'Welcome To Stellr Events'
 *
 * Reads MOTION_CALENDAR_ID / MOTION_BOOKING_TITLE from .env.local unless
 * overridden by the arguments.
 *
 * It calls the cron's own `listUpdatedEvents`, `matchesBookingTitle` and
 * `selectGuestEmails` rather than reimplementing the query. An earlier version
 * did reimplement it, forgot to paginate, and reported zero matching bookings
 * on a calendar that had one — because `orderBy: 'updated'` returns the
 * oldest-updated page first and the newest events are on the last page.
 *
 * Answers the four things that go wrong, in the order they bite:
 *   1. Is the Google Calendar API enabled on the Cloud project?
 *   2. Is the calendar ID right and shared with the service account?
 *   3. Does the title needle match what Motion actually writes — and *only*
 *      that? On a primary work calendar an over-broad needle matches nearly
 *      everything, which is the dangerous failure, not the obvious one.
 *   4. Which address would be treated as the guest on each booking?
 */
import { config as loadEnv } from 'dotenv'
import { resolve } from 'node:path'
loadEnv({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const [daysArg, needleArg] = process.argv.slice(2)
  const days = Number(daysArg) || 30
  if (needleArg) process.env.MOTION_BOOKING_TITLE = needleArg

  const calendarId = process.env.MOTION_CALENDAR_ID
  const needle = process.env.MOTION_BOOKING_TITLE ?? 'Stellr'
  if (!calendarId) {
    console.error('MOTION_CALENDAR_ID is not set in .env.local — add it, or export it for this run.')
    process.exit(1)
  }

  const { listUpdatedEvents } = await import('../lib/google-calendar')
  const { matchesBookingTitle, selectGuestEmails, isLiveBooking } = await import(
    '../lib/motion-bookings'
  )

  console.log(`Service account : ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL}`)
  console.log(`Calendar        : ${calendarId}`)
  console.log(`Updated within  : ${days} days`)
  console.log(`Title needle    : "${needle}"\n`)

  let events
  try {
    events = await listUpdatedEvents({
      updatedSince: new Date(Date.now() - days * 86_400_000),
      titleQuery: needle,
    })
  } catch (err) {
    const message = String(err)
    console.error(`✗ Could not read the calendar.\n  ${message}\n`)
    if (message.includes('has not been used in project') || message.includes('is disabled')) {
      console.error('  → The Google Calendar API is not enabled on the Cloud project. Enable it')
      console.error('  at the console URL above, wait a minute or two, then re-run. Nothing')
      console.error('  about the sharing or the calendar ID is wrong.')
    } else if (message.includes('too far in the past')) {
      console.error('  → updatedMin is beyond what Google serves with showDeleted on (~25 days).')
      console.error('  lib/google-calendar.ts leaves it off, so something re-enabled it.')
    } else if (message.includes('404')) {
      console.error('  → 404 means the calendar ID is wrong, OR it is not shared with the service')
      console.error('  account. Google returns 404 for both, so they look identical.')
    } else if (message.includes('403')) {
      console.error('  → Shared, but the scope was refused. Check calendar.readonly.')
    }
    process.exit(1)
  }

  console.log(`✓ Read the calendar. ${events.length} event(s) returned by Google's own search.\n`)

  const excluded = [
    calendarId,
    process.env.GOOGLE_CALENDAR_IMPERSONATE,
    process.env.CONTACT_EMAIL,
    ...(process.env.MOTION_BOOKING_EXCLUDE_EMAILS ?? '').split(','),
  ].filter((e): e is string => Boolean(e && e.includes('@')))

  const matched = events.filter((e) => isLiveBooking(e) && matchesBookingTitle(e, needle))
  const withGuests = matched
    .map((e) => ({ event: e, guests: selectGuestEmails(e, excluded) }))
    .filter((r) => r.guests.length > 0)

  console.log(`${matched.length} pass the title filter; ${withGuests.length} have a guest.\n`)

  for (const { event, guests } of withGuests) {
    console.log(`  ${event.summary}`)
    console.log(`    start   ${event.start?.dateTime ?? event.start?.date}`)
    console.log(`    guests  ${guests.join(', ')}`)
  }

  // The loud warning. An over-broad needle on a primary work calendar is the
  // failure that does damage: it stamps "booked an intro call" on partners and
  // colleagues who never saw a landing page.
  if (events.length > 0 && matched.length / events.length > 0.5 && matched.length > 5) {
    console.log(
      `\n⚠ ${matched.length} of ${events.length} events match "${needle}". On a primary work` +
        '\n  calendar that is almost certainly too broad — narrow it to the booking-link name' +
        '\n  (the part Motion puts in every booking title) before running the cron.',
    )
  }
  if (!withGuests.length) {
    console.log('\n  Nothing to stamp. Titles Google returned for this needle:\n')
    for (const title of [...new Set(events.map((e) => e.summary ?? '(untitled)'))].slice(0, 25)) {
      console.log(`    ${title}`)
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
