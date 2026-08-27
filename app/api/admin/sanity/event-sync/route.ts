import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { syncEventSpace } from '@/lib/event-space-sync'
import { fireObjectCreatedRules } from '@/lib/object-created-rules'
import { safeStrEqual } from '@/lib/secret-compare'

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
// in SANITY_WEBHOOK_SECRET (sent as the ?secret= query param or the
// x-webhook-secret header).

interface SanityEventPayload {
  _id?: string
  _type?: string
  title?: string
  slug?: { current?: string } | string
  activityType?: string
}

export async function POST(req: Request) {
  const secret = process.env.SANITY_WEBHOOK_SECRET
  // Prefer the header; the ?secret= form is still accepted for existing configs
  // but a query-string secret lands in access logs, so the header is preferred.
  const provided = req.headers.get('x-webhook-secret') ?? new URL(req.url).searchParams.get('secret')
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

  return NextResponse.json({
    ok: true,
    slug,
    containerId: sync.containerId,
    eventSpaceId: sync.spaceId,
    created: sync.created,
    renamedFrom: sync.renamedFrom,
    notes: sync.notes,
    rules,
  })
}
