import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'

function isAdmin(sessionClaims: unknown) {
  return (sessionClaims as { metadata?: { role?: string } } | null)?.metadata?.role === 'admin'
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await req.json()
  const db = supabaseServer()

  const allowed = [
    'first_name', 'last_name', 'nickname', 'phone', 'email', 'discord_handle',
    'date_of_birth', 'gender', 'age_bracket', 'event_role',
    'grade', 'grade_auto_promote', 'tshirt_size',
    'ec_first_name', 'ec_last_name', 'ec_email', 'ec_phone',
    'health_conditions', 'is_active',
  ]
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  const { data, error } = await db
    .from('members')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Admin member update error:', error)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  // Replace ethnicity + allergy selections — independent tables, run concurrently
  const replacements: Promise<void>[] = []
  if ('ethnicity_ids' in body && Array.isArray(body.ethnicity_ids)) {
    replacements.push((async () => {
      await db.from('member_ethnicities').delete().eq('member_id', id)
      if (body.ethnicity_ids.length > 0) {
        await db.from('member_ethnicities').insert(
          body.ethnicity_ids.map((eid: string) => ({ member_id: id, ethnicity_option_id: eid }))
        )
      }
    })())
  }
  if ('allergy_ids' in body && Array.isArray(body.allergy_ids)) {
    replacements.push((async () => {
      await db.from('member_allergies').delete().eq('member_id', id)
      if (body.allergy_ids.length > 0) {
        await db.from('member_allergies').insert(
          body.allergy_ids.map((aid: string) => ({ member_id: id, allergy_option_id: aid }))
        )
      }
    })())
  }
  await Promise.all(replacements)

  return NextResponse.json({ member: data })
}

// Soft-delete
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const db = supabaseServer()

  const { error } = await db
    .from('members')
    .update({ is_active: false, deleted_at: new Date().toISOString(), clerk_user_id: null })
    .eq('id', id)

  if (error) return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  return NextResponse.json({ success: true })
}
