/**
 * Backfill historical Apollo engagement into HubSpot.
 *
 * The live webhook only ever sees the future: per Apollo's docs, "triggered
 * workflows only run when a trigger event happens after the workflow is
 * active". Every click and reply that happened before the workflows were
 * switched on is therefore invisible to it, permanently, and will never
 * self-heal. This closes that gap once.
 *
 * It deliberately calls lib/hubspot-* directly rather than POSTing to
 * /api/webhooks/apollo. Same decision logic, so a backfilled deal is
 * indistinguishable from a live one — but no shared secret to handle, no
 * network hop per record, and a real dry run.
 *
 * Safe to re-run. `decideDealAction` treats an existing open deal as a no-op,
 * so a half-finished run is resumed simply by running it again.
 *
 * Prerequisites (.env.local):
 *   APOLLO_API_KEY            emailer_messages_search enabled (or Master key)
 *   HUBSPOT_ACCESS_TOKEN      contacts + deals + companies read/write
 *
 * Run:
 *   npm run backfill:apollo                 # dry run — writes nothing
 *   npm run backfill:apollo -- --apply      # write to HubSpot
 *   npm run backfill:apollo -- --limit 25   # cap the number of contacts
 *   npm run backfill:apollo -- --apply --limit 25
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'

const envPath = path.resolve(process.cwd(), '.env.local')
dotenv.config(fs.existsSync(envPath) ? { path: envPath } : {})

const APPLY = process.argv.includes('--apply')
const limitArg = process.argv.indexOf('--limit')
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity

const KEY = process.env.APOLLO_API_KEY
const APOLLO_URL = 'https://api.apollo.io/api/v1/emailer_messages/search'
const PER_PAGE = 100
const MAX_PAGES = 500 // Apollo's own cap: 50,000 records
const PACE_MS = 300 // keep clear of HubSpot's burst limit

type Engagement = 'clicked' | 'replied'

interface Prospect {
  email: string
  engagement: Engagement
  firstName?: string
  lastName?: string
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/* ── Apollo ──────────────────────────────────────────────────────────────── */

