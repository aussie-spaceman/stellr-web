import type { SupabaseClient } from '@supabase/supabase-js'
import { ISSUE_FAILED_PREFIX } from '@/lib/docusign-agreements'

// Second chances, run daily. An agreement that could not be issued on any
// engine is recorded as a "failed:" row (lib/docusign-agreements.ts) so the
// participant shows as needing paperwork; this retries it. Nothing here ever
// runs silently: each retry's outcome is returned for the cron ledger.

/** Failed issues older than this are left for a person: something is wrong that retrying will not fix. */
const RETRY_WINDOW_DAYS = 14

export interface ReconcileResult {
  candidates: number
  retried: number
  outcomes: Record<string, number>
}

export async function retryFailedIssues(
  db: SupabaseClient,
  opts: { limit?: number; dryRun?: boolean; now?: Date } = {},
): Promise<ReconcileResult> {
  const now = opts.now ?? new Date()
  const since = new Date(now.getTime() - RETRY_WINDOW_DAYS * 86_400_000).toISOString()
  const { data, error } = await db
    .from('agreements')
    .select('id, envelope_id, envelope_type, participant_id, member_id, created_at')
    .like('envelope_id', `${ISSUE_FAILED_PREFIX}%`)
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(opts.limit ?? 20)
  if (error) throw new Error(`Failed-issue query failed: ${error.message}`)

  const rows = (data ?? []) as { id: string; envelope_type: string; participant_id: string | null; member_id: string | null }[]
  const result: ReconcileResult = { candidates: rows.length, retried: 0, outcomes: {} }
  if (opts.dryRun) return result

  for (const row of rows) {
    // Remove the marker first: a retry that fails again records a fresh one,
    // so markers never pile up for the same person.
    await db.from('agreements').delete().eq('id', row.id)
    let outcome = 'skipped'
    try {
      if (row.participant_id) {
        const { reissueParticipantAgreement } = await import('@/lib/docusign-reissue')
        const r = await reissueParticipantAgreement(db, row.participant_id, { allowNewEnvelope: true })
        outcome = r.kind === 'reissued' ? r.outcome : r.kind
      } else if (row.member_id && (row.envelope_type === 'volunteer' || row.envelope_type === 'mentor')) {
        const { dispatchVolunteerAgreement, VOLUNTEER_MEMBER_COLUMNS } = await import('@/lib/volunteer')
        const { data: member } = await db
          .from('members')
          .select(VOLUNTEER_MEMBER_COLUMNS)
          .eq('id', row.member_id)
          .maybeSingle()
        if (member) {
          outcome = await dispatchVolunteerAgreement(db, member as never)
        }
      } else if (row.member_id && row.envelope_type === 'membership') {
        const { dispatchMembershipAgreement } = await import('@/lib/membership-agreement')
        outcome = (await dispatchMembershipAgreement(db, row.member_id)).outcome
      }
    } catch (err) {
      outcome = 'error'
      console.error(`[esign-reconcile] retry for ${row.id} failed:`, err)
    }
    result.retried++
    result.outcomes[outcome] = (result.outcomes[outcome] ?? 0) + 1
  }
  return result
}

/** Participants this recent with no agreement row at all are retried. */
const MISSING_WINDOW_DAYS = 3
/**
 * …but not the last few minutes: a registration's own post-response follow-up
 * may still be issuing them, and two concurrent issues for one person both pass
 * the in-flight check and send two envelopes.
 */
const MISSING_SETTLE_MS = 15 * 60_000

/**
 * The other half of second chances: a participant who never got a row at all,
 * not even a "failed:" marker. That is what a cut-off registration leaves (on
 * 28 Oct 2026 a group request was killed mid-loop and 7 students had nothing).
 * The registration follow-up now stops at a deadline instead of being killed,
 * and this picks up whatever it did not reach. reissueParticipantAgreement
 * decides whether an agreement is needed at all, so a participant who needs
 * none is skipped, not issued.
 */
export async function issueMissingAgreements(
  db: SupabaseClient,
  opts: { limit?: number; dryRun?: boolean; now?: Date } = {},
): Promise<ReconcileResult> {
  const now = opts.now ?? new Date()
  const since = new Date(now.getTime() - MISSING_WINDOW_DAYS * 86_400_000).toISOString()
  const settled = new Date(now.getTime() - MISSING_SETTLE_MS).toISOString()
  const { data, error } = await db
    .from('participants')
    .select('id, registrations!inner(status)')
    .gte('created_at', since)
    .lte('created_at', settled)
    .neq('registrations.status', 'withdrawn')
    .order('created_at', { ascending: true })
    .limit(500)
  if (error) throw new Error(`Recent-participant query failed: ${error.message}`)
  const ids = (data ?? []).map((p) => (p as { id: string }).id)

  let missing: string[] = []
  if (ids.length) {
    const { data: rows, error: rowsError } = await db
      .from('agreements')
      .select('participant_id')
      .in('participant_id', ids)
    if (rowsError) throw new Error(`Agreement lookup failed: ${rowsError.message}`)
    const covered = new Set((rows ?? []).map((r) => (r as { participant_id: string }).participant_id))
    missing = ids.filter((id) => !covered.has(id)).slice(0, opts.limit ?? 20)
  }

  const result: ReconcileResult = { candidates: missing.length, retried: 0, outcomes: {} }
  if (opts.dryRun) return result

  const { reissueParticipantAgreement } = await import('@/lib/docusign-reissue')
  for (const participantId of missing) {
    let outcome = 'skipped'
    try {
      const r = await reissueParticipantAgreement(db, participantId, { allowNewEnvelope: true })
      outcome = r.kind === 'reissued' ? r.outcome : r.kind
    } catch (err) {
      outcome = 'error'
      console.error(`[esign-reconcile] missing-agreement issue for ${participantId} failed:`, err)
    }
    result.retried++
    result.outcomes[outcome] = (result.outcomes[outcome] ?? 0) + 1
  }
  return result
}
