// Deal writes for the Participant Pipeline.
//
// Everything else in this codebase writes *contacts* to HubSpot; this is the
// first module that writes deals. It exists for one job: turning an Apollo
// outbound-email engagement into a deal sitting at the right stage, without
// producing a duplicate every time the same prospect clicks the same link.
//
// The dedupe is the whole point. A tracking pixel and a link redirect are noisy
// signals — one prospect forwarding an email, or an inbox scanner prefetching
// links, can fire "clicked" many times in a minute. Creating a deal per event
// would bury the pipeline in duplicates within a single sequence.
//
// Required env: HUBSPOT_ACCESS_TOKEN (same Service Key the rest of lib uses).
// Scopes: crm.objects.deals.read, crm.objects.deals.write, plus the contacts
// scopes already granted.

const HUBSPOT_ACCESS_TOKEN = process.env.HUBSPOT_ACCESS_TOKEN
const BASE = 'https://api.hubapi.com'

/** deal → contact, HubSpot-defined association type. */
const ASSOCIATION_DEAL_TO_CONTACT = 3

/** Read from the live portal (get_properties on `deals`), not guessed. */
export const PARTICIPANT_PIPELINE_ID = '922800968'

export const PARTICIPANT_STAGE = {
  initialInterest: '1412578129',
  initialEngagement: '1431576456',
  qualifiedToBuy: '1412578130',
  decisionMakerBoughtIn: '1412578132',
  closedWon: '1412578134',
  closedLost: '1412578135',
} as const

/**
 * How far along the pipeline each stage sits. Used only to refuse *backwards*
 * moves: a click arriving after a reply (Apollo re-fires opens and clicks for
 * the life of the thread) must not demote an engaged prospect back to Initial
 * Interest. Unknown stages sort to 0 so a manually-created deal at a stage we
 * do not model is treated as "behind" and is advanced rather than skipped.
 */
const STAGE_RANK: Record<string, number> = {
  [PARTICIPANT_STAGE.initialInterest]: 1,
  [PARTICIPANT_STAGE.initialEngagement]: 2,
  [PARTICIPANT_STAGE.qualifiedToBuy]: 3,
  [PARTICIPANT_STAGE.decisionMakerBoughtIn]: 4,
}

const CLOSED_STAGES = new Set<string>([
  PARTICIPANT_STAGE.closedWon,
  PARTICIPANT_STAGE.closedLost,
])

export type Engagement = 'clicked' | 'replied'

/** The stage each Apollo engagement maps to, per the brief. */
export const STAGE_FOR: Record<Engagement, string> = {
  clicked: PARTICIPANT_STAGE.initialInterest,
  replied: PARTICIPANT_STAGE.initialEngagement,
}

export interface DealSnapshot {
  id: string
  pipeline: string
  stage: string
}

export type DealDecision =
  | { action: 'create'; stage: string }
  | { action: 'advance'; dealId: string; stage: string; from: string }
  | { action: 'none'; reason: string }

/**
 * Decide what a given engagement should do, given the deals a contact already
 * has. Pure — no network — because this is the part worth testing exhaustively.
 *
 * Closed deals are ignored rather than reopened. A prospect who was marked
 * Closed Lost six months ago and clicks a new sequence is a fresh opportunity,
 * not a resurrection of the old one; reopening would silently rewrite closed
 * history and corrupt win/loss reporting.
 */
export function decideDealAction(
  engagement: Engagement,
  existing: DealSnapshot[],
): DealDecision {
  const target = STAGE_FOR[engagement]
  const targetRank = STAGE_RANK[target] ?? 0

  const open = existing.filter(
    (d) => d.pipeline === PARTICIPANT_PIPELINE_ID && !CLOSED_STAGES.has(d.stage),
  )

  if (open.length === 0) return { action: 'create', stage: target }

  // Advance the furthest-along open deal, so a contact who somehow has two
  // never gets a third and never gets dragged backwards by the older one.
  const furthest = open.reduce((a, b) =>
    (STAGE_RANK[b.stage] ?? 0) > (STAGE_RANK[a.stage] ?? 0) ? b : a,
  )
  const currentRank = STAGE_RANK[furthest.stage] ?? 0

  if (targetRank > currentRank) {
    return { action: 'advance', dealId: furthest.id, stage: target, from: furthest.stage }
  }
  return {
    action: 'none',
    reason: `open deal ${furthest.id} is already at or beyond ${target}`,
  }
}

