// Reconciliation between Apollo engagement and HubSpot deals.
//
// The webhook is the fast path, not the reliable one. It is fire-and-forget:
// if Apollo never calls, or calls with a payload we cannot use, the event is
// gone and nothing anywhere says so. That failure is not hypothetical — the
// integration silently dropped every event for five days because Apollo's
// "Send webhook" action was configured with an empty request body, so each
// delivery arrived as an unparseable POST and was rejected.
//
// This module is the safety net: it asks Apollo what has engaged, asks HubSpot
// what already has a deal, and closes the difference. It is the same decision
// logic the webhook uses, so a reconciled deal is indistinguishable from a
// live one, and it is idempotent — an existing open deal is a no-op, so it can
// run on a schedule forever and do nothing until it is needed.
//
// Used by both `scripts/backfill-apollo-engagement.ts` (manual, with a dry run)
// and `app/api/cron/apollo-reconcile/route.ts` (daily).

import { createNote, getContactByEmail, upsertContact } from '@/lib/hubspot'
import {
  createDeal,
  dealsForContact,
  decideDealAction,
  moveDealToStage,
  type Engagement,
} from '@/lib/hubspot-deals'
import { associateDefault, ensureCompany } from '@/lib/hubspot-companies'

const APOLLO_URL = 'https://api.apollo.io/api/v1/emailer_messages/search'
const PER_PAGE = 100
const MAX_PAGES = 500 // Apollo's own cap: 50,000 records

export interface Prospect {
  email: string
  engagement: Engagement
  firstName?: string
  lastName?: string
}

