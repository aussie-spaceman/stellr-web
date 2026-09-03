/**
 * Diagnose the booking cron's calendar access without touching HubSpot.
 *
 *   npx tsx scripts/probe-motion-calendar.ts <calendarId> [days] [titleNeedle]
 *   npx tsx scripts/probe-motion-calendar.ts david.shaw@stellreducation.org 90 Stellr
 *
 * Answers the three questions that go wrong, in order:
 *   1. Can the service account read this calendar at all? (the sharing step)
 *   2. Is the calendar ID right?
 *   3. Does the title needle actually match the events Motion writes?
 *
 * Read-only, and prints attendees so you can see which address the cron would
 * treat as the guest. Use it whenever the cron reports `considered: 0`.
 */
import { config as loadEnv } from 'dotenv'
import { resolve } from 'node:path'
loadEnv({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  const [calendarId, daysArg, needleArg] = process.argv.slice(2)
  if (!calendarId) {
    console.error('Usage: npx tsx scripts/probe-motion-calendar.ts <calendarId> [days] [titleNeedle]')
    process.exit(1)
  }
  const days = Number(daysArg) || 30
  const needle = needleArg ?? 'Stellr'

  const { google } = await import('googleapis')
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!email || !key) throw new Error('GOOGLE_SERVICE_ACCOUNT_* not set in .env.local')

  console.log(`Service account : ${email}`)
  console.log(`Calendar        : ${calendarId}`)
  console.log(`Updated within  : ${days} days`)
  console.log(`Title needle    : "${needle}"\n`)

  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
  })
  const calendar = google.calendar({ version: 'v3', auth })

  let res
  try {
    res = await calendar.events.list({
      calendarId,
      updatedMin: new Date(Date.now() - days * 86_400_000).toISOString(),
      singleEvents: true,
      orderBy: 'updated',
      showDeleted: true,
      maxResults: 250,
    })
  } catch (err) {
    const message = String(err)
    console.error(`✗ Could not read the calendar.\n  ${message}\n`)
    if (message.includes('has not been used in project') || message.includes('is disabled')) {
      // Distinct from a permission problem and easy to misread as one: the
      // service account and the sharing can both be perfect while the API
      // itself is switched off for the Cloud project. Sheets and Drive being
      // enabled says nothing about Calendar.
      console.error('  → The Google Calendar API is not enabled on the Cloud project.')
      console.error('  Enable it at the console URL in the message above, wait a minute or two,')
      console.error('  then re-run. Nothing about the sharing or the calendar ID is wrong.')
    } else if (message.includes('404')) {
      console.error('  404 → the calendar ID is wrong, OR it has not been shared with the')
      console.error('  service account above. Google returns 404 rather than 403 for a')
      console.error('  calendar the caller cannot see at all, so the two look identical.')
    } else if (message.includes('403')) {
      console.error('  403 → shared, but the scope was refused. Check calendar.readonly.')
    }
    process.exit(1)
  }

  const events = res.data.items ?? []
  console.log(`✓ Read the calendar. ${events.length} event(s) created or changed in that window.\n`)

  const matching = events.filter((e) =>
    (e.summary ?? '').toLowerCase().includes(needle.toLowerCase()),
  )
  console.log(`${matching.length} match the title needle:\n`)
  for (const e of matching) {
    const guests = (e.attendees ?? [])
      .filter((a) => !a.resource && !a.organizer && !a.self)
      .map((a) => `${a.email}${a.responseStatus === 'declined' ? ' (declined)' : ''}`)
    console.log(`  ${e.status === 'cancelled' ? '[cancelled] ' : ''}${e.summary}`)
    console.log(`    start   ${e.start?.dateTime ?? e.start?.date}`)
    console.log(`    guests  ${guests.length ? guests.join(', ') : '(none — nothing for the cron to stamp)'}`)
  }

  if (!matching.length && events.length) {
    console.log('  None. The titles actually on this calendar are:\n')
    for (const title of [...new Set(events.map((e) => e.summary ?? '(untitled)'))].slice(0, 25)) {
      console.log(`    ${title}`)
    }
    console.log('\n  Set MOTION_BOOKING_TITLE to a substring of the booking events above.')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
