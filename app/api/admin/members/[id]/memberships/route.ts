import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { grantTier, type GrantTierOptions } from '@/lib/membership-grants'
import { actorFromAuth } from '@/lib/activity-log'

// POST /api/admin/members/[id]/memberships — admin assigns a tier to a member.
//
// Body:
//   tierId        (required)
//   expiresAt     'YYYY-MM-DD' — explicit expiry; wins over months
//   months        number | null — months until expiry; null = lifetime (no expiry)
//   complimentary boolean — no-charge grant (default true for manual assignment)
//   replacesFree  boolean — expire the member's active FREE memberships first (default true)
//
// Delegates to grantTier() (source='manual') so it shares the idempotency,
// replaces-free behaviour and activity logging of every other grant path.

function isAdmin(sessionClaims: unknown) {
  return (sessionClaims as { metadata?: { role?: string } } | null)?.metadata?.role === 'admin'
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: memberId } = await params
  const body = await req.json().catch(() => ({}))
  const { tierId, expiresAt, months, complimentary, replacesFree } = body

  if (!tierId) return NextResponse.json({ error: 'tierId required' }, { status: 400 })

  const logActor = await actorFromAuth()

  const opts: GrantTierOptions = {
    memberId,
    tierId,
    source: 'manual',
    replacesFree: replacesFree ?? true,
    logActor,
  }
  if ('complimentary' in body) opts.complimentary = !!complimentary
  if (expiresAt) {
    opts.expiresAt = expiresAt
  } else {
    // months: null = lifetime, a number = that many months, absent = default 1yr.
    opts.months = 'months' in body ? (months === null ? null : Number(months)) : 12
  }

  const result = await grantTier(opts)
  if (!result.granted && result.reason === 'already_active') {
    return NextResponse.json(
      { error: 'Member already holds an active membership on this tier.' },
      { status: 409 },
    )
  }
  if (!result.granted) {
    return NextResponse.json({ error: 'Could not assign tier.' }, { status: 400 })
  }
  return NextResponse.json(result)
}
