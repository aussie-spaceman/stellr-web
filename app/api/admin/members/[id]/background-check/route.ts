import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { supabaseServer } from '@/lib/supabase'
import { isAdminClaims } from '@/lib/admin-auth'
import { getBackgroundProvider } from '@/lib/background-provider'
import { actorFromAuth, logActivity } from '@/lib/activity-log'
import { requiresBackgroundCheck } from '@/lib/compliance'

// POST /api/admin/members/[id]/background-check
// Admin orders a background check for an adult member via the hosted-invite flow
// (the provider emails the candidate to complete their info + consent). Stellr is
// billed per report; the member is NOT charged. "Payment occurs automatically
// once ordered" (PRD) is satisfied by the provider's own per-report billing.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { sessionClaims } = await auth()
  if (!isAdminClaims(sessionClaims)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const db = supabaseServer()
  const provider = getBackgroundProvider()

  const { data: member } = await db
    .from('members')
    .select('id, first_name, last_name, email, event_role, date_of_birth, member_teacher_licenses(licensing_state)')
    .eq('id', id)
    .maybeSingle()
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  if (!member.email) return NextResponse.json({ error: 'Member has no email on file' }, { status: 400 })
  if (!requiresBackgroundCheck(member.event_role, member.date_of_birth)) {
    return NextResponse.json({ error: 'This member does not require a background check' }, { status: 400 })
  }

  // Don't double-order while one is already outstanding or valid.
  const { data: existing } = await db
    .from('member_background_checks')
    .select('id, status, expires_at')
    .eq('member_id', id)
    .order('ordered_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existing && (existing.status === 'invited' || existing.status === 'in_progress')) {
    return NextResponse.json({ error: 'A background check is already in progress for this member' }, { status: 409 })
  }

  if (!provider.configured()) {
    return NextResponse.json(
      { error: `Background-check provider (${provider.name}) is not configured` },
      { status: 503 },
    )
  }

  const actor = await actorFromAuth()
  const state =
    (member.member_teacher_licenses as { licensing_state: string | null }[] | null)?.[0]?.licensing_state ?? null

  let ordered
  try {
    ordered = await provider.order({
      email: member.email,
      firstName: member.first_name ?? '',
      lastName: member.last_name ?? '',
      state,
      // Stable per-member key: dedupes the candidate-create on retry while still
      // allowing a fresh invitation/report (multiple checks for one candidate).
      idempotencyKey: `cand-${id}`,
    })
  } catch (err) {
    console.error('[admin] background-check order failed:', err)
    // Record the failed attempt so it's visible/auditable.
    await db.from('member_background_checks').insert({
      member_id: id,
      provider: provider.name,
      status: 'error',
      ordered_by: actor.actorMemberId ?? null,
      ordered_label: actor.actorLabel ?? null,
    })
    return NextResponse.json({ error: `Failed to order background check with ${provider.name}` }, { status: 502 })
  }

  const { data: row, error } = await db
    .from('member_background_checks')
    .insert({
      member_id: id,
      provider: provider.name,
      provider_candidate_ref: ordered.candidateRef,
      provider_invitation_ref: ordered.invitationRef,
      provider_report_ref: ordered.reportRef,
      invitation_url: ordered.invitationUrl,
      status: 'invited',
      ordered_by: actor.actorMemberId ?? null,
      ordered_label: actor.actorLabel ?? null,
    })
    .select('id, status, ordered_at')
    .single()
  if (error) {
    console.error('[admin] background-check insert error:', error)
    return NextResponse.json({ error: 'Order placed but failed to record it' }, { status: 500 })
  }

  await logActivity(
    {
      memberId: id,
      category: 'compliance',
      action: 'background_check_ordered',
      summary: 'Background check ordered — invitation sent to the member',
      metadata: { provider: provider.name, candidateRef: ordered.candidateRef, invitationRef: ordered.invitationRef },
      ...actor,
    },
    db,
  )

  return NextResponse.json({ ok: true, check: row })
}
