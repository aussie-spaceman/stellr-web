import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getSignedInMember } from '@/lib/community'
import { attachAllowed, type AccessObjectType } from '@/lib/access-objects'
import { currentUserIsAdmin } from '@/lib/admin-auth'
import { AUDIENCES, objectUsesAudience, type Audience } from '@/lib/training-audience'

// Admin CRUD for course_object_assignments — assign a course to an Object with
// per-membership-tier requirements (Course builder · Assignments & requirements).

const OBJECT_TYPES = ['competition', 'campaign', 'cohort', 'workshop', 'space']
const REQS = ['mandatory', 'optional', 'na']

// Audience only narrows event/campaign assignments; anything else stays 'all'.
function audienceFor(objectType: string, v: unknown): Audience {
  return objectUsesAudience(objectType) && AUDIENCES.includes(v as Audience) ? (v as Audience) : 'all'
}

// POST — create/upsert an assignment.
// Body: { moduleId, objectType, objectRef, objectLabel?, defaultRequirement?, tierRequirements?, dueAt?, audience? }
export async function POST(req: Request) {
  if (!(await currentUserIsAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!b.moduleId || !OBJECT_TYPES.includes(b.objectType) || !b.objectRef) {
    return NextResponse.json({ error: 'moduleId, valid objectType and objectRef required' }, { status: 400 })
  }
  // Relationship-matrix gate (object_type_relations) — closed by default.
  const fromType = (b.objectType === 'competition' ? 'event' : b.objectType) as AccessObjectType
  if (!(await attachAllowed(fromType, 'course'))) {
    return NextResponse.json(
      { error: `A course cannot be attached to a ${fromType} (relationship matrix).` },
      { status: 403 },
    )
  }
  const admin = await getSignedInMember()
  const db = supabaseServer()
  const { data, error } = await db
    .from('course_object_assignments')
    .upsert(
      {
        module_id: b.moduleId,
        object_type: b.objectType,
        object_ref: b.objectRef,
        object_label: b.objectLabel ?? null,
        default_requirement: REQS.includes(b.defaultRequirement) ? b.defaultRequirement : 'optional',
        tier_requirements: b.tierRequirements ?? {},
        due_at: b.dueAt || null,
        audience: audienceFor(b.objectType, b.audience),
        created_by: admin?.id ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'module_id,object_type,object_ref' }
    )
    .select('id')
    .single()
  if (error) {
    console.error('[training] assignment upsert error:', error)
    return NextResponse.json({ error: 'Could not save assignment' }, { status: 500 })
  }
  return NextResponse.json({ id: data.id })
}

// PATCH — update requirements / due date / audience. Body: { id, defaultRequirement?, tierRequirements?, dueAt?, audience? }
export async function PATCH(req: Request) {
  if (!(await currentUserIsAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (REQS.includes(b.defaultRequirement)) patch.default_requirement = b.defaultRequirement
  if (b.tierRequirements && typeof b.tierRequirements === 'object') patch.tier_requirements = b.tierRequirements
  if ('dueAt' in b) patch.due_at = b.dueAt || null
  const db = supabaseServer()
  if ('audience' in b) {
    if (!AUDIENCES.includes(b.audience)) return NextResponse.json({ error: 'invalid audience' }, { status: 400 })
    const { data: row } = await db.from('course_object_assignments').select('object_type').eq('id', b.id).maybeSingle()
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    patch.audience = audienceFor(row.object_type as string, b.audience)
  }
  const { error } = await db.from('course_object_assignments').update(patch).eq('id', b.id)
  if (error) return NextResponse.json({ error: 'Could not update assignment' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// DELETE — ?id=
export async function DELETE(req: Request) {
  if (!(await currentUserIsAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const db = supabaseServer()
  const { error } = await db.from('course_object_assignments').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'Could not remove assignment' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
