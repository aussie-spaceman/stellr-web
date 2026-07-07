import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import {
  attachAllowed,
  resolveAccessObject,
  OBJECT_TO_SPACE_SOURCE_TYPE,
  SPACE_SOURCE_TYPE_TO_OBJECT,
  type AccessObjectType,
} from '@/lib/access-objects'
import { getCurrentMember } from '@/lib/community'
import { getAllEvents, getAllCampaigns } from '@/lib/sanity'

// /api/admin/access/objects/[id]/contents — the Contents tab of the unified
// container detail. Contents live in two stores:
//   container_contents (courses / resources / recordings on a container)
//   community_space_sources (Spaces attached to an object — migration 123;
//     the design models these as the object's Space contents)
// Every POST is gated by the object_type_relations matrix (closed by default).

function isAdmin(sessionClaims: unknown) {
  return (sessionClaims as { metadata?: { role?: string } } | null)?.metadata?.role === 'admin'
}

/** container_contents.content_type → design object type. */
const CONTENT_TYPE_TO_OBJECT: Record<string, AccessObjectType> = {
  training_module: 'course',
  resource: 'resource',
  recording: 'resource',
  announcement: 'resource',
  product: 'resource',
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const object = await resolveAccessObject(decodeURIComponent(id))
  if (!object) return NextResponse.json({ error: 'Object not found' }, { status: 404 })

  const db = supabaseServer()
  const sourceType = OBJECT_TO_SPACE_SOURCE_TYPE[object.objectType]
  const sourceRef = object.objectType === 'event' || object.objectType === 'campaign'
    ? (object.slug ?? object.ref)
    : (object.containerId ?? object.ref)

  const [contentsRes, spacesRes] = await Promise.all([
    object.containerId
      ? db.from('container_contents')
          .select('id, content_type, content_ref, is_mandatory, due_at, min_membership, display_order')
          .eq('container_id', object.containerId)
          .order('display_order')
      : Promise.resolve({ data: [] }),
    sourceType
      ? db.from('community_space_sources')
          .select('id, space_id, community_spaces!inner(id, name, is_archived)')
          .eq('object_type', sourceType)
          .eq('object_ref', sourceRef)
      : Promise.resolve({ data: [] }),
  ])

  // Labels for container contents.
  const rows = (contentsRes.data ?? []) as Array<{
    id: string; content_type: string; content_ref: string
    is_mandatory: boolean; due_at: string | null; min_membership: number | null; display_order: number
  }>
  const moduleIds = rows.filter((r) => r.content_type === 'training_module').map((r) => r.content_ref)
  const resourceIds = rows.filter((r) => r.content_type === 'resource').map((r) => r.content_ref)
  const [modules, resources] = await Promise.all([
    moduleIds.length
      ? db.from('training_modules').select('id, title').in('id', moduleIds)
      : Promise.resolve({ data: [] }),
    resourceIds.length
      ? db.from('community_resources').select('id, title').in('id', resourceIds)
      : Promise.resolve({ data: [] }),
  ])
  const labels = new Map<string, string>([
    ...((modules.data ?? []) as Array<{ id: string; title: string }>).map((m) => [m.id, m.title] as const),
    ...((resources.data ?? []) as Array<{ id: string; title: string }>).map((r) => [r.id, r.title] as const),
  ])

  const contents = [
    ...rows.map((r) => ({
      id: r.id,
      objectType: CONTENT_TYPE_TO_OBJECT[r.content_type] ?? 'resource',
      contentType: r.content_type,
      ref: r.content_ref,
      label: labels.get(r.content_ref) ?? r.content_ref,
      mandatory: r.is_mandatory,
      dueAt: r.due_at,
      minMembership: r.min_membership,
    })),
    ...((spacesRes.data ?? []) as Array<{
      id: string; space_id: string
      community_spaces: { id: string; name: string } | { id: string; name: string }[]
    }>).map((r) => {
      const s = Array.isArray(r.community_spaces) ? r.community_spaces[0] : r.community_spaces
      return {
        id: r.id,
        objectType: 'space' as const,
        contentType: 'space',
        ref: r.space_id,
        label: s?.name ?? r.space_id,
        mandatory: false,
        dueAt: null,
        minMembership: null,
      }
    }),
  ]

  // Reverse links — the objects this Space is attached to as a source (migration
  // 123). A Space is the "to" side of Object→Space links, so this direction is
  // never captured by the two content stores above. Surfacing it lets an admin
  // confirm, from the Space, an attachment made from the parent object's
  // Contents tab. Managed from the parent side; read-only here.
  let sources: Array<{ id: string; objectType: AccessObjectType; ref: string; label: string }> = []
  if (object.objectType === 'space') {
    const { data: sourceRows } = await db
      .from('community_space_sources')
      .select('id, object_type, object_ref')
      .eq('space_id', object.ref)
    const srcRows = (sourceRows ?? []) as Array<{ id: string; object_type: string; object_ref: string }>
    if (srcRows.length) {
      // Events/campaigns are slug-keyed and live in Sanity; the rest resolve by ref.
      const hasEventSource = srcRows.some((r) => r.object_type === 'event')
      const events = hasEventSource
        ? [...(await getAllEvents().catch(() => [])), ...(await getAllCampaigns().catch(() => []))]
        : []
      const eventMeta = new Map<string, { title: string; objectType: AccessObjectType }>()
      for (const e of events as Array<{ slug?: { current?: string } | string; title?: string; activityType?: string }>) {
        const slug = typeof e.slug === 'string' ? e.slug : e.slug?.current
        if (slug) eventMeta.set(slug, { title: e.title ?? slug, objectType: e.activityType === 'campaign' ? 'campaign' : 'event' })
      }
      sources = await Promise.all(
        srcRows.map(async (r) => {
          if (r.object_type === 'event') {
            const meta = eventMeta.get(r.object_ref)
            return { id: r.id, objectType: meta?.objectType ?? 'event', ref: r.object_ref, label: meta?.title ?? r.object_ref }
          }
          const resolved = await resolveAccessObject(r.object_ref)
          return {
            id: r.id,
            objectType: SPACE_SOURCE_TYPE_TO_OBJECT[r.object_type] ?? resolved?.objectType ?? 'event',
            ref: r.object_ref,
            label: resolved?.label ?? r.object_ref,
          }
        }),
      )
    }
  }

  return NextResponse.json({ object, contents, sources })
}