async function apollo(body: Record<string, unknown>) {
  const res = await fetch(APOLLO_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      accept: 'application/json',
      'Cache-Control': 'no-cache',
      'x-api-key': KEY as string,
    },
    body: JSON.stringify(body),
  })
  if (res.status === 429) {
    console.log('   … rate limited by Apollo, waiting 60s')
    await sleep(60_000)
    return apollo(body)
  }
  const text = await res.text()
  if (!res.ok) throw new Error(`Apollo ${res.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text) as Record<string, unknown>
}

function messagesOf(json: Record<string, unknown>): Record<string, unknown>[] {
  for (const k of ['emailer_messages', 'messages', 'results']) {
    const v = json[k]
    if (Array.isArray(v)) return v as Record<string, unknown>[]
  }
  return []
}

/** First value at any depth under one of `keys` matching `test`. */
function deepFind(
  node: unknown,
  keys: string[],
  test: (v: string) => boolean,
  depth = 0,
): string | undefined {
  if (depth > 6 || !node || typeof node !== 'object') return undefined
  const wanted = new Set(keys.map((k) => k.toLowerCase()))
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (typeof v === 'string' && wanted.has(k.toLowerCase()) && test(v)) return v.trim()
  }
  for (const v of Object.values(node as Record<string, unknown>)) {
    if (v && typeof v === 'object') {
      const found = deepFind(v, keys, test, depth + 1)
      if (found) return found
    }
  }
  return undefined
}

const isEmail = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim())
const nonEmpty = (v: string) => v.trim().length > 0

function toProspect(msg: Record<string, unknown>, engagement: Engagement): Prospect | null {
  const email = deepFind(msg, ['to_email', 'email', 'recipient_email', 'contact_email'], isEmail)
  if (!email) return null
  // Apollo sends a single `to_name`, not first/last. And the message carries no
  // organisation at all — `account_id` on it is the *sending* mailbox, not the
  // prospect's company — so the company is resolved from the email domain and
  // named after it until something better enriches it.
  const toName = deepFind(msg, ['to_name'], nonEmpty)
  const [firstName, ...rest] = (toName ?? '').split(/\s+/).filter(Boolean)
  return {
    email: email.toLowerCase(),
    engagement,
    firstName: firstName || undefined,
    lastName: rest.length ? rest.join(' ') : undefined,
  }
}

async function collect(
  label: string,
  filter: Record<string, unknown>,
  engagement: Engagement,
  into: Map<string, Prospect>,
) {
  console.log(`\nFetching ${label} from Apollo…`)
  let page = 1
  let seen = 0
  let rejected = 0
  while (page <= MAX_PAGES) {
    const json = await apollo({ ...filter, page, per_page: PER_PAGE })
    const msgs = messagesOf(json)
    if (!msgs.length) break
    for (const m of msgs) {
      seen++
      // Apollo silently IGNORES an unrecognised stat value and returns the
      // unfiltered set — which is mostly `scheduled`, i.e. queued mail that has
      // never been sent. Importing that as engagement would invent a pipeline
      // out of nothing, so every message is checked rather than trusted.
      if (m.status !== 'completed') {
        rejected++
        continue
      }
      if (engagement === 'replied' && m.replied !== true) {
        rejected++
        continue
      }
      const p = toProspect(m, engagement)
      if (!p) continue
      const existing = into.get(p.email)
      // Replied outranks clicked: taking the strongest signal per person avoids
      // opening a deal at Initial Interest only to advance it a moment later.
      if (!existing || (existing.engagement === 'clicked' && engagement === 'replied')) {
        into.set(p.email, { ...existing, ...p, engagement: existing ? 'replied' : engagement })
      }
    }
    process.stdout.write(`\r   page ${page} — ${seen} messages, ${into.size} distinct contacts`)
    if (msgs.length < PER_PAGE) break
    page++
    await sleep(150)
  }
  console.log('')
  if (rejected) {
    console.log(`   ${rejected} message(s) rejected as not genuine ${label}`)
    if (rejected > seen / 2) {
      throw new Error(
        `Over half the "${label}" messages failed the sanity check — Apollo is ` +
          'likely ignoring the filter and returning unsent mail. Refusing to continue.',
      )
    }
  }
}

/* ── Main ────────────────────────────────────────────────────────────────── */

async function main() {
  if (!KEY) {
    console.error('✗ APOLLO_API_KEY is not set in .env.local. Run `npm run probe:apollo` first.')
    process.exit(1)
  }

  const { decideDealAction, dealsForContact, createDeal, moveDealToStage } = await import(
    '../lib/hubspot-deals'
  )
  const { ensureCompany, associateDefault, domainFromEmail, findCompanyByDomain } =
    await import('../lib/hubspot-companies')
  const { getContactByEmail, upsertContact } = await import('../lib/hubspot')

  console.log(APPLY ? '*** APPLY — writing to HubSpot ***' : 'DRY RUN — nothing will be written')

  const prospects = new Map<string, Prospect>()
  await collect('clicks', { emailer_message_stats: ['clicked'] }, 'clicked', prospects)
  // stats:["replied"] rather than emailer_message_reply_classes: the probe
  // showed reply_classes returns only replies that have been *classified*
  // (8 of 11), silently dropping the rest.
  await collect('replies', { emailer_message_stats: ['replied'] }, 'replied', prospects)

  const all = [...prospects.values()].slice(0, LIMIT)
  const clicked = all.filter((p) => p.engagement === 'clicked').length
  const replied = all.filter((p) => p.engagement === 'replied').length
  console.log(
    `\n${all.length} distinct contacts to process ` +
      `(${clicked} clicked → Initial Interest, ${replied} replied → Initial Engagement)` +
      (LIMIT !== Infinity ? `  [capped at ${LIMIT}]` : ''),
  )

  const tally = { created: 0, advanced: 0, skipped: 0, companies: 0, failed: 0 }
  const previewedDomains = new Set<string>()
  const knownDomains = new Set<string>()

  for (const [i, p] of all.entries()) {
    const n = `${i + 1}/${all.length}`
    try {
      let contact = await getContactByEmail(p.email, ['firstname', 'lastname'])
      if (!contact) {
        if (!APPLY) {
          console.log(`  ${n} ${p.email} — would create contact + deal (${p.engagement})`)
          tally.created++
          continue
        }
        const made = await upsertContact({
          email: p.email,
          firstName: p.firstName,
          lastName: p.lastName,
          lifecycleStage: 'lead',
        })
        if (!made.ok || !made.id) {
          console.log(`  ${n} ${p.email} — FAILED contact write`)
          tally.failed++
          continue
        }
        contact = { id: made.id, properties: {} }
      }

      // In a dry run the company is still *looked up* — read-only — so the
      // preview reports how many new accounts would appear rather than zero.
      let company: { id: string; created: boolean } | null = null
      if (APPLY) {
        company = await ensureCompany({ email: p.email })
      } else {
        const dom = domainFromEmail(p.email)
        if (dom && !previewedDomains.has(dom) && !knownDomains.has(dom)) {
          const found = await findCompanyByDomain(dom)
          if (found.status === 'absent') previewedDomains.add(dom)
          else if (found.status === 'found') knownDomains.add(dom)
        }
      }
      if (company) {
        if (company.created) tally.companies++
        await associateDefault('contacts', contact.id, 'companies', company.id)
      }

      const decision = decideDealAction(p.engagement, await dealsForContact(contact.id))

      if (decision.action === 'none') {
        console.log(`  ${n} ${p.email} — already has an open deal, skipping`)
        tally.skipped++
      } else if (!APPLY) {
        console.log(`  ${n} ${p.email} — would ${decision.action} (${p.engagement})`)
        decision.action === 'create' ? tally.created++ : tally.advanced++
      } else if (decision.action === 'create') {
        const label = [p.firstName, p.lastName].filter(Boolean).join(' ').trim()
        const deal = await createDeal({
          name: `${label || p.email} — Outbound (Apollo backfill)`,
          stage: decision.stage,
          contactId: contact.id,
        })
        if (deal.ok && deal.id) {
          if (company) await associateDefault('deals', deal.id, 'companies', company.id)
          console.log(`  ${n} ${p.email} — created deal ${deal.id} (${p.engagement})`)
          tally.created++
        } else {
          console.log(`  ${n} ${p.email} — FAILED deal create`)
          tally.failed++
        }
      } else {
        const moved = await moveDealToStage(decision.dealId, decision.stage)
        if (moved.ok && company) await associateDefault('deals', decision.dealId, 'companies', company.id)
        console.log(`  ${n} ${p.email} — advanced deal ${decision.dealId}`)
        moved.ok ? tally.advanced++ : tally.failed++
      }
    } catch (err) {
      console.log(`  ${n} ${p.email} — ERROR ${(err as Error).message.slice(0, 120)}`)
      tally.failed++
    }
    if (APPLY) await sleep(PACE_MS)
  }

  console.log(
    `\n${APPLY ? 'Applied' : 'Would apply'}: ` +
      `${tally.created} created, ${tally.advanced} advanced, ${tally.skipped} skipped, ` +
      `${tally.companies} companies created, ${tally.failed} failed`,
  )
  if (!APPLY) console.log('\nRe-run with --apply to write. Safe to re-run: repeats are no-ops.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
