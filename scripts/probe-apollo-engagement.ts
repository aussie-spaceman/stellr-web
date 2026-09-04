/**
 * Read-only probe of Apollo's engagement history.
 *
 * Runs before the backfill to answer the three things that decide its shape and
 * that cannot be settled from Apollo's public docs:
 *
 *   1. **How many** contacts have clicked, and how many have replied. This is
 *      the number that governs whether a backfill is a handful of deals or a
 *      pipeline flood, so it is worth knowing before anything is written.
 *   2. **How replies are actually filtered.** The documented
 *      `emailer_message_stats[]` enum lists "clicked" but NOT "replied";
 *      replies appear to be reachable only through
 *      `emailer_message_reply_classes[]`. This tries both and reports which the
 *      API accepts.
 *   3. **Where the recipient's email and organisation live in the payload.**
 *      The whole backfill keys on the email, so the field names matter.
 *
 * Costs 0 credits per Apollo's docs. Writes nothing, to Apollo or HubSpot.
 *
 * Prerequisites (.env.local): APOLLO_API_KEY with the emailer_messages_search
 * endpoint enabled (or a Master key).
 *
 * Run:
 *   npm run probe:apollo
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'

const envPath = path.resolve(process.cwd(), '.env.local')
dotenv.config(fs.existsSync(envPath) ? { path: envPath } : {})

const KEY = process.env.APOLLO_API_KEY
const URL = 'https://api.apollo.io/api/v1/emailer_messages/search'

const REPLY_CLASSES = [
  'willing_to_meet',
  'follow_up_question',
  'not_interested',
  'no_longer_at_company',
  'out_of_office',
  'unsubscribe',
  'other',
]

async function search(body: Record<string, unknown>) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      accept: 'application/json',
      'Cache-Control': 'no-cache',
      'x-api-key': KEY as string,
    },
    body: JSON.stringify({ page: 1, per_page: 1, ...body }),
  })
  const text = await res.text()
  let json: Record<string, unknown> = {}
  try {
    json = JSON.parse(text)
  } catch {
    /* non-JSON error body */
  }
  return { status: res.status, json, text }
}

/** Apollo reports totals under pagination; be tolerant of the exact shape. */
function totalOf(json: Record<string, unknown>): string {
  const p = json.pagination as Record<string, unknown> | undefined
  const t = p?.total_entries ?? p?.total ?? json.total_entries ?? json.total
  return t === undefined ? '?' : String(t)
}

function messagesOf(json: Record<string, unknown>): Record<string, unknown>[] {
  for (const k of ['emailer_messages', 'messages', 'results']) {
    const v = json[k]
    if (Array.isArray(v)) return v as Record<string, unknown>[]
  }
  return []
}

/** Every key path holding a string that looks like an email address. */
function emailPaths(node: unknown, prefix = '', out: string[] = [], depth = 0): string[] {
  if (depth > 5 || !node || typeof node !== 'object') return out
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) out.push(`${p} = ${v}`)
    else if (v && typeof v === 'object') emailPaths(v, p, out, depth + 1)
  }
  return out
}

async function main() {
  if (!KEY) {
    console.error(
      '✗ APOLLO_API_KEY is not set in .env.local.\n' +
        '  Apollo → Settings → Integrations → API. The key needs the\n' +
        '  emailer_messages_search endpoint enabled (or use a Master key).',
    )
    process.exit(1)
  }

  console.log('1. Which filters does the API accept?\n')

  const clicked = await search({ emailer_message_stats: ['clicked'] })
  console.log(`   emailer_message_stats:["clicked"]   ${clicked.status}  total=${totalOf(clicked.json)}`)
  if (clicked.status === 401 || clicked.status === 403) {
    console.error(
      `\n✗ Apollo rejected the key (${clicked.status}). Check that the key exists and\n` +
        `  that the emailer_messages_search endpoint is enabled for it.\n  ${clicked.text.slice(0, 200)}`,
    )
    process.exit(1)
  }

  const repliedStat = await search({ emailer_message_stats: ['replied'] })
  console.log(`   emailer_message_stats:["replied"]   ${repliedStat.status}  total=${totalOf(repliedStat.json)}`)

  const repliedClasses = await search({ emailer_message_reply_classes: REPLY_CLASSES })
  console.log(
    `   emailer_message_reply_classes:[all]  ${repliedClasses.status}  total=${totalOf(repliedClasses.json)}`,
  )

  console.log('\n2. Volume\n')
  console.log(`   clicked messages : ${totalOf(clicked.json)}`)
  console.log(
    `   replied messages : ${
      repliedStat.status === 200 && totalOf(repliedStat.json) !== '?'
        ? totalOf(repliedStat.json)
        : totalOf(repliedClasses.json)
    }`,
  )
  console.log('\n   (messages, not people — one contact can have many. The backfill')
  console.log('    collapses to one deal per contact, so deals created will be fewer.)')

  console.log('\n3. Payload shape — where the email and organisation live\n')
  const sample = messagesOf(clicked.json)[0] ?? messagesOf(repliedClasses.json)[0]
  if (!sample) {
    console.log('   No sample message returned; nothing to inspect.')
  } else {
    console.log('   top-level keys:', Object.keys(sample).join(', ').slice(0, 400))
    const emails = emailPaths(sample)
    console.log('\n   email-shaped values:')
    for (const e of emails.slice(0, 12)) console.log('     ', e)
    if (!emails.length) console.log('      (none found — the backfill cannot key on this response)')
    const orgKeys = Object.keys(sample).filter((k) => /org|company|account|domain|website/i.test(k))
    console.log('\n   organisation-ish keys:', orgKeys.join(', ') || '(none at top level)')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