/* ── HubSpot I/O ─────────────────────────────────────────────────────────── */

async function hubspot(path: string, method: 'GET' | 'POST' | 'PATCH', body?: unknown) {
  return fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${HUBSPOT_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

/**
 * Every deal already associated with a contact.
 *
 * Deliberately the associations API followed by a batch read, not the deal
 * *search* endpoint. Search runs off an index that lags writes by seconds, and
 * two clicks landing a second apart would both read "no deals" and both create
 * one — the exact duplicate this module exists to prevent. Associations are
 * read-after-write consistent.
 */
export async function dealsForContact(contactId: string): Promise<DealSnapshot[]> {
  if (!HUBSPOT_ACCESS_TOKEN) return []
  try {
    const assoc = await hubspot(
      `/crm/v4/objects/contacts/${contactId}/associations/deals?limit=100`,
      'GET',
    )
    if (!assoc.ok) return []
    const assocJson = (await assoc.json()) as { results?: { toObjectId?: string | number }[] }
    const ids = (assocJson.results ?? [])
      .map((r) => String(r.toObjectId ?? ''))
      .filter(Boolean)
    if (ids.length === 0) return []

    const read = await hubspot('/crm/v3/objects/deals/batch/read', 'POST', {
      properties: ['pipeline', 'dealstage'],
      inputs: ids.map((id) => ({ id })),
    })
    if (!read.ok) return []
    const readJson = (await read.json()) as {
      results?: { id: string; properties?: Record<string, string> }[]
    }
    return (readJson.results ?? []).map((d) => ({
      id: d.id,
      pipeline: d.properties?.pipeline ?? '',
      stage: d.properties?.dealstage ?? '',
    }))
  } catch (err) {
    console.error('[hubspot-deals] Failed reading deals for contact', contactId, err)
    return []
  }
}

export async function createDeal(input: {
  name: string
  stage: string
  contactId: string
}): Promise<{ ok: boolean; id?: string }> {
  if (!HUBSPOT_ACCESS_TOKEN) {
    console.log('[hubspot-deals] No token — would have created deal:', input.name)
    return { ok: false }
  }
  try {
    const res = await hubspot('/crm/v3/objects/deals', 'POST', {
      properties: {
        dealname: input.name,
        pipeline: PARTICIPANT_PIPELINE_ID,
        dealstage: input.stage,
      },
      associations: [
        {
          to: { id: input.contactId },
          types: [
            {
              associationCategory: 'HUBSPOT_DEFINED',
              associationTypeId: ASSOCIATION_DEAL_TO_CONTACT,
            },
          ],
        },
      ],
    })
    if (!res.ok) {
      console.error('[hubspot-deals] Create failed', res.status, await res.text())
      return { ok: false }
    }
    const json = (await res.json()) as { id: string }
    return { ok: true, id: json.id }
  } catch (err) {
    console.error('[hubspot-deals] Create threw', err)
    return { ok: false }
  }
}

export async function moveDealToStage(
  dealId: string,
  stage: string,
): Promise<{ ok: boolean }> {
  if (!HUBSPOT_ACCESS_TOKEN) return { ok: false }
  try {
    const res = await hubspot(`/crm/v3/objects/deals/${dealId}`, 'PATCH', {
      properties: { dealstage: stage },
    })
    if (!res.ok) {
      console.error('[hubspot-deals] Stage move failed', res.status, await res.text())
      return { ok: false }
    }
    return { ok: true }
  } catch (err) {
    console.error('[hubspot-deals] Stage move threw', err)
    return { ok: false }
  }
}
