import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'

// Admin CRUD for course_object_assignments — assign a course to an Object with
// per-membership-tier requirements (Course builder · Assignments & requirements).

async function requireAdmin() {
  const { sessionClaims } = await auth()
  return (sessionClaims?.metadata as { role?: string } | undefined)?.role === 'admin'
}

const OBJECT_TYPES = ['competition', 'campaign', 'cohort', 'workshop', 'space']
const REQS = ['mandatory', 'optional', 'na']

// POST — create/upsert an assignment.
// Body: { moduleId, objectType, objectRef, objectLabel?, defaultRequirement?, tierRequirements?, dueAt? }
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!b.moduleId || !OBJECT_TYPES.includes(b.objectType) || !b.objectRef) {
    return NextResponse.json({ error: 'moduleId, valid objectType and objectRef required' }, { status: 400 })
  }
  const admin = await getCurrentMember()
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

// PATCH — update requirements / due date. Body: { id, defaultRequirement?, tierRequirements?, dueAt? }
export async function PATCH(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const b = await req.json().catch(() => ({}))
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (REQS.includes(b.defaultRequirement)) patch.default_requirement = b.defaultRequirement
  if (b.tierRequirements && typeof b.tierRequirements === 'object') patch.tier_requirements = b.tierRequirements
  if ('dueAt' in b) patch.due_at = b.dueAt || null
  const db = supabaseServer()
  const { error } = await db.from('course_object_assignments').update(patch).eq('id', b.id)
  if (error) return NextResponse.json({ error: 'Could not update assignment' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// DELETE — ?id=
export async function DELETE(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const db = supabaseServer()
  const { error } = await db.from('course_object_assignments').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'Could not remove assignment' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