const postSchema = z.object({
  ref: z.string().uuid(),
  /** container_contents.content_type, or 'space' to attach a Space. */
  contentType: z.enum(['training_module', 'resource', 'recording', 'announcement', 'product', 'space']),
  mandatory: z.boolean().optional(),
  dueAt: z.string().nullable().optional(),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const object = await resolveAccessObject(decodeURIComponent(id))
  if (!object) return NextResponse.json({ error: 'Object not found' }, { status: 404 })

  const parsed = postSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { ref, contentType, mandatory, dueAt } = parsed.data

  // Relationship-matrix gate — the single validator for every attach.
  const toType: AccessObjectType = contentType === 'space' ? 'space' : (CONTENT_TYPE_TO_OBJECT[contentType] ?? 'resource')
  if (!(await attachAllowed(object.objectType, toType))) {
    return NextResponse.json(
      { error: `A ${toType} cannot be attached to a ${object.objectType} (relationship matrix).` },
      { status: 403 },
    )
  }

  const db = supabaseServer()

  if (contentType === 'space') {
    const sourceType = OBJECT_TO_SPACE_SOURCE_TYPE[object.objectType]
    if (!sourceType) {
      return NextResponse.json({ error: `Spaces cannot be attached to a ${object.objectType}.` }, { status: 400 })
    }
    const admin = await getCurrentMember()
    const sourceRef = object.objectType === 'event' || object.objectType === 'campaign'
      ? (object.slug ?? object.ref)
      : (object.containerId ?? object.ref)
    const { error } = await db.from('community_space_sources').upsert(
      { space_id: ref, object_type: sourceType, object_ref: sourceRef, created_by: admin?.id ?? null },
      { onConflict: 'space_id,object_type,object_ref', ignoreDuplicates: true },
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (!object.containerId) {
    return NextResponse.json(
      { error: `${object.objectType} objects have no content container yet.` },
      { status: 400 },
    )
  }
  // is_mandatory is confirmed on the object's own detail page, not here, so only
  // write it when explicitly supplied — otherwise a re-attach from this screen
  // would reset the flag (column defaults to false on insert).
  const payload: Record<string, unknown> = {
    container_id: object.containerId,
    content_type: contentType,
    content_ref: ref,
    due_at: dueAt ?? null,
  }
  if (mandatory !== undefined) payload.is_mandatory = mandatory
  const { error } = await db.from('container_contents').upsert(
    payload,
    { onConflict: 'container_id,content_type,content_ref' },
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

const deleteSchema = z.object({
  ref: z.string().uuid(),
  contentType: z.enum(['training_module', 'resource', 'recording', 'announcement', 'product', 'space']),
})

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const object = await resolveAccessObject(decodeURIComponent(id))
  if (!object) return NextResponse.json({ error: 'Object not found' }, { status: 404 })

  const parsed = deleteSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { ref, contentType } = parsed.data

  const db = supabaseServer()
  if (contentType === 'space') {
    const sourceType = OBJECT_TO_SPACE_SOURCE_TYPE[object.objectType]
    const sourceRef = object.objectType === 'event' || object.objectType === 'campaign'
      ? (object.slug ?? object.ref)
      : (object.containerId ?? object.ref)
    if (sourceType) {
      await db.from('community_space_sources').delete()
        .eq('space_id', ref).eq('object_type', sourceType).eq('object_ref', sourceRef)
    }
  } else if (object.containerId) {
    await db.from('container_contents').delete()
      .eq('container_id', object.containerId).eq('content_type', contentType).eq('content_ref', ref)
  }
  return NextResponse.json({ ok: true })
}
