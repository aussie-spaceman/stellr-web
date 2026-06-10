import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { fireCampaignEvent } from '@/lib/email-campaigns'

// GET /api/cron/campaign-events — runs daily (see vercel.json). Translates
// date-based membership milestones into campaign events. Currently:
//   membership.renewal_7d — active membership expires in 7 days.
// fireCampaignEvent is a no-op when no matching campaign is active, and the
// campaign send ledger dedups (dedup_key = the expiry date), so re-runs and the
// 1-day scan window can never double-send for a given renewal cycle.
export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = supabaseServer()

  // Window: memberships expiring on the calendar day 7 days from now (UTC).
  const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const now = new Date()
  const from = startOfDay(new Date(now.getTime() + 7 * 86_400_000))
  const to = startOfDay(new Date(now.getTime() + 8 * 86_400_000))

  const { data: memberships } = await db
    .from('member_memberships')
    .select('member_id, expires_at')
    .eq('renewal_status', 'active')
    .gte('expires_at', from.toISOString())
    .lt('expires_at', to.toISOString())

  let fired = 0
  for (const m of memberships ?? []) {
    if (!m.member_id) continue
    const expiryDate = new Date(m.expires_at).toISOString().slice(0, 10) // YYYY-MM-DD
    try {
      await fireCampaignEvent('membership.renewal_7d', m.member_id, `renewal7d-${expiryDate}`)
      fired++
    } catch (e) {
      console.error('[campaign-events] renewal_7d failed for', m.member_id, '—', e)
    }
  }

  return NextResponse.json({ window: { from: from.toISOString(), to: to.toISOString() }, candidates: memberships?.length ?? 0, fired })
}
