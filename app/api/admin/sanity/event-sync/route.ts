import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { syncEventSpace } from '@/lib/event-space-sync'
import { fireObjectCreatedRules } from '@/lib/object-created-rules'
import { safeStrEqual } from '@/lib/secret-compare'
import { ensureDistribution } from '@/lib/survey/distributions'
import { loadSurveyEvent } from '@/lib/survey/events'
import { isRealProductionApp } from '@/lib/env-guards'
import { syncEventOptions } from '@/lib/hubspot-event-options'

// POST /api/admin/sanity/event-sync — Sanity → Supabase access-structure sync
// (HANDOFF-CODE-REVIEW §7). Sanity is the source of truth for event CONTENT;
// admin/access (Supabase) is the source of truth for event ACCESS. On publish,
// a Sanity webhook calls this route with the event document; we upsert the
// event container, auto-provision its Event Space, and fire the
// object_created rules (auto-attach mandatory training etc.).
//
// The event↔Space pairing is keyed on the Sanity document _id, NOT the slug, so
// renaming an event in the Studio renames its Space instead of forking a second
// one and stranding the first. lib/event-space-sync carries that logic and is
// shared with `npm run sync:event-spaces`.
//
// Configure in Sanity: webhook on event create/update, URL this route, secret
// in SANITY_WEBHOOK_SECRET, sent as the `x-webhook-secret` HEADER.
//
// deep review AUTH-10: the `?secret=` query form was dropped — a query-string
// secret lands in Vercel access logs (and any proxy/referrer), so it is a
// leaked credential. The header form is the only one accepted now. A fuller fix
// — verifying Sanity's HMAC body signature with @sanity/webhook's
// isValidSignature and re-fetching the document by _id — is deliberately NOT
// done here: it needs a direct @sanity/webhook dependency AND the live Sanity
// webhook reconfigured to sign its payload, which is an operational change for
// the maintainer. Flagged for follow-up; the constant-time shared-secret compare
// below remains the guard in the meantime.

interface SanityEventPayload {
  _id?: string
  _type?: string
  title?: string
  slug?: { current?: string } | string
  activityType?: string
}

export async function POST(req: Request) {
  const secret = process.env.SANITY_WEBHOOK_SECRET
  // Header only — the ?secret= query form was removed (AUTH-10: it leaks into
  // access logs). A secret in the URL is a leaked credential, so we no longer
  // read one from the query string even if present.
  const provided = req.headers.get('x-webhook-secret')
  // Constant-time compare (this shared secret is the ONLY guard on this route —
  // there's no admin session — so the compare quality matters). Fails closed when
  // the secret is unset.
  if (!secret || !provided || !safeStrEqual(provided, secret)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => null)) as SanityEventPayload | null
  if (!body || (body._type && body._type !== 'event')) {
    return NextResponse.json({ error: 'Not an event payload' }, { status: 400 })
  }
  const slug = typeof body.slug === 'string' ? body.slug : body.slug?.current
  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 })
  // Without the _id there is no durable identity to match on, and matching on
  // slug is precisely the bug this route exists to avoid — so refuse rather than
  // fall back to it. Sanity sends _id on every document webhook.
  if (!body._id) return NextResponse.json({ error: '_id required' }, { status: 400 })
  const title = body.title ?? slug
  const objectType = body.activityType === 'campaign' ? ('campaign' as const) : ('event' as const)

  const db = supabaseServer()

  // Container + Space + event link + roster backfill, and a slug repair across
  // every table if the slug has moved since we last saw this _id.
  const sync = await syncEventSpace(db, { sanityId: body._id, slug, title })

  // Fire object_created rules (auto-attach configured spaces/courses/resources).
  const rules = await fireObjectCreatedRules({
    objectType,
    ref: slug,
    containerId: sync.containerId ?? undefined,
  })

  // Post-event survey: schedule it for a new event, or follow a date change /
  // cancellation (lib/survey/distributions.ts). The cron sweep does the same,
  // so a failure here is logged, not fatal. Sanity is re-read rather than
  // trusting the payload, which carries no date.
  let survey: string | null = null
  if (objectType === 'event') {
    try {
      const event = await loadSurveyEvent(slug)
      if (event) {
        const r = await ensureDistribution(db, event)
        survey = r.action === 'skipped' ? `skipped: ${r.reason}` : r.action
      }
    } catch (err) {
      console.error('[event-sync] survey schedule failed:', err)
      survey = 'error'
    }
  }

  // HubSpot event options (lib/hubspot-event-options.ts): a new venue, a new
  // school year or a cancellation changes the CRM's dropdowns, and this is the
  // moment it happens. The sync re-reads every event from Sanity, so the
  // payload's shape doesn't matter. One portal, no sandbox — so only the real
  // production app writes; the daily cron catches anything missed here.
  let hubspotOptions: string | Record<string, unknown> = 'skipped: not the production app'
  if (isRealProductionApp()) {
    try {
      const r = await syncEventOptions({ apply: true })
      hubspotOptions = {
        ok: r.ok,
        refused: r.refused,
        updated: r.properties
          .filter((p) => p.status === 'updated')
          .map((p) => `${p.object}.${p.property}`),
        failed: r.properties
          .filter((p) => p.status === 'failed')
          .map((p) => `${p.object}.${p.property}: ${p.error}`),
        form: r.form.status,
        unmapped: r.unmapped,
      }
    } catch (err) {
      console.error('[event-sync] HubSpot option sync failed:', err)
      hubspotOptions = 'error'
    }
  }

  return NextResponse.json({
    ok: true,
    slug,
    survey,
    hubspotOptions,
    containerId: sync.containerId,
    eventSpaceId: sync.spaceId,
    created: sync.created,
    renamedFrom: sync.renamedFrom,
    notes: sync.notes,
    rules,
  })
}
