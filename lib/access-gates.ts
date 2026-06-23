import { supabaseServer } from '@/lib/supabase'
import type { CommunityMember } from '@/lib/community'
import { logActivity } from '@/lib/activity-log'

// Access gate layer (convergence P2). A single place that answers "is this
// member's access to a competition fully unlocked?" by combining the payment and
// DocuSign gates — the per-participant pill logic in lib/event-admin.ts, but
// aggregated to the member. Prerequisites are intentionally excluded for now
// (deferred — decision D-F).
//
// P2 ships this in REPORT-ONLY mode: reportEventAccessGates logs who WOULD be
// blocked but never denies. The P4 flip will switch callers to enforce.

export interface EventGateResult {
  /** true = payment cleared OR not applicable. */
  payment: boolean
  /** true = required paperwork complete OR not required. */
  docusign: boolean
  /** Whether every applicable gate is cleared. */
  unlocked: boolean
}

/**
 * Whether access gates actually DENY (P4) or only report (P2). Off by default so
 * deploying the enforcement code never locks anyone out; flip ACCESS_GATES_ENFORCE
 * to 'true' once rosters reflect real paid/signed members. Report-only either way.
 */
export function accessGatesEnforced(): boolean {
  return process.env.ACCESS_GATES_ENFORCE === 'true'
}

function isMinor(dob: string | null): boolean {
  if (!dob) return false
  const age = (Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000)
  return age < 18
}

/**
 * Payment + DocuSign gate status for a member's access to a competition. Payment
 * passes if any of the member's participations is paid; DocuSign passes if none
 * of them is outstanding (mirrors the roster pills). Members with no participant
 * row for the event are treated as ungated here — the portal's participant check
 * is what controls whether they're in at all.
 */
export async function eventAccessGates(member: CommunityMember, eventSlug: string): Promise<EventGateResult> {
  const db = supabaseServer()

  const { data: parts } = await db
    .from('participants')
    .select('id, date_of_birth, individual_payment_status, registrations!inner(event_slug, status, amount_due_cents)')
    .eq('member_id', member.id)

  type Reg = { event_slug: string; status: string; amount_due_cents: number | null }
  type Row = {
    id: string
    date_of_birth: string | null
    individual_payment_status: string | null
    registrations: Reg | Reg[] | null
  }
  const mine = ((parts ?? []) as unknown as Row[])
    .map((p) => {
      const reg = Array.isArray(p.registrations) ? p.registrations[0] : p.registrations
      return reg && reg.event_slug === eventSlug ? { row: p, reg } : null
    })
    .filter((x): x is { row: Row; reg: Reg } => !!x)

  if (mine.length === 0) return { payment: true, docusign: true, unlocked: true }

  // Payment: each participation passes if nothing is owed (free event — amount_due
  // 0/null) OR it's been paid. The member passes if all of theirs do.
  const payment = mine.every((m) => {
    const owes = (m.reg.amount_due_cents ?? 0) > 0
    const paidThis = m.reg.status === 'confirmed' || m.row.individual_payment_status === 'paid'
    return !owes || paidThis
  })

  // DocuSign: load the members' envelopes; a required one that isn't complete blocks.
  const participantIds = mine.map((m) => m.row.id)
  const { data: envs } = await db
    .from('docusign_envelopes')
    .select('participant_id, status')
    .eq('event_slug', eventSlug)
    .in('participant_id', participantIds)

  const envByParticipant = new Map<string, string>()
  for (const e of envs ?? []) {
    const pid = e.participant_id as string | null
    if (!pid) continue
    if (envByParticipant.get(pid) !== 'completed') envByParticipant.set(pid, e.status as string)
  }

  const docusign = mine.every((m) => {
    const status = envByParticipant.get(m.row.id)
    if (status === 'completed') return true
    if (status) return false // issued / partial / declined / voided → outstanding
    return !isMinor(m.row.date_of_birth) // no envelope: required only for minors
  })

  return { payment, docusign, unlocked: payment && docusign }
}

/**
 * REPORT-ONLY gate check (P2). Logs when a member would be blocked from a
 * competition, but never denies — surfaces who'd be locked out ahead of the P4
 * enforcement flip. Callers must NOT gate access on the result yet.
 */
export async function reportEventAccessGates(
  member: CommunityMember,
  eventSlug: string,
): Promise<EventGateResult> {
  const gates = await eventAccessGates(member, eventSlug)
  if (!gates.unlocked) {
    const missing = [!gates.payment && 'payment', !gates.docusign && 'DocuSign'].filter(Boolean).join(' + ')
    await logActivity({
      memberId: member.id,
      category: 'event',
      action: 'access_gate_would_block',
      summary: `Would be blocked from ${eventSlug} (report-only): ${missing}`,
      metadata: { eventSlug, payment: gates.payment, docusign: gates.docusign, mode: 'report_only' },
      actorType: 'system',
    }).catch(() => {})
  }
  return gates
}
