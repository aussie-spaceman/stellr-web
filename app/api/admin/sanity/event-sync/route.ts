import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { ensureEventContainer } from '@/lib/container-sync'
import { fireObjectCreatedRules } from '@/lib/object-created-rules'
import { safeStrEqual } from '@/lib/secret-compare'

// POST /api/admin/sanity/event-sync — Sanity → Supabase access-structure sync
// (HANDOFF-CODE-REVIEW §7). Sanity is the source of truth for event CONTENT;
// admin/access (Supabase) is the source of truth for event ACCESS. On publish,
// a Sanity webhook calls this route with the event document; we upsert the
// event container, auto-provision its Event Space, and fire the
// object_created rules (auto-attach mandatory training etc.). Link is by slug.
//
// Configure in Sanity: webhook on event create/update, URL this route, secret
// in SANITY_WEBHOOK_SECRET (sent as the ?secret= query param or the
// x-webhook-secret header).

interface SanityEventPayload {
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
  const title = body.title ?? slug
  const objectType = body.activityType === 'campaign' ? ('campaign' as const) : ('event' as const)

  const db = supabaseServer()

  // 1. Event container (access-side shadow of the Sanity document).
  const containerId = await ensureEventContainer(db, slug, title)

  // 2. Auto-provision the Event Space child (design seed o_space_event_autumn):
  //    a Space whose roster is inherited from the event via community_space_sources.
  const spaceSlug = `event-${slug}`
  await db.from('community_spaces').upsert(
    {
      slug: spaceSlug,
      name: `${title} · Event Space`,
      description: `Space for everyone participating in ${title}.`,
      access_type: 'private',
      min_tier_rank: 0,
      display_order: 50,
    },
    { onConflict: 'slug', ignoreDuplicates: true },
  )
  const { data: space } = await db.from('community_spaces').select('id').eq('slug', spaceSlug).maybeSingle()
  if (space) {
    await db.from('community_space_sources').upsert(
      { space_id: space.id, object_type: 'event', object_ref: slug },
      { onConflict: 'space_id,object_type,object_ref', ignoreDuplicates: true },
    )
    const { data: channel } = await db
      .from('community_channels').select('id').eq('space_id', space.id).eq('slug', 'general').maybeSingle()
    if (!channel) {
      await db.from('community_channels').insert({ space_id: space.id, slug: 'general', name: 'General', display_order: 0 })
    }
  }

  // 3. Fire object_created rules (auto-attach configured spaces/courses/resources).
  const rules = await fireObjectCreatedRules({
    objectType,
    ref: slug,
    containerId: containerId ?? undefined,
  })

  return NextResponse.json({ ok: true, slug, containerId, eventSpaceId: space?.id ?? null, rules })
}
