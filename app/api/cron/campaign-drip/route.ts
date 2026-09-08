import { NextRequest, NextResponse } from 'next/server'
import { dispatchDueDrips } from '@/lib/email-campaigns'
import { guardCron } from '@/lib/cron'

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

  const result = await dispatchDueDrips()
  return NextResponse.json(result)
}
