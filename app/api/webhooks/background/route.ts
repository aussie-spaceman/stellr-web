import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getBackgroundProvider } from '@/lib/background-provider'
import { BC_VALIDITY_YEARS } from '@/lib/compliance'
import { logActivity } from '@/lib/activity-log'

// Background-check provider webhook (currently Checkr). Configure the endpoint
// URL in the provider's developer settings. The provider adapter owns signature
// verification and parsing; this route just reconciles to our row and applies
// the vendor-neutral status transition. Events can be delivered more than once,
// so updates are idempotent (we re-derive state from the payload).

export async function GET() {
  return NextResponse.json({ ok: true })
}

export async function POST(req: Request) {
  const rawBody = await req.text()
  const provider = getBackgroundProvider()
  const headerList = await headers()

  if (!provider.verifyWebhook(rawBody, headerList as unknown as Headers)) {
    console.error('[background-webhook] Invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const parsed = provider.parseWebhook(rawBody)
  if (!parsed || !parsed.status) return NextResponse.json({ received: true, skipped: 'no actionable event' })

  const db = supabaseServer()
  const now = new Date().toISOString()

  // Reconcile to our row: prefer the candidate ref (always set at order time),
  // fall back to the report ref.
  let query = db.from('member_background_checks').select('id, member_id, status').limit(1)
  if (parsed.candidateRef) query = query.eq('provider_candidate_ref', parsed.candidateRef)
  else if (parsed.reportRef) query = query.eq('provider_report_ref', parsed.reportRef)
  else return NextResponse.json({ received: true, skipped: 'no reference to match' })
  const { data: row } = await query.maybeSingle()

  if (!row) {
    console.warn('[background-webhook] No row for', parsed.candidateRef ?? parsed.reportRef)
    return NextResponse.json({ received: true })
  }

  const update: Record<string, unknown> = {
    status: parsed.status,
    result: parsed.result,
    updated_at: now,
  }
  if (parsed.reportRef) update.provider_report_ref = parsed.reportRef
  if (parsed.status === 'passed' || parsed.status === 'referred') {
    update.completed_at = now
    if (parsed.status === 'passed') {
      const expires = new Date()
      expires.setFullYear(expires.getFullYear() + BC_VALIDITY_YEARS)
      update.expires_at = expires.toISOString()
    }
  }

  await db.from('member_background_checks').update(update).eq('id', row.id)

  if (parsed.status === 'passed' || parsed.status === 'referred') {
    await logActivity(
      {
        memberId: row.member_id as string,
        category: 'compliance',
        action: parsed.status === 'passed' ? 'background_check_passed' : 'background_check_referred',
        summary:
          parsed.status === 'passed'
            ? 'Background check completed — cleared'
            : 'Background check completed — flagged for review',
        metadata: { result: parsed.result, reportRef: parsed.reportRef },
        actorType: 'system',
      },
      db,
    )
  }

  return NextResponse.json({ received: true })
}
