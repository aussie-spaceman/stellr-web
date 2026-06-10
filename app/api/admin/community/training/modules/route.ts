import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'

// Admin: create / list / update training modules (FR-COM-10).

async function requireAdmin() {
  const { sessionClaims } = await auth()
  return (sessionClaims?.metadata as { role?: string } | undefined)?.role === 'admin'
}

// GET — modules with item counts for the admin manager.
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const db = supabaseServer()
  const { data } = await db
    .from('training_modules')
    .select('id, title, description, material_kind, course_type, event_ref, min_tier_rank, is_published, display_order, training_items(id)')
    .order('display_order', { ascending: true })
  return NextResponse.json({ modules: data ?? [] })
}

// POST — create a module.
// Body: { title, description?, materialKind?, courseType?, startDate?, eventRef?, minTierRank?, displayOrder? }
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const title = (body.title as string | undefined)?.trim()
  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 })

  const admin = await getCurrentMember()
  const db = supabaseServer()
  const { data, error } = await db
    .from('training_modules')
    .insert({
      title,
      description: body.description?.trim() || null,
      material_kind: body.materialKind ?? 'general',
      course_type: body.courseType ?? 'self_paced',
      start_date: body.startDate || null,
      event_ref: body.eventRef || null,
      min_tier_rank: Number.isFinite(body.minTierRank) ? body.minTierRank : 0,
      display_order: Number.isFinite(body.displayOrder) ? body.displayOrder : 0,
      created_by: admin?.id ?? null,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[training] module create error:', error)
    return NextResponse.json({ error: 'Could not create module' }, { status: 500 })
  }
  return NextResponse.json({ id: data.id })
}

// PATCH — update a module (e.g. publish toggle). Body: { id, ...fields }
export async function PATCH(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const { id } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body.isPublished === 'boolean') patch.is_published = body.isPublished
  if (typeof body.title === 'string') patch.title = body.title.trim()
  if (typeof body.description === 'string') patch.description = body.description.trim() || null
  if (typeof body.materialKind === 'string') patch.material_kind = body.materialKind
  if (typeof body.courseType === 'string') patch.course_type = body.courseType
  if ('startDate' in body) patch.start_date = body.startDate || null
  if (typeof body.minTierRank === 'number') patch.min_tier_rank = body.minTierRank
  if ('eventRef' in body) patch.event_ref = body.eventRef || null

  const db = supabaseServer()
  const { error } = await db.from('training_modules').update(patch).eq('id', id)
  if (error) {
    console.error('[training] module update error:', error)
    return NextResponse.json({ error: 'Could not update module' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
