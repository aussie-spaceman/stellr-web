import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { expireLapsedGrants } from '@/lib/membership-grants'
import { guardCron } from '@/lib/cron'
import { startCronRun } from '@/lib/cron-runs'

// GET /api/cron/membership-expiry — runs daily (see vercel.json).
// Flips complimentary / rule-granted memberships to 'expired' once their
// expires_at has passed (the downgrade side of the grant engine). Paid Stripe
// memberships are excluded — those are governed by the Stripe webhook.
// Idempotent: rows are only updated while still 'active'.

export async function GET(req: NextRequest) {
  const blocked = guardCron(req)
  if (blocked) return blocked

  // deep review INT-9: record the run so a failing downgrade engine is visible.
  const db = supabaseServer()
  const run = await startCronRun(db, 'membership-expiry')
  try {
    const expired = await expireLapsedGrants()
    await run.finish({ expired })
    return NextResponse.json({ expired })
  } catch (err) {
    run.fail('run', err)
    await run.finish({})
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
