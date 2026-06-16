import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { actorFromAuth, logActivity } from '@/lib/activity-log'

// PATCH  /api/admin/members/[id]/memberships/[membershipId] — edit one membership
//        (expiry, status, complimentary flag).
// DELETE /api/admin/members/[id]/memberships/[membershipId] — soft-revoke it
//        (renewal_status='revoked'), preserving history.
//
// Both are admin-only and scoped to the member, so an admin can't edit another
// member's membership by guessing an id.

function isAdmin(sessionClaims: unknown) {
  return (sessionClaims as { metadata?: { role?: string } } | null)?.metadata?.role === 'admin'
}

const STATUSES = ['active', 'expired', 'canceled', 'revoked'] as const

type Joined = {
  id: string
  expires_at: string | null
  renewal_status: string
  is_complimentary: boolean
  membership_tiers: { name: string } | { name: string }[] | null
}

function tierName(row: Joined | null): string {
  const t = Array.isArray(row?.membership_tiers) ? row?.membership_tiers[0] : row?.membership_tiers
  return (t as { name?: string } | null | undefined)?.name ?? 'membership'
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; membershipId: string }> },
) {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: memberId, membershipId } = await params
  const body = await req.json().catch(() => ({}))
  const db = supabaseServer()

  const { data: existingRow } = await db
    .from('member_memberships')
    .select('id, expires_at, renewal_status, is_complimentary, membership_tiers(name)')
    .eq('id', membershipId)
    .eq('member_id', memberId)
    .maybeSingle()
  const existing = existingRow as Joined | null
  if (!existing) return NextResponse.json({ error: 'Membership not found' }, { status: 404 })

  const updates: Record<string, unknown> = {}
  const changes: string[] = []
  if ('expires_at' in body) {
    updates.expires_at = body.expires_at || null
    changes.push(`expiry → ${body.expires_at || 'none'}`)
  }
  if ('renewal_status' in body) {
    if (!STATUSES.includes(body.renewal_status)) {
      return NextResponse.json({ error: 'Invalid renewal_status' }, { status: 400 })
    }
    updates.renewal_status = body.renewal_status
    changes.push(`status → ${body.renewal_status}`)
  }
  if ('is_complimentary' in body) {
    updates.is_complimentary = !!body.is_complimentary
    changes.push(`complimentary → ${body.is_complimentary ? 'yes' : 'no'}`)
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No editable fields supplied' }, { status: 400 })
  }

  const { error } = await db
    .from('member_memberships')
    .update(updates)
    .eq('id', membershipId)
    .eq('member_id', memberId)
  if (error) {
    console.error('[memberships PATCH] update error:', error)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  const actor = await actorFromAuth()
  await logActivity({
    memberId,
    category: 'membership',
    action: 'tier_updated',
    summary: `Updated ${tierName(existing)} membership: ${changes.join(', ')}`,
    metadata: { membershipId, ...updates },
    ...actor,
  })

  return NextResponse.json({ success: true })
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; membershipId: string }> },
) {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: memberId, membershipId } = await params
  const db = supabaseServer()

  const { data: existingRow } = await db
    .from('member_memberships')
    .select('id, expires_at, renewal_status, is_complimentary, membership_tiers(name)')
    .eq('id', membershipId)
    .eq('member_id', memberId)
    .maybeSingle()
  const existing = existingRow as Joined | null
  if (!existing) return NextResponse.json({ error: 'Membership not found' }, { status: 404 })

  const { error } = await db
    .from('member_memberships')
    .update({ renewal_status: 'revoked' })
    .eq('id', membershipId)
    .eq('member_id', memberId)
  if (error) {
    console.error('[memberships DELETE] revoke error:', error)
    return NextResponse.json({ error: 'Revoke failed' }, { status: 500 })
  }

  const actor = await actorFromAuth()
  await logActivity({
    memberId,
    category: 'membership',
    action: 'tier_revoked',
    summary: `Revoked ${tierName(existing)} membership`,
    metadata: { membershipId },
    ...actor,
  })

  return NextResponse.json({ success: true })
}
