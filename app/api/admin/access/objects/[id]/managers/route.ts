import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { resolveAccessObject } from '@/lib/access-objects'
import { grantObjectRole } from '@/lib/object-roles'
import { getCurrentMember } from '@/lib/community'
import { MANAGE_ROLES, type MemberRole } from '@/lib/member-roles'

// /api/admin/access/objects/[id]/managers — the manage axis for any object.
// Managers come from three sources today (all surfaced by GET):
//   object_roles 'manager' grants (the writable source here),
//   object-scoped MANAGE roles in member_roles (moderator / mentor / coach),
//   the container's structural coach/mentor (mentoring_cohorts.mentor_member_id).
// POST/DELETE write the object_roles grant — same write path as the legacy
// /api/admin/object-roles route (which stays as a proxy during migration).

function isAdmin(sessionClaims: unknown) {
  return (sessionClaims as { metadata?: { role?: string } } | null)?.metadata?.role === 'admin'
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const object = await resolveAccessObject(decodeURIComponent(id))
  if (!object) return NextResponse.json({ error: 'Object not found' }, { status: 404 })

  const db = supabaseServer()
  // Legacy vocabularies: object_roles stores events by slug under 'event' and
  // containers under 'container'; new writes use the design type + ref.
  const legacyType = object.slug && (object.objectType === 'event' || object.objectType === 'campaign')
    ? 'event' : 'container'
  const legacyRef = object.objectType === 'event' || object.objectType === 'campaign'
    ? (object.slug ?? object.ref) : (object.containerId ?? object.ref)

  const [grants, scoped, structural] = await Promise.all([
    db.from('object_roles')
      .select('member_id, role, created_at, members!inner(id, first_name, last_name, email)')
      .in('object_type', [object.objectType, legacyType])
      .in('object_id', [object.ref, legacyRef]),
    db.from('member_roles')
      .select('member_id, role, members!inner(id, first_name, last_name, email)')
      .eq('scope', 'object')
      .eq('object_type', object.objectType)
      .eq('object_id', object.ref),
    object.containerId
      ? db.from('mentoring_cohorts')
          .select('mentor_member_id, members:mentor_member_id(id, first_name, last_name, email)')
          .eq('id', object.containerId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const managers = [
    ...(grants.data ?? []).map((r) => ({ ...r, source: 'grant' as const })),
    ...(scoped.data ?? [])
      .filter((r) => MANAGE_ROLES.has(r.role as MemberRole))
      .map((r) => ({ ...r, source: 'role' as const })),
  ]
  const structuralRow = structural.data?.mentor_member_id
    ? {
        member_id: structural.data.mentor_member_id,
        role: object.objectType === 'workshop' ? 'coach' : 'mentor',
        members: structural.data.members,
        source: 'structural' as const,
      }
    : null

  return NextResponse.json({ object, managers: structuralRow ? [structuralRow, ...managers] : managers })
}

const bodySchema = z.object({ memberId: z.string().uuid() })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const object = await resolveAccessObject(decodeURIComponent(id))
  if (!object) return NextResponse.json({ error: 'Object not found' }, { status: 404 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const admin = await getCurrentMember()
  const result = await grantObjectRole(parsed.data.memberId, object.objectType, object.ref, admin?.id)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const object = await resolveAccessObject(decodeURIComponent(id))
  if (!object) return NextResponse.json({ error: 'Object not found' }, { status: 404 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const db = supabaseServer()
  const legacyType = object.slug && (object.objectType === 'event' || object.objectType === 'campaign')
    ? 'event' : 'container'
  const legacyRef = object.objectType === 'event' || object.objectType === 'campaign'
    ? (object.slug ?? object.ref) : (object.containerId ?? object.ref)

  await db.from('object_roles').delete()
    .eq('member_id', parsed.data.memberId)
    .in('object_type', [object.objectType, legacyType])
    .in('object_id', [object.ref, legacyRef])

  return NextResponse.json({ ok: true })
}
