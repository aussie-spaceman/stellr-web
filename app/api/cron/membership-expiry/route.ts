import { NextRequest, NextResponse } from 'next/server'
import { expireLapsedGrants } from '@/lib/membership-grants'
import { guardCron } from '@/lib/cron'

// GET /api/cron/membership-expiry — runs daily (see vercel.json).
// Flips complimentary / rule-granted memberships to 'expired' once their
// expires_at has passed (the downgrade side of the grant engine). Paid Stripe
// memberships are excluded — those are governed by the Stripe webhook.
// Idempotent: rows are only updated while still 'active'.

export async function GET(req: NextRequest) {
  const blocked = guardCron(req)
  if (blocked) return blocked

  const expired = await expireLapsedGrants()
  return NextResponse.json({ expired })
}
