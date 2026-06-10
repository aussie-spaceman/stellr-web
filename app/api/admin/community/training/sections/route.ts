import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'

// Admin: manage the sections (lesson groups) of a training module (FR-COM-10).
//   POST   (JSON) create a section:  { moduleId, title, displayOrder?, dripDays? }
//   PATCH  (JSON) rename/reorder:    { id, title?, displayOrder?, dripDays? }
//   DELETE (?id=) remove a section — its lessons fall back to ungrouped (section_id NULL).

async function requireAdmin() {
  const { sessionClaims } = await auth()
  return (sessionClaims?.metadata as { role?: string } | undefined)?.role === 'admin'
}

export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const moduleId = (body.moduleId as string | undefined)?.trim()
  const title = (body.title as string | undefined)?.trim()
  if (!moduleId || !title) {
    return NextResponse.json({ error: 'moduleId and title required' }, { status: 400 })
  }

  const db = supabaseServer()
  const { data, error } = await db
    .from('training_sections')
    .insert({
      module_id: moduleId,
      title,
      display_order: Number.isFinite(body.displayOrder) ? body.displayOrder : 0,
      drip_days: Number.isFinite(body.dripDays) ? body.dripDays : 0,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[training] section create error:', error)
    return NextResponse.json({ error: 'Could not create section' }, { status: 500 })
  }
  return NextResponse.json({ id: data.id })
}

export async function PATCH(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const { id } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if (typeof body.title === 'string') patch.title = body.title.trim()
  if (typeof body.displayOrder === 'number') patch.display_order = body.displayOrder
  if (typeof body.dripDays === 'number') patch.drip_days = body.dripDays
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true })

  const db = supabaseServer()
  const { error } = await db.from('training_sections').update(patch).eq('id', id)
  if (error) {
    console.error('[training] section update error:', error)
    return NextResponse.json({ error: 'Could not update section' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const db = supabaseServer()
  const { error } = await db.from('training_sections').delete().eq('id', id)
  if (error) {
    console.error('[training] section delete error:', error)
    return NextResponse.json({ error: 'Could not delete section' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
