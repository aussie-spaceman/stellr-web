import { NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  classify,
  findEmail,
  findString,
  normaliseEngagement,
} from '@/lib/apollo-events'
import { createNote, getContactByEmail, upsertContact } from '@/lib/hubspot'
import {
  createDeal,
  dealsForContact,
  decideDealAction,
  moveDealToStage,
  type Engagement,
} from '@/lib/hubspot-deals'

/**
 * Apollo outbound engagement → HubSpot Participant Pipeline deal.
 *
 *   link clicked → deal at Initial Interest
 *   replied      → deal at Initial Engagement
 *
 * Driven by two Apollo workflows (Workflows → trigger "Email clicked" /
 * "Email replied" → action "Send webhook"), each POSTing to its own URL:
 *
 *   .../api/webhooks/apollo?event=clicked
 *   .../api/webhooks/apollo?event=replied
 *
 * The query parameter is load-bearing. Apollo's Send-webhook action posts the
 * enrolled contact record, and which trigger fired is a property of the
 * workflow, not of the payload — so there is generally nothing in the body that
 * distinguishes a click from a reply. Both workflows must carry the header
 * `x-apollo-webhook-secret: $APOLLO_WEBHOOK_SECRET`.
 *
 * This runs as our own endpoint rather than a HubSpot workflow because the
 * portal is on Starter seats, and the "create a deal" workflow action is
 * Professional-and-above. It is not a stopgap for a missing HubSpot feature so
 * much as the only automated route available on this plan.
 *
 * Tolerant about payload shape, strict about identity and duplicates. Apollo's
 * webhook event names are configured in their UI and are not pinned by public
 * docs, so the event is matched on substring across whichever fields carry it
 * rather than against one hard-coded constant that a rename would silently
 * break. Anything unrecognised is logged in full and acknowledged — the first
 * real event is what tells us the true shape.
 */

const SECRET = process.env.APOLLO_WEBHOOK_SECRET

/** Constant-time compare that cannot throw on a length mismatch. */
function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/**
 * Apollo's webhook config offers a static auth header, not an HMAC signature,
 * so the shared secret is the primary path. The HMAC branch is kept for the
 * case where the webhook is fronted by Zapier/Make, which sign instead.
 */
function authorised(raw: string, req: Request): boolean {
  if (!SECRET) return false

  const shared =
    req.headers.get('x-apollo-webhook-secret') ??
    req.headers.get('x-webhook-secret') ??
    ''
  if (shared && constantTimeEquals(shared.trim(), SECRET)) return true

  const signature =
    req.headers.get('x-apollo-signature') ??
    req.headers.get('x-hub-signature-256') ??
    req.headers.get('x-signature') ??
    ''
  if (!signature) return false
  const expected = createHmac('sha256', SECRET).update(raw).digest('hex')
  return constantTimeEquals(expected, signature.replace(/^sha256=/, '').trim())
}

async function handleEvent(
  payload: unknown,
  declared: Engagement | undefined,
): Promise<Record<string, unknown>> {
  // The URL wins: each Apollo workflow is pointed at its own `?event=` value,
  // which is the only thing that reliably says which trigger fired.
  const engagement = declared ?? classify(payload)
  if (!engagement) {
    console.warn('[apollo-webhook] Unrecognised event, ignoring:', JSON.stringify(payload))
    return {
      ok: true,
      ignored:
        'could not tell a click from a reply — point the Apollo workflow at ' +
        '?event=clicked or ?event=replied',
    }
  }

  const email = findEmail(payload)
  if (!email) {
    console.error('[apollo-webhook] No email in payload:', JSON.stringify(payload))
    return { ok: true, ignored: 'no email in payload' }
  }

  // Unlike the Motion webhook, this one *does* create the contact when absent.
  // Apollo is a prospecting tool: the whole point is that these people are not
  // in HubSpot yet, and a deal with no contact on it is not actionable.
  let contact = await getContactByEmail(email, ['firstname', 'lastname'])
  if (!contact) {
    const created = await upsertContact({
      email,
      firstName: findString(payload, ['first_name', 'firstName', 'firstname']),
      lastName: findString(payload, ['last_name', 'lastName', 'lastname']),
      lifecycleStage: 'lead',
    })
    if (!created.ok || !created.id) {
      console.error('[apollo-webhook] Could not create contact for', email)
      return { ok: false, error: 'contact write failed' }
    }
    contact = { id: created.id, properties: {} }
  }

  const decision = decideDealAction(engagement, await dealsForContact(contact.id))
  const sequence = findString(payload, ['sequence_name', 'sequenceName', 'emailer_campaign_name'])
  const label = [contact.properties.firstname, contact.properties.lastname]
    .filter(Boolean)
    .join(' ')
    .trim()

  if (decision.action === 'none') {
    console.log('[apollo-webhook]', email, engagement, '→ no change:', decision.reason)
    return { ok: true, email, engagement, action: 'none', reason: decision.reason }
  }

  if (decision.action === 'create') {
    const deal = await createDeal({
      name: `${label || email} — Outbound${sequence ? ` (${sequence})` : ''}`,
      stage: decision.stage,
      contactId: contact.id,
    })
    if (deal.ok) {
      await createNote(
        contact.id,
        `Apollo: ${engagement} — opened a Participant Pipeline deal at ` +
          `${engagement === 'replied' ? 'Initial Engagement' : 'Initial Interest'}` +
          `${sequence ? ` from sequence "${sequence}"` : ''}.`,
      )
    }
    return { ok: deal.ok, email, engagement, action: 'create', dealId: deal.id }
  }

  const moved = await moveDealToStage(decision.dealId, decision.stage)
  if (moved.ok) {
    await createNote(
      contact.id,
      `Apollo: ${engagement} — moved deal ${decision.dealId} to Initial Engagement` +
        `${sequence ? ` from sequence "${sequence}"` : ''}.`,
    )
  }
  return {
    ok: moved.ok,
    email,
    engagement,
    action: 'advance',
    dealId: decision.dealId,
  }
}

export async function POST(req: Request) {
  if (!SECRET) {
    console.error('[apollo-webhook] APOLLO_WEBHOOK_SECRET is not set — refusing to write')
    return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  }

  // Raw body first: req.json() would consume the stream and leave nothing to
  // verify the HMAC against.
  const raw = await req.text()
  if (!authorised(raw, req)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Malformed body' }, { status: 400 })
  }

  // Apollo may send one event or a batch; treat both the same.
  const declared = normaliseEngagement(new URL(req.url).searchParams.get('event'))

  const events = Array.isArray(payload) ? payload : [payload]
  const results = []
  for (const event of events) results.push(await handleEvent(event, declared))

  return NextResponse.json(results.length === 1 ? results[0] : { ok: true, results })
}
