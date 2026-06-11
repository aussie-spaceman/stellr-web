import { NextRequest, NextResponse } from 'next/server'
import { expireLapsedGrants } from '@/lib/membership-grants'

// GET /api/cron/membership-expiry — runs daily (see vercel.json).
// Flips complimentary / rule-granted memberships to 'expired' once their
// expires_at has passed (the downgrade side of the grant engine). Paid Stripe
// memberships are excluded — those are governed by the Stripe webhook.
// Idempotent: rows are only updated while still 'active'.

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const expired = await expireLapsedGrants()
  return NextResponse.json({ expired })
}
