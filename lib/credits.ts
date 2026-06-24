// lib/credits.ts — the shared access-credit WALLET (Rec 1 of the Workshops &
// Cohorts access plan, docs/WORKSHOP-COHORT-ACCESS-PLAN.md).
//
// One ledger (session_credits, added 021 + widened 070/078) serves two products
// from identical machinery, keyed on the credit TYPE:
//   • 'mentoring' — cohort credits   (1 credit = 1 mentoring cohort enrollment)
//   • 'workshop'  — workshop credits (1 credit = 1 coaching workshop enrollment)
// The 1:1 coaching/mentoring extra-session credits keep their own rows; this
// module only ever reads/writes the type it is asked for.
//
// Decisions (2026-06-23, generalised 2026-06-24): credits are a per-tier ANNUAL
// grant (membership_tiers.<type>_credits_grant), 1 credit = 1 enrollment, unused
// credits ROLL OVER (allowance rows are never expired); paid top-ups + rule
// grants are allowed; a container cancellation returns the spent credit (any
// non-'purchase' source) to the member's balance.
import 'server-only'
import { supabaseServer } from '@/lib/supabase'
import type { CommunityMember } from '@/lib/community'

/** The wallet's type axis — one independent balance per product. */
export type CreditType = 'mentoring' | 'workshop'

/** Where a credit row came from. 'allowance' = annual tier grant (idempotent on
 * the membership id); 'topup'/'purchase' = paid; 'grant' = handed out by a
 * tier_grant_rule (event / tier), idempotent on a caller-supplied grant key. */
export type CreditSource = 'allowance' | 'purchase' | 'topup' | 'grant'

/** Per-tier annual-grant column for each credit type. */
const TIER_GRANT_COL: Record<CreditType, string> = {
  mentoring: 'mentoring_credits_grant',
  workshop: 'workshop_credits_grant',
}

export interface CreditBalance {
  /** Available to spend now (allowance roll-over + top-ups + rule grants). */
  remaining: number
  /** Spent on enrollments. */
  used: number
  /** Total ever granted/purchased (remaining + used). */
  total: number
}

/**
 * Idempotently materialise each active membership's annual allowance for one
 * credit type as `session_credits` rows. Keying on the membership id means a
 * grant is created exactly once per membership period; because allowance rows are
 * never expired, unused credits roll over into the next period.
 */
export async function syncAllowance(member: CommunityMember, creditType: CreditType): Promise<void> {
  const db = supabaseServer()
  const col = TIER_GRANT_COL[creditType]
  const today = new Date().toISOString().split('T')[0]

  const { data: ms } = await db
    .from('member_memberships')
    .select(`id, expires_at, membership_tiers(${col})`)
    .eq('member_id', member.id)
    .eq('renewal_status', 'active')

  type Row = {
    id: string
    expires_at: string | null
    membership_tiers: Record<string, number> | Record<string, number>[] | null
  }
  const rows = ((ms ?? []) as unknown as Row[]).filter((m) => !m.expires_at || m.expires_at >= today)

  for (const m of rows) {
    const tier = Array.isArray(m.membership_tiers) ? m.membership_tiers[0] : m.membership_tiers
    const grant = tier?.[col] ?? 0
    if (grant <= 0) continue

    const { count } = await db
      .from('session_credits')
      .select('id', { count: 'exact', head: true })
      .eq('member_id', member.id)
      .eq('session_type', creditType)
      .eq('source', 'allowance')
      .eq('grant_key', m.id)
    const have = count ?? 0
    const missing = grant - have
    if (missing > 0) {
      await db.from('session_credits').insert(
        Array.from({ length: missing }, () => ({
          member_id: member.id,
          session_type: creditType,
          status: 'available',
          source: 'allowance',
          grant_key: m.id,
        })),
      )
    }
  }
}

/** A member's balance for one credit type (syncs the annual allowance first). */
export async function getCredits(member: CommunityMember, creditType: CreditType): Promise<CreditBalance> {
  await syncAllowance(member, creditType)
  const db = supabaseServer()
  const [{ count: avail }, { count: used }] = await Promise.all([
    db.from('session_credits').select('id', { count: 'exact', head: true })
      .eq('member_id', member.id).eq('session_type', creditType).eq('status', 'available'),
    db.from('session_credits').select('id', { count: 'exact', head: true })
      .eq('member_id', member.id).eq('session_type', creditType).eq('status', 'consumed'),
  ])
  const remaining = avail ?? 0
  const usedN = used ?? 0
  return { remaining, used: usedN, total: remaining + usedN }
}

/**
 * Consume the oldest available credit of `creditType` (FIFO) and tie it to the
 * container it was spent on. Returns false if the member has no credit left.
 * `containerId` is a mentoring_cohorts row id (cohort or workshop).
 */
export async function consumeOldestCredit(
  memberId: string,
  creditType: CreditType,
  containerId: string,
): Promise<boolean> {
  const db = supabaseServer()
  const { data: credit } = await db
    .from('session_credits')
    .select('id')
    .eq('member_id', memberId)
    .eq('session_type', creditType)
    .eq('status', 'available')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!credit) return false

  await db
    .from('session_credits')
    .update({ status: 'consumed', consumed_at: new Date().toISOString(), consumed_cohort_id: containerId })
    .eq('id', credit.id)
  return true
}

/**
 * Add `quantity` available credits of `creditType` to a member's wallet. When a
 * `grantKey` is supplied the insert is idempotent — only the missing delta vs.
 * existing rows for (member, type, source, grantKey) is inserted, so re-fired
 * rules and Stripe retries never double-credit. Without a grantKey it inserts the
 * full quantity (top-up/purchase paths, where idempotency is keyed on the Stripe
 * session at the call site). Returns how many rows were inserted.
 */
export async function grantCredits(
  memberId: string,
  creditType: CreditType,
  quantity: number,
  opts: { source: CreditSource; grantKey?: string | null; stripeSessionId?: string | null },
): Promise<number> {
  const db = supabaseServer()
  const qty = Math.max(0, Math.floor(quantity))
  if (qty <= 0) return 0

  if (opts.grantKey) {
    const { count } = await db
      .from('session_credits')
      .select('id', { count: 'exact', head: true })
      .eq('member_id', memberId)
      .eq('session_type', creditType)
      .eq('source', opts.source)
      .eq('grant_key', opts.grantKey)
    const have = count ?? 0
    const missing = qty - have
    if (missing <= 0) return 0
    await db.from('session_credits').insert(
      Array.from({ length: missing }, () => ({
        member_id: memberId,
        session_type: creditType,
        status: 'available',
        source: opts.source,
        grant_key: opts.grantKey,
        stripe_session_id: opts.stripeSessionId ?? null,
      })),
    )
    return missing
  }

  await db.from('session_credits').insert(
    Array.from({ length: qty }, () => ({
      member_id: memberId,
      session_type: creditType,
      status: 'available',
      source: opts.source,
      stripe_session_id: opts.stripeSessionId ?? null,
    })),
  )
  return qty
}
