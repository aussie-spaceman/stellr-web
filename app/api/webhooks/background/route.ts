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

  // Reconcile to OUR row by the MOST SPECIFIC ref the event carries, newest
  // first (deep review BG-6). The old code matched on the candidate ref alone
  // with .limit(1) and no ordering, which breaks when two checks share a Checkr
  // candidate — the 22-Sept flow of deleting an invitation and re-ordering the
  // same day reuses the candidate id within Checkr's 24h window. That let a late
  // `invitation.deleted` for the OLD invitation land on the NEWER row and cancel
  // it (a cancelled row is no longer polled, so the real outcome is stranded),
  // and a report event hit whichever row came back first.
  //
  // Precedence:
  //   1. An invitation event carries an invitation id that is unique to one of
  //      our rows — match it exactly, so a stale invitation.* only ever touches
  //      its own row.
  //   2. A report event's report id is matched directly; a brand-new report whose
  //      id we haven't stored yet falls back to the newest OPEN row for the
  //      candidate (a cancelled/terminal row is never revived by it).
  //   3. Otherwise match the candidate, newest by ordered_at.
  const selectOne = () =>
    db
      .from('member_background_checks')
      .select('id, member_id, status')
      .order('ordered_at', { ascending: false })
      .limit(1)

  let row: { id: string; member_id: string; status: string } | null = null
  if (parsed.invitationRef) {
    ;({ data: row } = await selectOne().eq('provider_invitation_ref', parsed.invitationRef).maybeSingle())
  } else if (parsed.reportRef) {
    ;({ data: row } = await selectOne().eq('provider_report_ref', parsed.reportRef).maybeSingle())
    if (!row && parsed.candidateRef) {
      ;({ data: row } = await selectOne()
        .eq('provider_candidate_ref', parsed.candidateRef)
        .in('status', ['invited', 'in_progress'])
        .maybeSingle())
    }
  } else if (parsed.candidateRef) {
    ;({ data: row } = await selectOne().eq('provider_candidate_ref', parsed.candidateRef).maybeSingle())
  } else {
    return NextResponse.json({ received: true, skipped: 'no reference to match' })
  }

  if (!row) {
    console.warn('[background-webhook] No row for', parsed.invitationRef ?? parsed.reportRef ?? parsed.candidateRef)
    return NextResponse.json({ received: true })
  }

  await applyCheckOutcome(db, row as { id: string; member_id: string; status: string }, parsed as CheckOutcome, 'webhook')

  return NextResponse.json({ received: true })
}
