import { NextRequest, NextResponse } from 'next/server'
import { dispatchDueDrips } from '@/lib/email-campaigns'

// GET /api/cron/campaign-drip — runs daily (see vercel.json). Sends the queued
// steps of multi-email drip sequences whose delay has elapsed.
//
// Rows are enqueued by fireCampaignEvent() when a campaign has delay_days > 0.
// Eligibility (consent, active, tier) is re-checked at send time inside
// dispatchDueDrips, so an unsubscribe part-way through a sequence takes effect.
// Claiming each row before sending makes overlapping ticks safe.
export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await dispatchDueDrips()
  return NextResponse.json(result)
}
