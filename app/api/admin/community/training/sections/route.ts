import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { isStellrAdmin } from '@/lib/authz'
import { withAudit } from '@/lib/audit/route'

// What this request acted on, which withAudit's spec cannot read for itself: the body has gone.
const auditedId = new WeakMap<Request, string>()

// Admin: manage the sections (lesson groups) of a training module (FR-COM-10).
//   POST   (JSON) create a section:  { moduleId, title, displayOrder?, dripDays? }
//   PATCH  (JSON) rename/reorder:    { id, title?, displayOrder?, dripDays? }
//   DELETE (?id=) remove a section — its lessons fall back to ungrouped (section_id NULL).

export const POST = withAudit(
  ({ args: [req] }) => ({
    action: 'training.section.create',
    actor: { session: true },
    tenant: { stellr: true },
    target: { table: 'training_sections', id: auditedId.get(req) ?? null },
  }),
  createSection,
)

async function createSection(req: Request) {
  if (!(await isStellrAdmin({ route: '/api/admin/community/training/sections' }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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
  auditedId.set(req, data.id)
  return NextResponse.json({ id: data.id })
}

export const PATCH = withAudit(
  ({ args: [req] }) => ({
    action: 'training.section.update',
    actor: { session: true },
    tenant: { stellr: true },
    target: { table: 'training_sections', id: auditedId.get(req) ?? null },
  }),
  updateSection,
)

async function updateSection(req: Request) {
  if (!(await isStellrAdmin({ route: '/api/admin/community/training/sections' }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const { id } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  auditedId.set(req, id)

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

export const DELETE = withAudit(
  ({ args: [req] }) => ({
    action: 'training.section.delete',
    actor: { session: true },
    tenant: { stellr: true },
    target: { table: 'training_sections', id: auditedId.get(req) ?? null },
  }),
  deleteSection,
)

async function deleteSection(req: Request) {
  if (!(await isStellrAdmin({ route: '/api/admin/community/training/sections' }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  auditedId.set(req, id)

  const db = supabaseServer()
  const { error } = await db.from('training_sections').delete().eq('id', id)
  if (error) {
    console.error('[training] section delete error:', error)
    return NextResponse.json({ error: 'Could not delete section' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
