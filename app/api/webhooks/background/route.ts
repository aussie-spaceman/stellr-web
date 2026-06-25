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
  if (parsed.assessment != null) update.assessment = parsed.assessment
  if (parsed.includesCanceled != null) update.includes_canceled = parsed.includesCanceled

  // passed/referred/cancelled are a finished report; expired = invite never used.
  const reportCompleted = parsed.status === 'passed' || parsed.status === 'referred' || parsed.status === 'cancelled'
  if (reportCompleted) {
    update.completed_at = now
    if (parsed.status === 'passed') {
      const expires = new Date()
      expires.setFullYear(expires.getFullYear() + BC_VALIDITY_YEARS)
      update.expires_at = expires.toISOString()
    }
  }

  await db.from('member_background_checks').update(update).eq('id', row.id)

  // Audit the meaningful terminal transitions.
  const AUDIT: Record<string, { action: string; summary: string }> = {
    passed: { action: 'background_check_passed', summary: 'Background check completed — cleared' },
    referred: { action: 'background_check_referred', summary: 'Background check completed — flagged for review' },
    cancelled: { action: 'background_check_cancelled', summary: 'Background check canceled before completion' },
    expired: { action: 'background_check_expired', summary: 'Background check invitation expired without completion' },
  }
  const audit = AUDIT[parsed.status]
  if (audit) {
    await logActivity(
      {
        memberId: row.member_id as string,
        category: 'compliance',
        action: audit.action,
        summary: parsed.includesCanceled ? `${audit.summary} (includes canceled screenings)` : audit.summary,
        metadata: {
          result: parsed.result,
          assessment: parsed.assessment ?? null,
          includesCanceled: parsed.includesCanceled ?? false,
          reportRef: parsed.reportRef,
        },
        actorType: 'system',
      },
      db,
    )
  }

  return NextResponse.json({ received: true })
}
