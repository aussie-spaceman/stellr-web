import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { isStellrAdmin } from '@/lib/authz'
import { withAudit } from '@/lib/audit/route'

// What this request acted on, which withAudit's spec cannot read for itself: the body has gone.
const auditedId = new WeakMap<Request, string>()
const auditedOp = new WeakMap<Request, string>()

// Admin CRUD for the Phase 5 gates: prerequisites (content_prerequisites) and the
// persistence policy (content_persistence). Both are read by lib/community.ts /
// lib/containers.ts at access time. Scoped here to training modules — the common
// case in the PRD; the resolver supports any target type.

export const POST = withAudit(
  ({ args: [req] }) => ({
    action: 'community.gate.set',
    actor: { session: true },
    tenant: { stellr: true },
    target: { table: 'training_modules', id: auditedId.get(req) ?? null },
    metadata: { op: auditedOp.get(req) ?? null },
  }),
  setGate,
)

// POST — add a prerequisite, or set a persistence policy. Body:
//   { type:'prereq', targetRef, requiresRef }   (both training_module ids)
//   { type:'persistence', targetRef, policy }   (policy: keep_open | re_gate)
async function setGate(req: Request) {
  if (!(await isStellrAdmin({ route: '/api/admin/community/gates' }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  auditedOp.set(req, body.type)
  if (body.targetRef) auditedId.set(req, body.targetRef)
  const db = supabaseServer()

  if (body.type === 'prereq') {
    if (!body.targetRef || !body.requiresRef) {
      return NextResponse.json({ error: 'targetRef and requiresRef required' }, { status: 400 })
    }
    if (body.targetRef === body.requiresRef) {
      return NextResponse.json({ error: 'A module cannot require itself' }, { status: 400 })
    }
    const { data, error } = await db
      .from('content_prerequisites')
      .upsert(
        {
          target_type: 'training_module',
          target_ref: body.targetRef,
          requires_target_type: 'training_module',
          requires_target_ref: body.requiresRef,
        },
        { onConflict: 'target_type,target_ref,requires_target_type,requires_target_ref' },
      )
      .select('id')
      .single()
    if (error) return NextResponse.json({ error: 'Could not add prerequisite' }, { status: 500 })
    return NextResponse.json({ id: data.id })
  }

  if (body.type === 'persistence') {
    if (!body.targetRef || !['keep_open', 're_gate'].includes(body.policy)) {
      return NextResponse.json({ error: 'targetRef and valid policy required' }, { status: 400 })
    }
    const { error } = await db
      .from('content_persistence')
      .upsert(
        { target_type: 'training_module', target_ref: body.targetRef, policy: body.policy },
        { onConflict: 'target_type,target_ref' },
      )
    if (error) return NextResponse.json({ error: 'Could not set persistence' }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'unknown type' }, { status: 400 })
}

export const DELETE = withAudit(
  ({ args: [req] }) => ({
    action: 'community.gate.delete',
    actor: { session: true },
    tenant: { stellr: true },
    target: { table: 'content_prerequisites', id: auditedId.get(req) ?? null },
  }),
  deleteGate,
)

// DELETE — remove a prerequisite row. Body: { id }
async function deleteGate(req: Request) {
  if (!(await isStellrAdmin({ route: '/api/admin/community/gates' }))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  auditedId.set(req, id)
  const db = supabaseServer()
  const { error } = await db.from('content_prerequisites').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'Could not remove prerequisite' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
