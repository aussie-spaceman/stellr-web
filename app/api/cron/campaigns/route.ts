import { NextRequest, NextResponse } from 'next/server'
import { dispatchDueCampaigns } from '@/lib/email-campaigns'
import { guardCron } from '@/lib/cron'

// GET /api/cron/campaigns — runs hourly (see vercel.json). Sends every scheduled
// campaign whose send time has arrived. Idempotent via the email_campaign_sends
// ledger, so a retried or overlapping run never double-sends.
export async function GET(req: NextRequest) {
  const blocked = guardCron(req)
  if (blocked) return blocked

  const { processed, results } = await dispatchDueCampaigns()
  return NextResponse.json({ processed, results })
}
