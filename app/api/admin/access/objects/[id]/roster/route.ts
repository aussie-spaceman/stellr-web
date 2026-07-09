import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { resolveAccessObject, type AccessObject } from '@/lib/access-objects'
import { getEventRoster } from '@/lib/event-admin'
import { checkSingletonRoleAvailable } from '@/lib/object-roles'
import { roleAllowedForBracket, ROLE_LABELS, type MemberRole } from '@/lib/member-roles'

// /api/admin/access/objects/[id]/roster — one roster API for every object type
// (convergence step 3). Dispatches on the resolved object type:
//   container-backed (cohort / workshop / course) → cohort_members
//   space                                          → community_space_members
//   event / campaign                               → participants (read-only here;
//     event rosters are built by the registration flow, GET proxies getEventRoster)
// Writes enforce the singleton-role rule (one Coach per workshop, one Mentor per
// cohort) and ROLES_BY_BRACKET before touching the tables. The legacy per-type
// roster routes stay as proxies for one release (RETIREMENT-DIFF Phase 4).

function isAdmin(sessionClaims: unknown) {
  return (sessionClaims as { metadata?: { role?: string } } | null)?.metadata?.role === 'admin'
}

async function resolve(id: string): Promise<AccessObject | null> {
  return resolveAccessObject(decodeURIComponent(id))
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const object = await resolve(id)
  if (!object) return NextResponse.json({ error: 'Object not found' }, { status: 404 })

  const db = supabaseServer()

  if (object.objectType === 'event' || object.objectType === 'campaign') {
    const roster = await getEventRoster(object.slug ?? object.ref)
    return NextResponse.json({ object, kind: 'event', roster })
  }

  if (object.objectType === 'space' && !object.containerId) {
    const { data } = await db
      .from('community_space_members')
      .select('member_id, role, status, added_at, members!inner(id, first_name, last_name, email)')
      .eq('space_id', object.ref)
    return NextResponse.json({ object, kind: 'space', roster: data ?? [] })
  }

  const { data } = await db
    .from('cohort_members')
    .select('member_id, relationship, status, added_at, members!inner(id, first_name, last_name, email)')
    .eq('cohort_id', object.containerId ?? object.ref)
  return NextResponse.json({ object, kind: 'container', roster: data ?? [] })
}

const postSchema = z.object({
  memberId: z.string().uuid(),
  /** Canonical member_roles value; defaults to the base roster role. */
  role: z.string().optional(),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const object = await resolve(id)
  if (!object) return NextResponse.json({ error: 'Object not found' }, { status: 404 })

  const parsed = postSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { memberId } = parsed.data
  const role = (parsed.data.role ?? 'member') as MemberRole

  if (object.objectType === 'event' || object.objectType === 'campaign') {
    return NextResponse.json(
      { error: 'Event rosters are built by the registration flow — register the member instead.' },
      { status: 501 },
    )
  }

  const db = supabaseServer()

  // Bracket compatibility (ROLES_BY_BRACKET).
  const { data: member } = await db.from('members').select('age_bracket').eq('id', memberId).maybeSingle()
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  if (!roleAllowedForBracket(role, member.age_bracket)) {
    return NextResponse.json(
      { error: `${ROLE_LABELS[role] ?? role} is not available to ${String(member.age_bracket).replace('_', ' ')} members` },
      { status: 400 },
    )
  }

  // Singleton roles (one Coach per workshop, one Mentor per cohort).
  const singleton = await checkSingletonRoleAvailable(object.objectType, object.ref, role)
  if (!singleton.ok) {
    const { data: holder } = await db
      .from('members').select('first_name, last_name').eq('id', singleton.holderMemberId!).maybeSingle()
    const name = holder ? `${holder.first_name ?? ''} ${holder.last_name ?? ''}`.trim() : 'another member'
    return NextResponse.json(
      { error: `This ${object.objectType} already has a ${ROLE_LABELS[role] ?? role}: ${name}.`, holderMemberId: singleton.holderMemberId },
      { status: 409 },
    )
  }

  // Mirror into the unified member_roles table (object-scoped) FIRST, before the
  // roster write. For the singleton roles (workshop→coach, cohort→mentor) this
  // table carries the partial-unique index from migration 125, which is the only
  // ATOMIC guard against the check-then-act race: two admins adding different
  // members as coach can both pass checkSingletonRoleAvailable() above, so we let
  // the index reject the loser here (23505 → 409) BEFORE touching cohort_members —
  // otherwise a rejected grant still lands a second coach on the roster while the
  // mirror silently fails. The pre-check stays for the friendly named-holder 409
  // on the common, non-racing path. Its error was previously discarded.
  if (role !== 'member') {
    const { error: mirrorErr } = await db.from('member_roles').upsert(
      { member_id: memberId, role, scope: 'object', object_type: object.objectType, object_id: object.ref, source: 'admin' },
      { onConflict: 'member_id,role,object_type,object_id', ignoreDuplicates: true },
    )
    if (mirrorErr) {
      // 23505 = unique_violation on the singleton index (someone won the race).
      if (mirrorErr.code === '23505') {
        return NextResponse.json(
          { error: `This ${object.objectType} already has a ${ROLE_LABELS[role] ?? role}.` },
          { status: 409 },
        )
      }
      return NextResponse.json({ error: mirrorErr.message }, { status: 500 })
    }
  }

  if (object.objectType === 'space' && !object.containerId) {
    const { error } = await db.from('community_space_members').upsert(
      { space_id: object.ref, member_id: memberId, role: role === 'moderator' ? 'moderator' : 'member', status: 'active' },
      { onConflict: 'space_id,member_id' },
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await db.from('cohort_members').upsert(
      { cohort_id: object.containerId ?? object.ref, member_id: memberId, relationship: role === 'member' ? 'participant' : role, status: 'active' },
      { onConflict: 'cohort_id,member_id' },
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

const deleteSchema = z.object({ memberId: z.string().uuid() })

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const object = await resolve(id)
  if (!object) return NextResponse.json({ error: 'Object not found' }, { status: 404 })

  const parsed = deleteSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { memberId } = parsed.data

  if (object.objectType === 'event' || object.objectType === 'campaign') {
    return NextResponse.json(
      { error: 'Event roster removals go through the registration flow.' },
      { status: 501 },
    )
  }

  const db = supabaseServer()
  if (object.objectType === 'space' && !object.containerId) {
    await db.from('community_space_members').delete().eq('space_id', object.ref).eq('member_id', memberId)
  } else {
    await db.from('cohort_members').delete().eq('cohort_id', object.containerId ?? object.ref).eq('member_id', memberId)
  }
  await db.from('member_roles').delete()
    .eq('member_id', memberId).eq('scope', 'object')
    .eq('object_type', object.objectType).eq('object_id', object.ref)

  return NextResponse.json({ ok: true })
}
