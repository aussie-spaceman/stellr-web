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
        const { data: member } = await db
          .from('members')
          .select('id, first_name, last_name, email, phone, date_of_birth')
          .eq('id', row.member_id)
          .maybeSingle()
        if (member) {
          const { dispatchVolunteerAgreement } = await import('@/lib/volunteer')
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
