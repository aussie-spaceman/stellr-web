import { auth } from '@clerk/nextjs/server'
import { hasCapability } from '@/lib/authz'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { actorFromAuth, logActivity } from '@/lib/activity-log'

// PATCH  /api/admin/members/[id]/memberships/[membershipId] — edit one membership
//        (expiry, status, complimentary flag).
// DELETE /api/admin/members/[id]/memberships/[membershipId] — soft-revoke it
//        (renewal_status='cancelled'), preserving history: the row stays, and
//        its updated_at (set by trg_member_memberships_updated_at) records when.
//
// Both are admin-only and scoped to the member, so an admin can't edit another
// member's membership by guessing an id.
//
// renewal_status is the membership_renewal_status enum, which has no 'revoked'
// and spells it 'cancelled' (tracker training-resources-space-tab.5: a revoke
// failed on production writing 'revoked'). Only enum values are stored; the
// American 'canceled' and the old 'revoked' are accepted and stored as
// 'cancelled'. Adding 'revoked' to the enum would need a production migration.

const RENEWAL_STATUSES = ['active', 'pending_renewal', 'expired', 'cancelled', 'complimentary'] as const
type RenewalStatus = (typeof RENEWAL_STATUSES)[number]

const STATUS_ALIASES: Record<string, RenewalStatus> = { canceled: 'cancelled', revoked: 'cancelled' }

/** The enum value an admin's status input means, or null if it means none. */
function toRenewalStatus(input: unknown): RenewalStatus | null {
  if (typeof input !== 'string') return null
  const v = input.trim().toLowerCase()
  if ((RENEWAL_STATUSES as readonly string[]).includes(v)) return v as RenewalStatus
  return STATUS_ALIASES[v] ?? null
}

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
  if (!(await hasCapability('members:write'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
    const status = toRenewalStatus(body.renewal_status)
    if (!status) {
      return NextResponse.json({ error: 'Invalid renewal_status' }, { status: 400 })
    }
    updates.renewal_status = status
    changes.push(`status → ${status}`)
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
  if (!(await hasCapability('members:write'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
    .update({ renewal_status: 'cancelled' satisfies RenewalStatus })
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
    metadata: { membershipId, renewal_status: 'cancelled', previous_status: existing.renewal_status },
    ...actor,
  })

  return NextResponse.json({ success: true })
}
