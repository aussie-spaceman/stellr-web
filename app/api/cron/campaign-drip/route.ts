import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { dispatchDueDrips } from '@/lib/email-campaigns'
import { guardCron } from '@/lib/cron'
import { startCronRun } from '@/lib/cron-runs'

// GET /api/cron/campaign-drip — runs daily (see vercel.json). Sends the queued
// steps of multi-email drip sequences whose delay has elapsed.
//
// Rows are enqueued by fireCampaignEvent() when a campaign has delay_days > 0.
// Eligibility (consent, active, tier) is re-checked at send time inside
// dispatchDueDrips, so an unsubscribe part-way through a sequence takes effect.
// Claiming each row before sending makes overlapping ticks safe.
export async function GET(req: NextRequest) {
  const blocked = guardCron(req)
  if (blocked) return blocked

  // deep review INT-9: record every run + surface a thrown dispatch (so a broken
  // drip integration is visible in cron_runs rather than a silent 200).
  const db = supabaseServer()
  const run = await startCronRun(db, 'campaign-drip')
  try {
    const result = await dispatchDueDrips()
    await run.finish(result as unknown as Record<string, unknown>)
    return NextResponse.json(result)
  } catch (err) {
    run.fail('run', err)
    await run.finish({})
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
