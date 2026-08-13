import { NextRequest, NextResponse } from 'next/server'
import { searchContacts, setLifecycleStage } from '@/lib/hubspot'
import { HS, LEAD_SOURCE_LIFECYCLE, LEAD_SOURCES, SUBSCRIBER_LEAD_SOURCES } from '@/lib/hubspot-fields'

// GET /api/cron/hubspot-lifecycle — runs daily (see vercel.json).
//
// Puts newsletter, white-paper, asset-request and event-notify contacts back on
// **Subscriber** after HubSpot has stamped them Lead.
//
// Why this cannot be done at capture time
// ---------------------------------------
// A HubSpot form submission sets a new contact's lifecycle stage to Lead, and
// does it *asynchronously* — seconds after the submission returns. Anything
// written inline is overwritten a moment later. And HubSpot silently discards
// any write that moves a stage backwards: the PATCH returns 200 and nothing
// changes. Both verified against portal 24379847.
//
// So the correction has to happen after HubSpot has finished, which means out
// of band. A HubSpot workflow would be the natural home for this, but workflows
// need Marketing Hub Professional and this portal is on a lower tier.
//
// Why it only looks at recent contacts
// ------------------------------------
// `stellr_lead_source` is durable — it stays "Newsletter" forever. If this job
// scanned all history it would also demote someone who signed up for the
// newsletter last year and has since legitimately become a Lead through sales
// activity. The lookback keeps it to contacts still in the window where the
// only thing that could have set Lead is the form itself.
//
// Contacts already past Lead (MQL, customer, …) are never touched: the filter
// matches `lifecyclestage = lead` exactly.

export const dynamic = 'force-dynamic'

/** How far back to reconcile. Long enough to survive a couple of failed runs. */
const LOOKBACK_DAYS = 3

/** Bounded so a runaway filter cannot rewrite the whole database. */
const MAX_PER_RUN = 100

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.HUBSPOT_ACCESS_TOKEN) {
    return NextResponse.json({ error: 'HUBSPOT_ACCESS_TOKEN not set', corrected: 0 }, { status: 200 })
  }

  const since = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000

  // One filter group per source: HubSpot ANDs filters within a group and ORs
  // across groups, so "source is one of these AND stage is lead AND recent"
  // has to be expressed as a group per source.
  const filterGroups = SUBSCRIBER_LEAD_SOURCES.map((source) => ({
    filters: [
      { propertyName: HS.leadSource, operator: 'EQ', value: LEAD_SOURCES[source] },
      { propertyName: HS.lifecycleStage, operator: 'EQ', value: 'lead' },
      { propertyName: 'createdate', operator: 'GTE', value: String(since) },
    ],
  }))

  const candidates = await searchContacts(
    filterGroups,
    ['email', HS.leadSource, HS.lifecycleStage, 'createdate'],
    MAX_PER_RUN,
  )

  const corrected: string[] = []
  const failed: { email?: string; error?: string }[] = []

  for (const contact of candidates) {
    const source = contact.properties[HS.leadSource]
    // Re-derive the intended stage from the source rather than assuming
    // subscriber — if a source is ever reclassified, this follows it.
    const intended = (Object.keys(LEAD_SOURCES) as (keyof typeof LEAD_SOURCES)[]).find(
      (key) => LEAD_SOURCES[key] === source,
    )
    const stage = intended ? LEAD_SOURCE_LIFECYCLE[intended] : undefined

    // Only ever moves toward subscriber here; anything else is already correct.
    if (stage !== 'subscriber') continue

    const result = await setLifecycleStage(contact.id, 'subscriber')
    if (result.ok) corrected.push(contact.properties.email ?? contact.id)
    else failed.push({ email: contact.properties.email, error: result.error })
  }

  // A full page means there may be more waiting; the next run will take them,
  // but say so rather than let a backlog build silently.
  const truncated = candidates.length === MAX_PER_RUN

  const summary = {
    scanned: candidates.length,
    corrected: corrected.length,
    failed: failed.length,
    moreLikelyPending: truncated,
    lookbackDays: LOOKBACK_DAYS,
  }

  if (corrected.length || failed.length) {
    console.log('[cron:hubspot-lifecycle]', JSON.stringify({ ...summary, corrected, failed }))
  }

  return NextResponse.json(summary, { status: 200 })
}
