import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { logActivity } from '@/lib/activity-log'

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

// GET /api/members/me — fetch the current member's full record
export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const db = supabaseServer()

  const { data: member, error } = await db
    .from('members')
    .select(`
      *,
      member_schools(*, schools(*)),
      member_memberships(*, membership_tiers(*)),
      member_ethnicities(*, ethnicity_options(*)),
      member_allergies(*, allergy_options(*)),
      event_participations(*)
    `)
    .eq('clerk_user_id', userId)
    .eq('is_active', true)
    .maybeSingle()

  if (error) {
    console.error('Error fetching member:', error)
    return NextResponse.json({ error: 'Failed to fetch member' }, { status: 500 })
  }

  return NextResponse.json({ member })
}

// PATCH /api/members/me — update the current member's profile
export async function PATCH(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const body = await req.json()
  const db = supabaseServer()

  // Only allow safe fields to be updated by the member themselves
  const allowed = [
    'nickname', 'phone', 'discord_handle', 'gender',
    'grade', 'tshirt_size', 'profile_photo_url',
    'ec_first_name', 'ec_last_name', 'ec_email', 'ec_phone', 'ec_relationship',
    'health_conditions',
  ]

  const { data: member } = await db
    .from('members')
    .select(['id', 'first_name', 'last_name', ...allowed].join(','))
    .eq('clerk_user_id', userId)
    .eq('is_active', true)
    .single()

  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  const memberRow = member as unknown as Record<string, unknown>
  const memberId = memberRow.id as string

  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  const changedFields = Object.keys(updates).filter((k) => norm(memberRow[k]) !== norm(updates[k]))

  // Snapshot current ethnicity/allergy selections before the replacement runs.
  const [{ data: beforeEth }, { data: beforeAllergy }] = await Promise.all([
    db.from('member_ethnicities').select('ethnicity_option_id').eq('member_id', memberId),
    db.from('member_allergies').select('allergy_option_id').eq('member_id', memberId),
  ])
  const beforeEthIds = (beforeEth ?? []).map((r: { ethnicity_option_id: string }) => r.ethnicity_option_id)
  const beforeAllergyIds = (beforeAllergy ?? []).map((r: { allergy_option_id: string }) => r.allergy_option_id)

  if (Object.keys(updates).length > 0) {
    const { error } = await db
      .from('members')
      .update(updates)
      .eq('id', memberId)

    if (error) {
      console.error('Error updating member:', error)
      return NextResponse.json({ error: 'Failed to update member' }, { status: 500 })
    }
  }

  // Replace ethnicity + allergy selections — independent tables, run concurrently
  const replacements: Promise<void>[] = []
  if ('ethnicity_ids' in body && Array.isArray(body.ethnicity_ids)) {
    replacements.push((async () => {
      await db.from('member_ethnicities').delete().eq("member_id", memberId)
      if (body.ethnicity_ids.length > 0) {
        const { error: insertError } = await db.from('member_ethnicities').insert(
          body.ethnicity_ids.map((eid: string) => ({ member_id: memberId, ethnicity_option_id: eid }))
        )
        if (insertError) console.error('Error saving ethnicity selections:', insertError)
      }
    })())
  }
  if ('allergy_ids' in body && Array.isArray(body.allergy_ids)) {
    replacements.push((async () => {
      await db.from('member_allergies').delete().eq("member_id", memberId)
      if (body.allergy_ids.length > 0) {
        const { error: insertError } = await db.from('member_allergies').insert(
          body.allergy_ids.map((aid: string) => ({ member_id: memberId, allergy_option_id: aid }))
        )
        if (insertError) console.error('Error saving allergy selections:', insertError)
      }
    })())
  }
  await Promise.all(replacements)

  // Audit trail — the member edited their own profile.
  const changed = [...changedFields]
  if ('ethnicity_ids' in body && Array.isArray(body.ethnicity_ids) && !sameSet(beforeEthIds, body.ethnicity_ids)) {
    changed.push('ethnicity')
  }
  if ('allergy_ids' in body && Array.isArray(body.allergy_ids) && !sameSet(beforeAllergyIds, body.allergy_ids)) {
    changed.push('dietary')
  }
  if (changed.length > 0) {
    const actorLabel = [memberRow.first_name, memberRow.last_name].filter(Boolean).join(' ').trim() || null
    await logActivity({
      memberId,
      category: 'profile',
      action: 'profile_updated',
      summary: `Updated profile (${changed.map((k) => k.replace(/^ec_/, 'emergency ').replace(/_/g, ' ')).join(', ')})`,
      metadata: { fields: changed },
      actorType: 'member',
      actorMemberId: memberId,
      actorLabel,
    })
  }

  return NextResponse.json({ success: true })
}
