/**
 * Audit script — reports the public per-participant fee for every live event.
 *
 * Event pages resolve their fee live from Stripe (see lib/event-pricing.ts), so
 * a price ID that is missing, inactive, or points at a different Stripe account
 * silently hides the fee on the page — and is also rejected at checkout. This
 * prints the same verdict the page will render, so those breaks are caught
 * before a visitor (or a registrant) finds them.
 *
 * Read-only: it retrieves Stripe prices and Sanity documents, and writes nothing.
 *
 * Prerequisites (.env.local):
 *   NEXT_PUBLIC_SANITY_PROJECT_ID, NEXT_PUBLIC_SANITY_DATASET, STRIPE_SECRET_KEY
 *
 * Run:
 *   npm run audit:event-prices
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'
import Stripe from 'stripe'

// ESM hoists every static import above this call, so nothing imported here may
// read env at module scope — that's why Sanity is queried over raw fetch below
// rather than through lib/sanity.
const envPath = path.resolve(process.cwd(), '.env.local')
dotenv.config(fs.existsSync(envPath) ? { path: envPath } : {})

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET ?? 'production'
const stripeKey = process.env.STRIPE_SECRET_KEY

if (!projectId) {
  console.error('❌  NEXT_PUBLIC_SANITY_PROJECT_ID is not set in .env.local')
  process.exit(1)
}
if (!stripeKey) {
  console.error('❌  STRIPE_SECRET_KEY is not set in .env.local')
  process.exit(1)
}

interface EventRow {
  title: string
  slug: string
  date: string | null
  stripePriceId: string | null
}

async function fetchEvents(): Promise<EventRow[]> {
  const query =
    '*[_type=="event" && activityType!="campaign"]{title,"slug":slug.current,date,stripePriceId}|order(date asc)'
  const url =
    `https://${projectId}.api.sanity.io/v2024-01-01/data/query/${dataset}` +
    `?query=${encodeURIComponent(query)}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Sanity query failed: ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { result?: EventRow[] }
  return body.result ?? []
}

type Verdict = { icon: string; display: string; problem: string | null }

async function verdictFor(stripe: Stripe, priceId: string | null): Promise<Verdict> {
  if (!priceId) {
    return {
      icon: '⚠️ ',
      display: 'Free to enter',
      problem: 'no Stripe price ID — the page advertises this event as free',
    }
  }
  try {
    const price = await stripe.prices.retrieve(priceId)
    if (!price.active) {
      return { icon: '❌', display: '(hidden)', problem: `price ${priceId} is INACTIVE in Stripe` }
    }
    if (typeof price.unit_amount !== 'number') {
      return { icon: '❌', display: '(hidden)', problem: `price ${priceId} has no unit amount` }
    }
    const amount = (price.unit_amount / 100).toLocaleString('en-US', {
      style: 'currency',
      currency: price.currency.toUpperCase(),
    })
    // An active price this low is almost always a test price that reached
    // production — it would be shown publicly, and charged, as-is.
    if (price.unit_amount < 500) {
      return {
        icon: '⚠️ ',
        display: `${amount} per participant`,
        problem: `price ${priceId} is only ${amount} — is that a test price?`,
      }
    }
    return { icon: '✅', display: `${amount} per participant`, problem: null }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { icon: '❌', display: '(hidden)', problem: `price ${priceId} could not be retrieved — ${message}` }
  }
}

async function main() {
  const stripe = new Stripe(stripeKey!, { apiVersion: '2026-05-27.dahlia' })
  const events = await fetchEvents()
  console.log(`\nEvent registration fees — ${events.length} live events (${dataset})\n`)

  const problems: string[] = []
  for (const event of events) {
    const v = await verdictFor(stripe, event.stripePriceId)
    console.log(`${v.icon} ${event.date ?? '—'.padEnd(10)}  ${event.title.padEnd(42)} ${v.display}`)
    if (v.problem) problems.push(`   • ${event.title} (/events/${event.slug}) — ${v.problem}`)
  }

  if (problems.length === 0) {
    console.log('\n✅  Every live event shows a fee.\n')
    return
  }
  console.log(`\n${problems.length} event(s) need attention:`)
  console.log(problems.join('\n'))
  console.log('')
  // Non-zero exit so this can gate a deploy check if we ever wire it in.
  process.exitCode = 1
}

main().catch((e) => {
  console.error('❌ ', e)
  process.exit(1)
})
