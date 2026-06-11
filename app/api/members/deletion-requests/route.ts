import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { isMemberRequestable, getEntityDef } from '@/lib/deletion/registry'

// POST /api/members/deletion-requests  { entity, id, reason }
// A member requests deletion of one of the allowed entity types (event activity,
// school link, coaching/mentoring session). Never deletes directly — inserts a
// pending row that an admin reviews in the Activity Review Log.
const ALLOWED = new Set(['event_participation', 'school', 'session'])

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const entity = body?.entity as string | undefined
  const id = body?.id as string | undefined
  const reason = (body?.reason as string | undefined)?.slice(0, 2000) ?? null
  if (!entity || !id) return NextResponse.json({ error: 'entity and id are required' }, { status: 400 })
  if (!ALLOWED.has(entity) || !isMemberRequestable(entity)) {
    return NextResponse.json({ error: 'This item cannot be requested for deletion' }, { status: 400 })
  }

  const db = supabaseServer()

  const { data: member } = await db
    .from('members')
    .select('id')
    .eq('clerk_user_id', userId)
    .eq('is_active', true)
    .maybeSingle()
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  // Ownership check: the requesting member must relate to the item.
  const owns = await memberOwnsEntity(db, entity, id, member.id as string)
  if (!owns) return NextResponse.json({ error: 'Not permitted for this item' }, { status: 403 })

  // Avoid duplicate pending requests for the same item.
  const { data: existing } = await db
    .from('deletion_requests')
    .select('id')
    .eq('entity_type', entity)
    .eq('entity_id', id)
    .eq('status', 'pending')
    .maybeSingle()
  if (existing) return NextResponse.json({ request: existing, duplicate: true })

  const { data, error } = await db
    .from('deletion_requests')
    .insert({ requested_by: member.id, entity_type: entity, entity_id: id, reason })
    .select()
    .single()

  if (error) {
    console.error('Deletion request insert error:', error)
    return NextResponse.json({ error: 'Failed to submit request' }, { status: 500 })
  }
  return NextResponse.json({ request: data })
}

// Verifies the member is linked to the entity they're asking to delete.
async function memberOwnsEntity(
  db: ReturnType<typeof supabaseServer>,
  entity: string,
  id: string,
  memberId: string
): Promise<boolean> {
  const def = getEntityDef(entity)
  if (!def) return false

  if (entity === 'event_participation') {
    const { count } = await db
      .from('event_participations')
      .select('*', { count: 'exact', head: true })
      .eq('id', id)
      .eq('member_id', memberId)
    return (count ?? 0) > 0
  }
  if (entity === 'school') {
    const { count } = await db
      .from('member_schools')
      .select('*', { count: 'exact', head: true })
      .eq('school_id', id)
      .eq('member_id', memberId)
    return (count ?? 0) > 0
  }
  if (entity === 'session') {
    const { count } = await db
      .from('session_participants')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', id)
      .eq('member_id', memberId)
    if ((count ?? 0) > 0) return true
    // Coaching sessions reference the coachee directly.
    const { count: c2 } = await db
      .from('sessions')
      .select('*', { count: 'exact', head: true })
      .eq('id', id)
      .eq('member_id', memberId)
    return (c2 ?? 0) > 0
  }
  return false
}
