import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { verifyWebhook, parseApplication, mapResult } from '@/lib/certn'
import { BC_VALIDITY_YEARS } from '@/lib/compliance'
import { logActivity } from '@/lib/activity-log'

// Certn webhook. Configure the endpoint URL in Certn team settings; when
// CERTN_WEBHOOK_SECRET is set Certn signs the body (Certn-Signature header).
// Certn POSTs as an application's status changes; we act on COMPLETE, mapping
// report_status + result to our domain status (passed / referred) and stamping
// the 3-year validity window on completion.

export async function GET() {
  return NextResponse.json({ ok: true })
}

export async function POST(req: Request) {
  const rawBody = await req.text()
  const headerList = await headers()
  const signature =
    headerList.get('certn-signature') ?? headerList.get('x-certn-signature') ?? null

  if (!verifyWebhook(rawBody, signature)) {
    console.error('[certn-webhook] Invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const app = parseApplication(body)
  if (!app.applicationId) return NextResponse.json({ received: true, skipped: 'no application id' })

  const db = supabaseServer()
  const now = new Date().toISOString()
  const status = mapResult(app.reportStatus, app.result)

  const update: Record<string, unknown> = {
    status,
    result: app.result,
    raw: app.raw,
    updated_at: now,
  }
  if (status === 'passed' || status === 'referred') {
    update.completed_at = now
    if (status === 'passed') {
      const expires = new Date()
      expires.setFullYear(expires.getFullYear() + BC_VALIDITY_YEARS)
      update.expires_at = expires.toISOString()
    }
  }

  const { data: row } = await db
    .from('member_background_checks')
    .update(update)
    .eq('certn_application_id', app.applicationId)
    .select('id, member_id, status')
    .maybeSingle()

  if (!row) {
    console.warn('[certn-webhook] No background-check row for application', app.applicationId)
    return NextResponse.json({ received: true })
  }

  // Log the outcome against the member (shared activity timeline).
  if (status === 'passed' || status === 'referred') {
    await logActivity(
      {
        memberId: row.member_id as string,
        category: 'compliance',
        action: status === 'passed' ? 'background_check_passed' : 'background_check_referred',
        summary:
          status === 'passed'
            ? 'Background check completed — cleared'
            : 'Background check completed — flagged for review',
        metadata: { applicationId: app.applicationId, result: app.result },
        actorType: 'system',
      },
      db,
    )
  }

  return NextResponse.json({ received: true })
}
