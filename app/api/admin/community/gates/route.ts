import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'

// Admin CRUD for the Phase 5 gates: prerequisites (content_prerequisites) and the
// persistence policy (content_persistence). Both are read by lib/community.ts /
// lib/containers.ts at access time. Scoped here to training modules — the common
// case in the PRD; the resolver supports any target type.

async function requireAdmin() {
  const { sessionClaims } = await auth()
  return (sessionClaims?.metadata as { role?: string } | undefined)?.role === 'admin'
}

// POST — add a prerequisite, or set a persistence policy. Body:
//   { type:'prereq', targetRef, requiresRef }   (both training_module ids)
//   { type:'persistence', targetRef, policy }   (policy: keep_open | re_gate)
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
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

// DELETE — remove a prerequisite row. Body: { id }
export async function DELETE(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const db = supabaseServer()
  const { error } = await db.from('content_prerequisites').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'Could not remove prerequisite' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
