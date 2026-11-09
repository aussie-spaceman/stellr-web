import { NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseServer } from '@/lib/supabase'
import { attachAllowed, resolveAccessObject } from '@/lib/access-objects'
import { isStellrAdmin } from '@/lib/authz'
import { withAudit } from '@/lib/audit/route'

// What this request acted on, which withAudit's spec cannot read for itself: the body has gone.
const auditedId = new WeakMap<Request, string>()

// GET /api/admin/containers/[id]/contents — training modules assigned to this container
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isStellrAdmin({ route: '/api/admin/containers/[id]/contents' }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const db = supabaseServer()

  const { data: rows, error } = await db
    .from('container_contents')
    .select('id, content_ref, is_mandatory, due_at')
    .eq('container_id', id)
    .eq('content_type', 'training_module')
    .order('display_order')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const moduleIds = (rows ?? []).map((r) => r.content_ref as string)
  let titleMap: Record<string, string> = {}
  if (moduleIds.length > 0) {
    const { data: modules } = await db.from('training_modules').select('id, title').in('id', moduleIds)
    titleMap = Object.fromEntries((modules ?? []).map((m) => [m.id as string, m.title as string]))
  }

  return NextResponse.json({
    contents: (rows ?? []).map((r) => ({
      id: r.id as string,
      content_ref: r.content_ref as string,
      title: titleMap[r.content_ref as string] ?? r.content_ref as string,
      is_mandatory: r.is_mandatory as boolean,
      due_at: r.due_at as string | null,
    })),
  })
}

const postSchema = z.object({
  moduleId: z.guid(),
  isMandatory: z.boolean().optional(),
  dueAt: z.string().nullable().optional(),
})

export const POST = withAudit(
  ({ args: [req] }) => ({
    action: 'container.content.add',
    actor: { session: true },
    tenant: { stellr: true },
    target: { table: 'container_contents', id: auditedId.get(req) ?? null },
  }),
  addContent,
)

// POST /api/admin/containers/[id]/contents — assign a training module to this container
async function addContent(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isStellrAdmin({ route: '/api/admin/containers/[id]/contents' }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const parsed = postSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const { moduleId, isMandatory = false, dueAt = null } = parsed.data

  // Relationship-matrix gate (object_type_relations) — closed by default.
  const container = await resolveAccessObject(id)
  if (container && !(await attachAllowed(container.objectType, 'course'))) {
    return NextResponse.json(
      { error: `A course cannot be attached to a ${container.objectType} (relationship matrix).` },
      { status: 403 },
    )
  }
  const db = supabaseServer()

  const { data, error } = await db
    .from('container_contents')
    .insert({
      container_id: id,
      content_type: 'training_module',
      content_ref: moduleId,
      is_mandatory: isMandatory,
      due_at: dueAt ?? null,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Already assigned' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  auditedId.set(req, data.id)
  return NextResponse.json({ id: data.id })
}

const deleteSchema = z.object({ id: z.guid() })

export const DELETE = withAudit(
  ({ args: [req] }) => ({
    action: 'container.content.remove',
    actor: { session: true },
    tenant: { stellr: true },
    target: { table: 'container_contents', id: auditedId.get(req) ?? null },
  }),
  removeContent,
)

// DELETE /api/admin/containers/[id]/contents — remove an assignment
async function removeContent(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isStellrAdmin({ route: '/api/admin/containers/[id]/contents' }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: containerId } = await params
  const parsed = deleteSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  auditedId.set(req, parsed.data.id)

  const db = supabaseServer()
  const { error } = await db
    .from('container_contents')
    .delete()
    .eq('id', parsed.data.id)
    .eq('container_id', containerId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
