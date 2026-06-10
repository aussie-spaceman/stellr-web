import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'

// Admin: assign a module to an event's participants by Event Participation Role
// (FR-COM-10: "Training can be assigned to Event Participation Roles").
// Body: { moduleId, eventRef, eventRole, isMandatory?, dueAt? }

async function requireAdmin() {
  const { sessionClaims } = await auth()
  return (sessionClaims?.metadata as { role?: string } | undefined)?.role === 'admin'
}

export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const { moduleId, eventRef, eventRole } = body
  if (!moduleId || !eventRef || !eventRole) {
    return NextResponse.json({ error: 'moduleId, eventRef, eventRole required' }, { status: 400 })
  }

  const admin = await getCurrentMember()
  const db = supabaseServer()
  const { data, error } = await db
    .from('training_assignments')
    .upsert(
      {
        module_id: moduleId,
        event_ref: eventRef,
        event_role: eventRole,
        is_mandatory: Boolean(body.isMandatory),
        due_at: body.dueAt || null,
        created_by: admin?.id ?? null,
      },
      { onConflict: 'module_id,event_ref,event_role' }
    )
    .select('id')
    .single()

  if (error) {
    console.error('[training] assignment error:', error)
    return NextResponse.json({ error: 'Could not create assignment' }, { status: 500 })
  }
  return NextResponse.json({ id: data.id })
}

export async function DELETE(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const db = supabaseServer()
  const { error } = await db.from('training_assignments').delete().eq('id', id)
  if (error) return NextResponse.json({ error: 'Could not delete' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
