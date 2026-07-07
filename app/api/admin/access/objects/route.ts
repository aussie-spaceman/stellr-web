import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { CONTAINER_TYPE_TO_OBJECT, type AccessObjectType } from '@/lib/access-objects'
import { fireObjectCreatedRules } from '@/lib/object-created-rules'
import { getAllEvents, getAllCampaigns } from '@/lib/sanity'

// GET /api/admin/access/objects — every object in the converged model, across
// all seven types, for the Objects-tab list. Content metadata for events stays
// in Sanity (source of truth for event CONTENT); everything else is Supabase.

function isAdmin(sessionClaims: unknown) {
  return (sessionClaims as { metadata?: { role?: string } } | null)?.metadata?.role === 'admin'
}

export interface AccessObjectListItem {
  objectType: AccessObjectType
  ref: string
  label: string
  archived: boolean
}

export async function GET() {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = supabaseServer()
  const [containers, spaces, modules, resources, liveEvents, campaigns] = await Promise.all([
    db.from('mentoring_cohorts').select('id, name, container_type, lifecycle, campaign_ref'),
    db.from('community_spaces').select('id, name, slug, is_archived'),
    db.from('training_modules').select('id, title'),
    db.from('community_resources').select('id, title'),
    getAllEvents().catch(() => []),
    getAllCampaigns().catch(() => []),
  ])
  const events = [...(liveEvents ?? []), ...(campaigns ?? [])]

  // Space- and training-type containers (migration 123 plumbing for the resource
  // catalogue) shadow a community_spaces / training_modules row, keyed by slug /
  // module-id. Listing both the container and its canonical row doubled every such
  // object in the list. Drop the container when its canonical row exists; keep it
  // only when orphaned (e.g. a "Study Hall" space container with no space row).
  const spaceSlugs = new Set(((spaces.data ?? []) as Array<{ slug: string }>).map((s) => s.slug))
  const moduleIds = new Set(((modules.data ?? []) as Array<{ id: string }>).map((m) => m.id))
  const isShadowContainer = (c: { container_type: string; campaign_ref: string | null }) =>
    ['event_participation', 'campaign_participation'].includes(c.container_type) ||
    (c.container_type === 'space' && !!c.campaign_ref && spaceSlugs.has(c.campaign_ref)) ||
    (c.container_type === 'training' && !!c.campaign_ref && moduleIds.has(c.campaign_ref))

  const objects: AccessObjectListItem[] = [
    // Containers that shadow a canonical row (Sanity events, community_spaces,
    // training_modules) are dropped here; the canonical entry is listed below.
    ...((containers.data ?? []) as Array<{ id: string; name: string; container_type: string; lifecycle: string; campaign_ref: string | null }>)
      .filter((c) => !isShadowContainer(c))
      .map((c) => ({
        objectType: CONTAINER_TYPE_TO_OBJECT[c.container_type] ?? ('cohort' as const),
        ref: c.id,
        label: c.name,
        archived: c.lifecycle === 'archived',
      })),
    ...((spaces.data ?? []) as Array<{ id: string; name: string; is_archived: boolean }>).map((s) => ({
      objectType: 'space' as const,
      ref: s.id,
      label: s.name,
      archived: !!s.is_archived,
    })),
    ...((modules.data ?? []) as Array<{ id: string; title: string }>).map((m) => ({
      objectType: 'course' as const,
      ref: m.id,
      label: m.title,
      archived: false,
    })),
    ...((resources.data ?? []) as Array<{ id: string; title: string | null }>).map((r) => ({
      objectType: 'resource' as const,
      ref: r.id,
      label: r.title ?? r.id,
      archived: false,
    })),
    ...((events as Array<{ slug?: { current?: string } | string; title?: string; activityType?: string }>) ?? [])
      .map((e) => {
        const slug = typeof e.slug === 'string' ? e.slug : e.slug?.current
        if (!slug) return null
        return {
          objectType: (e.activityType === 'campaign' ? 'campaign' : 'event') as AccessObjectType,
          ref: slug,
          label: e.title ?? slug,
          archived: false,
        }
      })
      .filter((e): e is AccessObjectListItem => !!e),
  ]

  // De-dupe spaces that also appear as space-type containers.
  const seen = new Set<string>()
  const deduped = objects.filter((o) => {
    const key = `${o.objectType}:${o.ref}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  deduped.sort((a, b) => a.objectType.localeCompare(b.objectType) || a.label.localeCompare(b.label))
  return NextResponse.json({ objects: deduped })
}

// POST /api/admin/access/objects — the New Object wizard's create. Creates the
// storage row for the chosen type, then fires the object_created rules
// (auto-attach). Events/campaigns are created in Sanity (content source of
// truth) and arrive via the event-sync webhook instead.
export async function POST(req: Request) {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const b = await req.json().catch(() => ({}))
  const objectType = b.objectType as AccessObjectType
  const name = typeof b.name === 'string' ? b.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const db = supabaseServer()

  if (objectType === 'event' || objectType === 'campaign') {
    return NextResponse.json(
      { error: 'Events and campaigns are created in Sanity Studio — the sync webhook provisions their access side.' },
      { status: 501 },
    )
  }

  let ref: string | null = null
  let containerId: string | undefined

  if (objectType === 'space') {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    const { data, error } = await db
      .from('community_spaces')
      .insert({ slug, name, access_type: 'private', min_tier_rank: 0, display_order: 100 })
      .select('id')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    ref = data.id as string
    await db.from('community_channels').insert({ space_id: ref, slug: 'general', name: 'General', display_order: 0 })
  } else if (objectType === 'cohort' || objectType === 'workshop') {
    const { data, error } = await db
      .from('mentoring_cohorts')
      .insert({
        name,
        container_type: objectType === 'workshop' ? 'coaching' : 'mentoring',
        lifecycle: 'active',
        mentor_member_id: b.mentorMemberId ?? null,
      })
      .select('id')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    ref = data.id as string
    containerId = ref
  } else {
    return NextResponse.json(
      { error: `Create ${objectType}s from their dedicated tools (course builder / resource upload).` },
      { status: 501 },
    )
  }

  const rules = await fireObjectCreatedRules({ objectType, ref, containerId })
  return NextResponse.json({ ok: true, ref, objectType, rules })
}
