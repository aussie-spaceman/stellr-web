import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { guardCron } from '@/lib/cron'
import { recordCredentialOptOutFromForm, OPT_OUT_ENVELOPE_COLUMNS, type OptOutEnvelope } from '@/lib/docusign-optout'

// GET /api/cron/docusign-form-data
// Vercel cron, daily (see vercel.json).
//
// Retries the credential-sharing opt-out read for completed minor consent
// forms whose form data was never read — the webhook read failed, or Connect
// never delivered the completion. Looks back 7 days; older misses are a
// manual job (admin Consent forms table).

const LOOKBACK_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

export async function GET(req: NextRequest) {
  const blocked = guardCron(req)
  if (blocked) return blocked

  const db = supabaseServer()
  const since = new Date(Date.now() - LOOKBACK_DAYS * DAY_MS).toISOString()

  const { data, error } = await db
    .from('docusign_envelopes')
    .select(OPT_OUT_ENVELOPE_COLUMNS)
    .eq('envelope_type', 'minor')
    .eq('status', 'completed')
    .is('reused_from', null)
    .is('form_data_read_at', null)
    .gte('completed_at', since)
    .limit(50)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const results: Record<string, number> = {}
  for (const env of (data ?? []) as OptOutEnvelope[]) {
    const r = await recordCredentialOptOutFromForm(db, env)
    results[r] = (results[r] ?? 0) + 1
  }
  return NextResponse.json({ processed: data?.length ?? 0, results })
}
