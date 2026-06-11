import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { grantTier } from '@/lib/membership-grants'

// POST /api/admin/membership/grant — admin manually places a member on a tier.
// Body: { memberId, tierId, months? (null = lifetime), replacesFree? }
// Records source='manual' so the Members tab can show how the grant happened.

function isAdmin(sessionClaims: unknown) {
  return (sessionClaims as { metadata?: { role?: string } } | null)?.metadata?.role === 'admin'
}

export async function POST(req: Request) {
  const { sessionClaims } = await auth()
  if (!isAdmin(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { memberId, tierId, months, replacesFree } = await req.json().catch(() => ({}))
  if (!memberId || !tierId) {
    return NextResponse.json({ error: 'memberId and tierId required' }, { status: 400 })
  }

  const result = await grantTier({
    memberId,
    tierId,
    months: months === undefined ? 12 : months, // default 1yr; pass null for lifetime
    source: 'manual',
    replacesFree: replacesFree ?? true,
  })

  return NextResponse.json(result)
}
