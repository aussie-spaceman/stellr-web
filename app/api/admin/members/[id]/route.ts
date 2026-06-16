import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { actorFromAuth, logActivity } from '@/lib/activity-log'

function isAdmin(sessionClaims: unknown) {
  return (sessionClaims as { metadata?: { role?: string } } | null)?.metadata?.role === 'admin'
}

function humanizeFields(keys: string[]): string {
  return keys.map((k) => k.replace(/^ec_/, 'emergency ').replace(/_/g, ' ')).join(', ')
}

// Treat null/undefined/'' as equivalent so an untouched empty field (the form
// submits null DB values as '') is not flagged as a change.
function norm(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim()
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sa = new Set(a)
  return b.every((x) => sa.has(x))
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
    'ec_first_name', 'ec_last_name', 'ec_email', 'ec_phone', 'ec_relationship',
    'health_conditions', 'is_active',
  ]
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  // Snapshot the editable fields + current ethnicity/allergy selections before
  // the write so we can record exactly what changed.
  const [{ data: before }, { data: beforeEth }, { data: beforeAllergy }] = await Promise.all([
    db.from('members').select(allowed.join(',')).eq('id', id).maybeSingle(),
    db.from('member_ethnicities').select('ethnicity_option_id').eq('member_id', id),
    db.from('member_allergies').select('allergy_option_id').eq('member_id', id),
  ])

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
        const { error: insertError } = await db.from('member_ethnicities').insert(
          body.ethnicity_ids.map((eid: string) => ({ member_id: id, ethnicity_option_id: eid }))
        )
        if (insertError) console.error('Admin member ethnicity insert error:', insertError)
      }
    })())
  }
  if ('allergy_ids' in body && Array.isArray(body.allergy_ids)) {
    replacements.push((async () => {
      await db.from('member_allergies').delete().eq('member_id', id)
      if (body.allergy_ids.length > 0) {
        const { error: insertError } = await db.from('member_allergies').insert(
          body.allergy_ids.map((aid: string) => ({ member_id: id, allergy_option_id: aid }))
        )
        if (insertError) console.error('Admin member allergy insert error:', insertError)
      }
    })())
  }
  await Promise.all(replacements)

  // Audit trail — record which fields the admin actually changed.
  const beforeRow = (before ?? {}) as Record<string, unknown>
  const changed = Object.keys(updates).filter((k) => norm(beforeRow[k]) !== norm(updates[k]))
  const beforeEthIds = (beforeEth ?? []).map((r: { ethnicity_option_id: string }) => r.ethnicity_option_id)
  const beforeAllergyIds = (beforeAllergy ?? []).map((r: { allergy_option_id: string }) => r.allergy_option_id)
  if ('ethnicity_ids' in body && Array.isArray(body.ethnicity_ids) && !sameSet(beforeEthIds, body.ethnicity_ids)) {
    changed.push('ethnicity')
  }
  if ('allergy_ids' in body && Array.isArray(body.allergy_ids) && !sameSet(beforeAllergyIds, body.allergy_ids)) {
    changed.push('dietary')
  }
  if (changed.length > 0) {
    const actor = await actorFromAuth()
    await logActivity({
      memberId: id,
      category: 'profile',
      action: 'profile_updated',
      summary: `Updated profile (${humanizeFields(changed)})`,
      metadata: { fields: changed },
      ...actor,
    })
  }

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

  const actor = await actorFromAuth()
  await logActivity({
    memberId: id,
    category: 'account',
    action: 'account_deactivated',
    summary: 'Account deactivated',
    ...actor,
  })

  return NextResponse.json({ success: true })
}
