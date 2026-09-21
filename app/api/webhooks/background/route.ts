import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { getBackgroundProvider } from '@/lib/background-provider'
import { applyCheckOutcome, type CheckOutcome } from '@/lib/background-sync'

// Background-check provider webhook (currently Checkr). Configure the endpoint
// URL in the provider's developer settings. The provider adapter owns signature
// verification and parsing; this route just reconciles to our row and hands the
// vendor-neutral outcome to lib/background-sync, which is the single writer
// shared with the polling sync. Events can be delivered more than once, so the
// write is idempotent (state is re-derived from the payload each time).

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

  await applyCheckOutcome(db, row as { id: string; member_id: string; status: string }, parsed as CheckOutcome, 'webhook')

  return NextResponse.json({ received: true })
}
