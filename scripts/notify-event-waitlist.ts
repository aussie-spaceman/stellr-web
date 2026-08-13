#!/usr/bin/env npx tsx
/**
 * Tell an event's waitlist that registration has opened.
 *
 *   npx tsx scripts/notify-event-waitlist.ts --event=<slug> --dry-run
 *   npx tsx scripts/notify-event-waitlist.ts --event=<slug>
 *   npx tsx scripts/notify-event-waitlist.ts --event=<slug> --limit=40
 *
 * Deliberately a script and not a cron. "Registration is open" is a one-shot
 * announcement tied to a human decision — a scheduler firing it on a date in a
 * config file is how the wrong cohort gets mailed early, and it cannot be
 * unsent.
 *
 * How it works
 * ------------
 * HubSpot is the source of truth: it finds contacts whose `event_slug` matches
 * and whose `event_notify_status` is still exactly `Requested`, mails them via
 * Resend, then advances each to `Notified`. Targeting `Requested` alone is what
 * makes the job idempotent and what suppresses opt-outs — an unsubscribe sets
 * `Unsubscribed`, so it simply stops matching.
 *
 * Throttling
 * ----------
 * Resend's free plan allows 100 emails/day across the whole account, shared
 * with every transactional message the site sends. DEFAULT_LIMIT leaves room
 * for those. Re-run on subsequent days to work through a larger list — already
 * notified contacts are skipped automatically.
 *
 * Requires in .env.local: HUBSPOT_ACCESS_TOKEN, RESEND_API_KEY, and
 * MARKETING_OPTOUT_SECRET (or CRON_SECRET) for the unsubscribe links.
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'

const envPath = path.resolve(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) dotenv.config({ path: envPath })
else dotenv.config()

// Imported dynamically, and that is load-bearing rather than stylistic.
//
// lib/hubspot.ts and lib/sanity.ts read their credentials at module scope, and
// ESM hoists every static import above this file's first statement — so a
// static import evaluates them against an empty environment, before
// dotenv.config() above has run. The failure is silent and the wrong shape:
// `searchContacts` returns [] without a token, so the script cheerfully reports
// "No contacts are waiting" for a waitlist that is actually full, and there is
// nothing in the output to suggest otherwise.
// (tsx compiles to CJS, so these load at the top of main() rather than as
// top-level await.)
async function loadDeps() {
  return {
    ...(await import('../lib/hubspot')),
    ...(await import('../lib/hubspot-fields')),
    ...(await import('../lib/email')),
    ...(await import('../lib/email-layout')),
    ...(await import('../lib/waitlist-optout')),
    ...(await import('../lib/sanity')),
  }
}

type Deps = Awaited<ReturnType<typeof loadDeps>>

/** Well under Resend's free 100/day, leaving headroom for transactional mail. */
const DEFAULT_LIMIT = 60

/** Gap between sends — keeps burst rate polite rather than hammering Resend. */
const SEND_INTERVAL_MS = 600

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.stellreducation.org'

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
}

const SLUG = arg('event')
const DRY_RUN = process.argv.includes('--dry-run')
const LIMIT = Number(arg('limit') ?? DEFAULT_LIMIT)