export interface ReconcileResult {
  considered: number
  /** Engaged prospects Apollo returned, before any windowing. */
  total: number
  /** True when `total` exceeded the limit, so this run saw only part of them. */
  truncated: boolean
  /** Index this run's window started at. Rotates so coverage completes. */
  windowOffset: number
  created: number
  advanced: number
  skipped: number
  companiesCreated: number
  failed: number
  /** Only the records that changed — what an alert or a log line should name. */
  changes: { email: string; engagement: Engagement; action: string; dealId?: string }[]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/* ── Apollo ──────────────────────────────────────────────────────────────── */

async function apollo(apiKey: string, body: Record<string, unknown>) {
  const res = await fetch(APOLLO_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      accept: 'application/json',
      'Cache-Control': 'no-cache',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(body),
  })
  if (res.status === 429) {
    await sleep(60_000)
    return apollo(apiKey, body)
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

async function collect(
  apiKey: string,
  filter: Record<string, unknown>,
  engagement: Engagement,
  into: Map<string, Prospect>,
) {
  let page = 1
  let seen = 0
  let rejected = 0
  while (page <= MAX_PAGES) {
    const json = await apollo(apiKey, { ...filter, page, per_page: PER_PAGE })
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
      const email = deepFind(m, ['to_email', 'email', 'recipient_email'], isEmail)
      if (!email) continue
      // Apollo sends one `to_name`, not first/last.
      const toName = deepFind(m, ['to_name'], nonEmpty)
      const [firstName, ...rest] = (toName ?? '').split(/\s+/).filter(Boolean)
      const key = email.toLowerCase()
      const existing = into.get(key)
      // Replied outranks clicked: one event per person, strongest signal, so we
      // never open a deal at Initial Interest only to advance it moments later.
      if (!existing || (existing.engagement === 'clicked' && engagement === 'replied')) {
        into.set(key, {
          email: key,
          engagement: existing ? 'replied' : engagement,
          firstName: firstName || existing?.firstName,
          lastName: rest.length ? rest.join(' ') : existing?.lastName,
        })
      }
    }
    if (msgs.length < PER_PAGE) break
    page++
    await sleep(150)
  }
  if (rejected > seen / 2 && seen > 0) {
    throw new Error(
      `Over half the "${engagement}" messages failed the sanity check — Apollo is ` +
        'likely ignoring the filter and returning unsent mail. Refusing to continue.',
    )
  }
}

/** Everyone in Apollo who has clicked or replied, one entry per person. */
export async function fetchEngagedProspects(apiKey: string): Promise<Prospect[]> {
  const found = new Map<string, Prospect>()
  await collect(apiKey, { emailer_message_stats: ['clicked'] }, 'clicked', found)
  // stats:["replied"] rather than emailer_message_reply_classes: the latter
  // returns only replies that have been *classified*, silently dropping the rest.
  await collect(apiKey, { emailer_message_stats: ['replied'] }, 'replied', found)
  return [...found.values()]
}

/* ── HubSpot ─────────────────────────────────────────────────────────────── */

export async function reconcileProspects(
  prospects: Prospect[],
  opts: {
    apply: boolean
    limit?: number
    /**
     * Where this run's window starts. Only meaningful when there are more
     * prospects than `limit`; callers should advance it between runs so every
     * prospect is eventually reached.
     */
    offset?: number
    paceMs?: number
    onLog?: (line: string) => void
  },
): Promise<ReconcileResult> {
  const log = opts.onLog ?? (() => {})
  const pace = opts.paceMs ?? 300
  // A ROTATING window, not the first N.
  //
  // This used to be `prospects.slice(0, limit)`, which took the same first 200
  // every run: past 200 engaged contacts, anyone beyond that index was never
  // reconciled and nothing said so. The limit itself is worth keeping — each
  // prospect costs several HubSpot round-trips, so an unbounded run would both
  // exhaust the rate limit and outlive the function — but the window has to move.
  //
  // Wrapping at the end means coverage completes in ceil(total / limit) runs.
  const total = prospects.length
  const limit = opts.limit && opts.limit > 0 ? opts.limit : total
  const truncated = total > limit
  const offset = truncated ? ((opts.offset ?? 0) % total + total) % total : 0
  const all = truncated
    ? [...prospects.slice(offset), ...prospects.slice(0, offset)].slice(0, limit)
    : prospects

  const r: ReconcileResult = {
    considered: all.length,
    total,
    truncated,
    windowOffset: offset,
    created: 0,
    advanced: 0,
    skipped: 0,
    companiesCreated: 0,
    failed: 0,
    changes: [],
  }

  for (const p of all) {
    try {
      let contact = await getContactByEmail(p.email, ['firstname', 'lastname'])

      if (!contact && !opts.apply) {
        log(`${p.email} — would create contact + deal (${p.engagement})`)
        r.created++
        r.changes.push({ email: p.email, engagement: p.engagement, action: 'create' })
        continue
      }
      if (!contact) {
        const made = await upsertContact({
          email: p.email,
          firstName: p.firstName,
          lastName: p.lastName,
          lifecycleStage: 'lead',
        })
        if (!made.ok || !made.id) {
          log(`${p.email} — FAILED contact write`)
          r.failed++
          continue
        }
        contact = { id: made.id, properties: {} }
      }

      const company = opts.apply ? await ensureCompany({ email: p.email }) : null
      if (company) {
        if (company.created) r.companiesCreated++
        await associateDefault('contacts', contact.id, 'companies', company.id)
      }

      const decision = decideDealAction(p.engagement, await dealsForContact(contact.id))

      if (decision.action === 'none') {
        r.skipped++
      } else if (!opts.apply) {
        log(`${p.email} — would ${decision.action} (${p.engagement})`)
        decision.action === 'create' ? r.created++ : r.advanced++
        r.changes.push({ email: p.email, engagement: p.engagement, action: decision.action })
      } else if (decision.action === 'create') {
        const label = [p.firstName, p.lastName].filter(Boolean).join(' ').trim()
        const deal = await createDeal({
          name: `${label || p.email} — Outbound (Apollo)`,
          stage: decision.stage,
          contactId: contact.id,
        })
        if (deal.ok && deal.id) {
          if (company) await associateDefault('deals', deal.id, 'companies', company.id)
          await createNote(
            contact.id,
            `Apollo: ${p.engagement} — opened a Participant Pipeline deal at ` +
              `${p.engagement === 'replied' ? 'Initial Engagement' : 'Initial Interest'} ` +
              `(reconciliation).`,
          )
          log(`${p.email} — created deal ${deal.id} (${p.engagement})`)
          r.created++
          r.changes.push({
            email: p.email,
            engagement: p.engagement,
            action: 'create',
            dealId: deal.id,
          })
        } else {
          log(`${p.email} — FAILED deal create`)
          r.failed++
        }
      } else {
        const moved = await moveDealToStage(decision.dealId, decision.stage)
        if (moved.ok) {
          if (company) await associateDefault('deals', decision.dealId, 'companies', company.id)
          log(`${p.email} — advanced deal ${decision.dealId}`)
          r.advanced++
          r.changes.push({
            email: p.email,
            engagement: p.engagement,
            action: 'advance',
            dealId: decision.dealId,
          })
        } else {
          r.failed++
        }
      }
    } catch (err) {
      log(`${p.email} — ERROR ${(err as Error).message.slice(0, 140)}`)
      r.failed++
    }
    if (opts.apply) await sleep(pace)
  }

  return r
}
