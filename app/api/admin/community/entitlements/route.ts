import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getCurrentMember } from '@/lib/community'

// Admin CRUD for the tier→content entitlement map (migration 017).
// Powers the drag-and-drop access matrix. All gating decisions elsewhere read
// from content_entitlements via lib/community.ts (memberHasEntitlement).

async function requireAdmin() {
  const { sessionClaims } = await auth()
  const role = (sessionClaims?.metadata as { role?: string } | undefined)?.role
  return role === 'admin'
}

// GET — list all entitlement rows (the matrix reads these to render chips).
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const db = supabaseServer()
  const { data } = await db
    .from('content_entitlements')
    .select('id, tier_id, target_type, target_ref, access_level')
  return NextResponse.json({ entitlements: data ?? [] })
}

// POST — grant a tier access to a target. Idempotent on the unique key.
// Body: { tierId, targetType, targetRef, accessLevel? }
export async function POST(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Subject is a membership tier (content tiers retired — D-G).
  const { tierId, targetType, targetRef, accessLevel } = await req.json().catch(() => ({}))
  if (!targetType || !targetRef || !tierId) {
    return NextResponse.json(
      { error: 'tierId, targetType and targetRef required' },
      { status: 400 }
    )
  }

  const admin = await getCurrentMember()
  const db = supabaseServer()
  const { data, error } = await db
    .from('content_entitlements')
    .upsert(
      {
        tier_id: tierId,
        target_type: targetType,
        target_ref: targetRef,
        access_level: accessLevel ?? 'view',
        created_by: admin?.id ?? null,
      },
      { onConflict: 'tier_id,target_type,target_ref,access_level' }
    )
    .select('id')
    .single()

  if (error) {
    console.error('[entitlements] upsert error:', error)
    return NextResponse.json({ error: 'Could not grant access' }, { status: 500 })
  }
  return NextResponse.json({ id: data.id })
}

// PATCH — change the access level of an existing entitlement row. Body: { id, accessLevel }
// The matrix keeps one chip per (tier, target), so updating access_level can't
// collide with the UNIQUE (tier_id, target_type, target_ref, access_level) key.
const ACCESS_LEVELS = ['view', 'download', 'enroll', 'host'] as const
export async function PATCH(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id, accessLevel } = await req.json().catch(() => ({}))
  if (!id || !accessLevel) return NextResponse.json({ error: 'id and accessLevel required' }, { status: 400 })
  if (!ACCESS_LEVELS.includes(accessLevel)) {
    return NextResponse.json({ error: 'invalid accessLevel' }, { status: 400 })
  }

  const db = supabaseServer()
  const { error } = await db
    .from('content_entitlements')
    .update({ access_level: accessLevel })
    .eq('id', id)
  if (error) {
    console.error('[entitlements] patch error:', error)
    return NextResponse.json({ error: 'Could not update access level' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

// DELETE — revoke an entitlement row. Body: { id }
export async function DELETE(req: Request) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const db = supabaseServer()
  const { error } = await db.from('content_entitlements').delete().eq('id', id)
  if (error) {
    console.error('[entitlements] delete error:', error)
    return NextResponse.json({ error: 'Could not revoke access' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
