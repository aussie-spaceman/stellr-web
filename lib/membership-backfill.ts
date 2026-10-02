import type { SupabaseClient } from '@supabase/supabase-js'
import { dispatchMembershipAgreement, membershipAgreementOutstanding } from '@/lib/membership-agreement'
import { batchInvites } from '@/lib/esign/outbox'

// The Membership Agreement for members who joined before it existed
// (docs/PLAN-esign-2026-10-02.md, Phase 3). Run from Admin → Consent forms in
// small batches: each agreement's emails go through the signing outbox's daily
// budget, so a large backfill reaches families over several days without
// crowding out payment and registration mail. Dry run first, always.
//
// Who: members with an account who finished onboarding (date of birth set),
// not deleted, and not volunteers (they sign the mentor agreement). Anyone with
// a signed agreement still valid, or one already out for signature, is skipped
// by dispatchMembershipAgreement itself.

export interface BackfillResult {
  dryRun: boolean
  candidates: number
  outstanding: number
  issued: number
  outcomes: Record<string, number>
}

const PAGE = 500

async function candidates(db: SupabaseClient): Promise<string[]> {
  const ids: string[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('members')
      .select('id')
      .is('deleted_at', null)
      .not('clerk_user_id', 'is', null)
      .not('date_of_birth', 'is', null)
      .not('email', 'is', null)
      .or('event_role.is.null,event_role.neq.volunteer')
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`Member lookup failed: ${error.message}`)
    ids.push(...(data ?? []).map((r) => r.id as string))
    if ((data ?? []).length < PAGE) return ids
  }
}

export async function backfillMembershipAgreements(
  db: SupabaseClient,
  opts: { limit: number; dryRun: boolean },
): Promise<BackfillResult> {
  const ids = await candidates(db)
  const owing: string[] = []
  for (const id of ids) if (await membershipAgreementOutstanding(db, id)) owing.push(id)
  const result: BackfillResult = { dryRun: opts.dryRun, candidates: ids.length, outstanding: owing.length, issued: 0, outcomes: {} }
  if (opts.dryRun) return result

  // Sent together at the end, a parent's forms in one email.
  await batchInvites(db, async () => {
    for (const id of owing.slice(0, opts.limit)) {
      let outcome: string
      try {
        outcome = (await dispatchMembershipAgreement(db, id)).outcome
      } catch (err) {
        console.error(`[membership-backfill] ${id} failed:`, err)
        outcome = 'error'
      }
      result.outcomes[outcome] = (result.outcomes[outcome] ?? 0) + 1
      if (outcome === 'issued') result.issued++
    }
  })
  return result
}