if (!SLUG) {
  console.error('Missing --event=<slug>.\n\ne.g. npx tsx scripts/notify-event-waitlist.ts --event=nevada-space-design-challenge-2027 --dry-run')
  process.exit(1)
}
if (!Number.isFinite(LIMIT) || LIMIT < 1) {
  console.error(`--limit must be a positive number (got "${arg('limit')}").`)
  process.exit(1)
}
if (!process.env.HUBSPOT_ACCESS_TOKEN) {
  console.error(`HUBSPOT_ACCESS_TOKEN is not set. Add it to ${envPath}.`)
  process.exit(1)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function emailBody(escapeHtml: Deps['escapeHtml'], firstName: string, eventTitle: string, slug: string) {
  const greeting = firstName || 'there'
  const registerUrl = `${SITE_URL}/register/${slug}/individual`
  const eventUrl = `${SITE_URL}/events/${slug}`

  const bodyHtml = `
    <p>Hi ${escapeHtml(greeting)},</p>
    <p>You asked us to let you know the moment registration opened for
      <strong>${escapeHtml(eventTitle)}</strong> — it is open now.</p>
    <p style="margin:28px 0">
      <a href="${registerUrl}" style="background:#3b5bdb;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;display:inline-block">Register now</a>
    </p>
    <p>Registering as a team? Use the <a href="${SITE_URL}/register/${slug}/group">group registration</a> instead.</p>
    <p>Full details, schedule and eligibility are on the <a href="${eventUrl}">event page</a>.</p>
    <p style="color:#6b7280;font-size:14px">Places are limited and allocated in the order registrations are received.</p>
  `

  const text = [
    `Hi ${greeting},`,
    '',
    `You asked us to let you know the moment registration opened for ${eventTitle} — it is open now.`,
    '',
    `Register: ${registerUrl}`,
    `Registering as a team? ${SITE_URL}/register/${slug}/group`,
    `Event details: ${eventUrl}`,
    '',
    'Places are limited and allocated in the order registrations are received.',
    '',
    '— Stellr Education',
  ].join('\n')

  return { bodyHtml, text }
}

async function main() {
  const {
    searchContacts,
    upsertContact,
    HS,
    NOTIFY_STATUS,
    sendEmail,
    MARKETING_FROM,
    emailLayout,
    escapeHtml,
    waitlistUnsubscribeUrl,
    getEventBySlug,
  } = await loadDeps()

  const event = await getEventBySlug(SLUG!).catch(() => null)
  const eventTitle = event?.title ?? SLUG!

  if (!event) {
    console.warn(`! No Sanity event found for "${SLUG}" — using the slug as the title.`)
  }

  console.log(`\nWaitlist notify — ${eventTitle}${DRY_RUN ? '  [DRY RUN]' : ''}`)
  console.log(`  slug:  ${SLUG}`)
  console.log(`  limit: ${LIMIT}\n`)

  const contacts = await searchContacts(
    [
      {
        filters: [
          { propertyName: HS.eventSlug, operator: 'EQ', value: SLUG },
          { propertyName: HS.notifyStatus, operator: 'EQ', value: NOTIFY_STATUS.requested },
        ],
      },
    ],
    ['email', 'firstname', HS.eventSlug, HS.notifyStatus],
    LIMIT,
  )

  if (!contacts.length) {
    console.log('No contacts are waiting on this event. Nothing to do.\n')
    return
  }

  console.log(`${contacts.length} waiting:\n`)

  let sent = 0
  const failed: string[] = []
  const skipped: string[] = []

  for (const contact of contacts) {
    const email = contact.properties.email
    if (!email) {
      skipped.push(contact.id)
      continue
    }

    const unsubscribeUrl = waitlistUnsubscribeUrl(email)
    if (!unsubscribeUrl) {
      // Marketing mail without a working opt-out is not something to send and
      // apologise for later. Stop rather than degrade.
      console.error(
        '\n✗ Cannot build unsubscribe links: set MARKETING_OPTOUT_SECRET (or CRON_SECRET) and re-run.',
      )
      process.exit(1)
    }

    if (DRY_RUN) {
      console.log(`  · would email ${email}`)
      sent++
      continue
    }

    const { bodyHtml, text } = emailBody(escapeHtml, contact.properties.firstname ?? '', eventTitle, SLUG!)

    try {
      await sendEmail({
        to: email,
        from: MARKETING_FROM,
        subject: `Registration is open — ${eventTitle}`,
        html: emailLayout({
          heading: 'Registration is open',
          bodyHtml,
          preheader: `${eventTitle} — registration is now open.`,
          unsubscribeUrl,
        }),
        text: `${text}\n\nUnsubscribe: ${unsubscribeUrl}`,
      })
    } catch (err) {
      console.error(`  ✗ ${email} — send failed: ${err}`)
      failed.push(email)
      continue
    }

    // Advance only after the send succeeds. The other order would mark someone
    // notified who never received anything, and `Requested` is the only thing
    // that gets them retried on the next run.
    const advanced = await upsertContact({
      email,
      properties: { [HS.notifyStatus]: NOTIFY_STATUS.notified },
    })

    if (advanced.ok) {
      console.log(`  ✓ ${email}`)
      sent++
    } else {
      // Mailed but not marked: a re-run would mail them twice. Name them so
      // that is a decision rather than a surprise.
      console.error(`  ! ${email} — EMAILED but status not advanced; a re-run will email again`)
      failed.push(email)
    }

    await sleep(SEND_INTERVAL_MS)
  }

  console.log(`\n─── Summary ───`)
  console.log(`  ${DRY_RUN ? 'would send' : 'sent'}: ${sent}`)
  if (skipped.length) console.log(`  skipped (no email): ${skipped.length}`)
  if (failed.length) console.log(`  failed: ${failed.length} → ${failed.join(', ')}`)
  if (contacts.length === LIMIT) {
    console.log(`\n  Hit the limit of ${LIMIT}; more may be waiting. Re-run to continue —`)
    console.log(`  those already notified are skipped automatically.`)
  }
  console.log('')

  if (failed.length) process.exit(1)
}

main().catch((err) => {
  console.error('Waitlist notify failed:', err)
  process.exit(1)
})
