import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { fireCampaignEvent } from '@/lib/email-campaigns'
import { guardCron } from '@/lib/cron'
import { startCronRun } from '@/lib/cron-runs'

// GET /api/cron/campaign-events — runs daily (see vercel.json). Translates
// date-based membership milestones into campaign events. Currently:
//   membership.renewal_7d — active membership expires in 7 days.
// fireCampaignEvent is a no-op when no matching campaign is active, and the
// campaign send ledger dedups (dedup_key = the expiry date), so re-runs and the
// 1-day scan window can never double-send for a given renewal cycle.
export async function GET(req: NextRequest) {
  const blocked = guardCron(req)
  if (blocked) return blocked

  const db = supabaseServer()
  const run = await startCronRun(db, 'campaign-events')

  // Window: memberships expiring on the calendar day 7 days from now (UTC).
  const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const now = new Date()
  const from = startOfDay(new Date(now.getTime() + 7 * 86_400_000))
  const to = startOfDay(new Date(now.getTime() + 8 * 86_400_000))

  // deep review INT-9: the main query error was previously swallowed —
  // `memberships` came back null, the loop reported `fired: 0` and the cron
  // returned 200. A query failure now records a failed run and returns 500.
  const { data: memberships, error } = await db
    .from('member_memberships')
    .select('member_id, expires_at')
    .eq('renewal_status', 'active')
    .gte('expires_at', from.toISOString())
    .lt('expires_at', to.toISOString())
  if (error) {
    run.fail('query', error.message)
    await run.finish({ fired: 0 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let fired = 0
  for (const m of memberships ?? []) {
    if (!m.member_id) continue
    const expiryDate = new Date(m.expires_at).toISOString().slice(0, 10) // YYYY-MM-DD
    try {
      await fireCampaignEvent('membership.renewal_7d', m.member_id, `renewal7d-${expiryDate}`)
      fired++
    } catch (e) {
      console.error('[campaign-events] renewal_7d failed for', m.member_id, '—', e)
      run.fail(String(m.member_id), e)
    }
  }

  await run.finish({ candidates: memberships?.length ?? 0, fired })
  return NextResponse.json({ window: { from: from.toISOString(), to: to.toISOString() }, candidates: memberships?.length ?? 0, fired })
}
