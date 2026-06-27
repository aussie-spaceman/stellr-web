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

export interface EnrollmentGateResult {
  /** true = not a minor, OR a participation agreement is on file. */
  minorAgreement: boolean
  /** Whether enrollment is allowed (currently == minorAgreement). */
  unlocked: boolean
}

/**
 * Minor participation-agreement gate for joining a cohort / workshop (Rec C1 of
 * the Workshops & Cohorts access plan). A credit spend or paid seat must not let a
 * minor into a live container without a signed agreement on file. REPORT-ONLY by
 * default (mirrors the competition gates): logs who would be blocked and returns
 * the status, but callers only DENY when accessGatesEnforced() is true.
 *
 * "On file" reuses the DocuSign validity layer: any completed envelope linked to
 * the member (via their participant rows) counts as a participation agreement on
 * file. Adults always pass.
 */
export async function reportEnrollmentGate(
  member: { id: string },
  opts: { kind: 'cohort' | 'workshop'; containerId: string; containerName?: string },
): Promise<EnrollmentGateResult> {
  const db = supabaseServer()

  const { data: m } = await db.from('members').select('date_of_birth').eq('id', member.id).maybeSingle()
  const minor = isMinor((m as { date_of_birth?: string | null } | null)?.date_of_birth ?? null)
  if (!minor) return { minorAgreement: true, unlocked: true }

  // Any completed DocuSign envelope on file for this member → agreement satisfied.
  const { data: parts } = await db.from('participants').select('id').eq('member_id', member.id)
  const pids = (parts ?? []).map((p) => (p as { id: string }).id)
  let hasCompleted = false
  if (pids.length) {
    const { count } = await db
      .from('docusign_envelopes')
      .select('id', { count: 'exact', head: true })
      .in('participant_id', pids)
      .eq('status', 'completed')
    hasCompleted = (count ?? 0) > 0
  }

  if (!hasCompleted) {
    await logActivity({
      memberId: member.id,
      category: 'membership',
      action: 'access_gate_would_block',
      summary: `Minor would be blocked from ${opts.kind} ${opts.containerName ?? opts.containerId} (report-only): participation agreement`,
      metadata: { kind: opts.kind, containerId: opts.containerId, gate: 'minor_agreement', mode: accessGatesEnforced() ? 'enforced' : 'report_only' },
      actorType: 'system',
    }).catch(() => {})
  }

  return { minorAgreement: hasCompleted, unlocked: hasCompleted }
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
