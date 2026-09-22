import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'
import { actorFromAuth, logActivity } from '@/lib/activity-log'
import { BC_VALIDITY_YEARS } from '@/lib/compliance'

// POST /api/admin/members/[id]/background-check/adjudicate
// Record the decision on a flagged ("Consider") report.
//
// A Consider means the provider found records; it does not decide anything. The
// named adjudicator reviews the report in the provider's dashboard, applies
// Stellr's eligibility criteria, and records the outcome here. Before this
// existed the decision lived only in the adjudicator's head and the provider's
// dashboard — for an FCRA-relevant judgement about working with minors, that is
// not a record.
//
// The check's `status` is deliberately NOT changed: it mirrors the vendor's
// report status, which is what the provider's certification compares against.
// deriveCompliance reads the adjudication alongside it.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = (await req.json().catch(() => null)) as
    | { outcome?: string; notes?: string; checkId?: string }
    | null

  const outcome = body?.outcome
  if (outcome !== 'cleared' && outcome !== 'not_cleared') {
    return NextResponse.json({ error: "outcome must be 'cleared' or 'not_cleared'" }, { status: 400 })
  }
  const notes = (body?.notes ?? '').trim()
  // A decision to clear someone despite records found is the one that needs a
  // reason on file; refusing is self-explanatory and adverse action carries its
  // own paperwork on the provider side.
  if (outcome === 'cleared' && notes.length < 10) {
    return NextResponse.json(
      { error: 'A short rationale is required when clearing a flagged check' },
      { status: 400 },
    )
  }

  const db = supabaseServer()

  const { data: check } = await db
    .from('member_background_checks')
    .select('id, status, completed_at, adjudicated_at')
    .eq('member_id', id)
    .order('ordered_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!check) return NextResponse.json({ error: 'No background check on file' }, { status: 404 })
  if (check.status !== 'referred') {
    return NextResponse.json(
      { error: `Only a flagged check can be adjudicated (this one is ${check.status})` },
      { status: 409 },
    )
  }
  if (body?.checkId && body.checkId !== check.id) {
    // The panel sends the id it rendered; if a newer check has landed since,
    // refuse rather than silently decide on a different report.
    return NextResponse.json({ error: 'This check has changed — reload and try again' }, { status: 409 })
  }

  const actor = await actorFromAuth()
  const now = new Date().toISOString()

  const update: Record<string, unknown> = {
    adjudicated_at: now,
    adjudicated_by: actor.actorMemberId ?? null,
    adjudicated_label: actor.actorLabel ?? null,
    adjudication_outcome: outcome,
    adjudication_notes: notes || null,
    updated_at: now,
  }
  // Clearing makes them compliant, so it needs the same 3-year validity a clear
  // report gets — measured from when the report completed, not from today.
  if (outcome === 'cleared') {
    const from = check.completed_at ? new Date(check.completed_at as string) : new Date()
    from.setFullYear(from.getFullYear() + BC_VALIDITY_YEARS)
    update.expires_at = from.toISOString()
  } else {
    update.expires_at = null
  }

  const { error } = await db.from('member_background_checks').update(update).eq('id', check.id)
  if (error) {
    console.error('[admin] adjudication failed:', error)
    return NextResponse.json({ error: 'Could not record the decision' }, { status: 500 })
  }

  await logActivity(
    {
      memberId: id,
      category: 'compliance',
      action: outcome === 'cleared' ? 'background_check_adjudicated_cleared' : 'background_check_adjudicated_not_cleared',
      summary:
        outcome === 'cleared'
          ? 'Flagged background check reviewed — cleared to take part'
          : 'Flagged background check reviewed — not cleared',
      metadata: { outcome, notes: notes || null, checkId: check.id },
      ...actor,
    },
    db,
  )

  return NextResponse.json({ ok: true, outcome, adjudicated_at: now })
}
