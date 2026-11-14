import { hasCapability } from '@/lib/authz'
import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { stellrRows } from '@/lib/tenancy/stellr-scope'

// GET /api/admin/docusigns — every agreement of Stellr's, across all participants.
//
// A Stellr-only list (tracker s5-programme.29): it holds Stellr's rows and rows with no
// tenant yet, in every LOADSCOPED_MODE, and never another tenant's (a tenant's guardian
// consent agreements, for one). stellrRows counts NULL as Stellr's, so a row the backfill
// stamped Stellr and one it has not reached both stay listed. test/stellr-only-lists-ratchet.test.ts
// holds every Stellr-only admin list to this.
export async function GET() {
  if (!(await hasCapability('portal:read'))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = supabaseServer()

  // deep review DS-9: without an explicit range PostgREST caps this at 1000
  // rows, silently truncating the list and the pending/completed counters as
  // the agreement count grows. Ask for the full set.
  const { data: envelopes } = await stellrRows(
    db
      .from('agreements')
      .select('id, envelope_id, status, envelope_type, signer_name, signer_email, minor_name, event_title, event_slug, sent_at, completed_at, declined_at, reminder_sent_at, participant_id, member_id'),
  )
    .order('sent_at', { ascending: false })
    .range(0, 99_999)

  return NextResponse.json({ envelopes: envelopes ?? [] })
}
