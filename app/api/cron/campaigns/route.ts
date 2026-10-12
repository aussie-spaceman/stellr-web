import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { dispatchDueCampaigns } from '@/lib/email-campaigns'
import { guardCron } from '@/lib/cron'
import { startCronRun } from '@/lib/cron-runs'

// deep review INT-6: a broadcast is sequential Resend calls, so give the loop
// headroom; dispatchDueCampaigns is resumable (claim + ledger) if it still runs out.
export const maxDuration = 60

// GET /api/cron/campaigns — runs hourly (see vercel.json). Sends every scheduled
// campaign whose send time has arrived. Idempotent via the email_campaign_sends
// ledger, so a retried or overlapping run never double-sends.
export async function GET(req: NextRequest) {
  const blocked = guardCron(req)
  if (blocked) return blocked

  // deep review INT-6/INT-9: record the run, and surface a thrown dispatch as a
  // 500 + a recorded failure instead of a silent 200.
  const db = supabaseServer()
  const run = await startCronRun(db, 'campaigns')
  try {
    const { processed, results } = await dispatchDueCampaigns()
    await run.finish({ processed })
    return NextResponse.json({ processed, results })
  } catch (err) {
    run.fail('run', err)
    await run.finish({})
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
