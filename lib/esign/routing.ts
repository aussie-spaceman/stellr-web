import type { SupabaseClient } from '@supabase/supabase-js'
import type { CreateAgreementRequest, ProviderId } from '@/lib/esign/types'

// Which signing engine takes a new agreement.
//
// The rule the owner chose: DocuSign until its monthly envelope allowance is
// spent, then the in-app engine until the allowance resets. Two things make
// that harder than a counter:
//
//  • Envelopes sent from DocuSign's own web UI never touch this database, so a
//    count of our rows undercounts. DocuSign's refusal
//    (AllowanceExhaustedError) is therefore the authoritative signal, and the
//    counts below only try to get there first.
//  • A group registration issues one agreement per student, back to back. Once
//    DocuSign has refused one, the rest must not each ask again: the refusal
//    is remembered in esign_provider_state.exhausted_until.
//
// decideProvider is pure, so every branch is unit-tested without a database.

export type ProviderMode = 'auto' | 'docusign_only' | 'overflow_only'

export interface ProviderState {
  mode: ProviderMode
  monthlyCap: number
  reserve: number
  overflowTypes: string[]
  overflowAllowlist: string[]
  exhaustedUntil: string | null
  accountSent: number | null
  accountAllowed: number | null
  accountPeriodEnd: string | null
  accountSyncedAt: string | null
}

/** Used when the state row is missing or unreadable: never leave DocuSign. */
export const DEFAULT_PROVIDER_STATE: ProviderState = {
  mode: 'docusign_only',
  monthlyCap: 40,
  reserve: 2,
  overflowTypes: ['minor', 'adult', 'mentor', 'volunteer', 'membership'],
  overflowAllowlist: [],
  exhaustedUntil: null,
  accountSent: null,
  accountAllowed: null,
  accountPeriodEnd: null,
  accountSyncedAt: null,
}

const STATE_COLUMNS =
  'mode, monthly_cap, reserve, overflow_types, overflow_allowlist, exhausted_until, ' +
  'account_sent, account_allowed, account_period_end, account_synced_at'

export async function loadProviderState(db: SupabaseClient): Promise<ProviderState> {
  try {
    const { data, error } = await db
      .from('esign_provider_state')
      .select(STATE_COLUMNS)
      .eq('id', true)
      .maybeSingle()
    if (error || !data) return DEFAULT_PROVIDER_STATE
    const row = data as unknown as Record<string, unknown>
    return {
      mode:              (row.mode as ProviderMode) ?? DEFAULT_PROVIDER_STATE.mode,
      monthlyCap:        (row.monthly_cap as number) ?? DEFAULT_PROVIDER_STATE.monthlyCap,
      reserve:           (row.reserve as number) ?? DEFAULT_PROVIDER_STATE.reserve,
      overflowTypes:     (row.overflow_types as string[]) ?? DEFAULT_PROVIDER_STATE.overflowTypes,
      overflowAllowlist: (row.overflow_allowlist as string[]) ?? [],
      exhaustedUntil:    (row.exhausted_until as string | null) ?? null,
      accountSent:       (row.account_sent as number | null) ?? null,
      accountAllowed:    (row.account_allowed as number | null) ?? null,
      accountPeriodEnd:  (row.account_period_end as string | null) ?? null,
      accountSyncedAt:   (row.account_synced_at as string | null) ?? null,
    }
  } catch (err) {
    // A routing-state read must never stop paperwork going out.
    console.error('[esign] provider state read failed, using defaults:', err)
    return DEFAULT_PROVIDER_STATE
  }
}

/** Addresses that will be asked to sign, for the allowlist canary. */
export function signerEmails(req: CreateAgreementRequest): string[] {
  const emails = req.type === 'minor'
    ? [req.params.guardianEmail, req.params.minorEmail]
    : req.type === 'membership'
      ? [req.params.email, req.params.guardianEmail ?? '']
      : [req.params.email]
  return emails.filter(Boolean).map((e) => e.trim().toLowerCase())
}

export interface RoutingFacts {
  /** The agreement type; 'membership' is only ever the native engine's. */
  type: string
  signerEmails: string[]
  /** Whether the in-app engine is built and configured in this deployment. */
  nativeAvailable: boolean
  /** DocuSign envelopes this app has issued since the allowance period began. */
  issuedThisPeriod: number
  /** DocuSign envelopes this app has issued since the account figures were read. */
  issuedSinceSync: number
  now: Date
}

export interface RoutingDecision {
  provider: ProviderId
  reason:
    | 'membership'
    | 'native_unavailable'
    | 'allowlist'
    | 'mode_docusign_only'
    | 'mode_overflow_only'
    | 'type_not_enabled'
    | 'exhausted'
    | 'near_cap'
    | 'within_allowance'
}

/**
 * Envelopes DocuSign will accept this period before we stop asking: the plan's
 * cap, or the allowance DocuSign itself reports if that is lower, less the
 * reserve.
 */
export function effectiveCap(state: ProviderState): number {
  const cap = state.accountAllowed === null
    ? state.monthlyCap
    : Math.min(state.monthlyCap, state.accountAllowed)
  return Math.max(0, cap - state.reserve)
}

/** Our best estimate of envelopes used this period. Errs high. */
export function estimatedUsage(state: ProviderState, facts: RoutingFacts): number {
  // DocuSign's own figure counts envelopes sent from its web UI, which ours
  // cannot. It is only meaningful while the period it describes is current.
  const accountCurrent =
    state.accountSent !== null &&
    state.accountPeriodEnd !== null &&
    new Date(state.accountPeriodEnd) > facts.now
  const fromAccount = accountCurrent ? (state.accountSent as number) + facts.issuedSinceSync : 0
  return Math.max(fromAccount, facts.issuedThisPeriod)
}

export function decideProvider(state: ProviderState, facts: RoutingFacts): RoutingDecision {
  // The membership agreement never spends a DocuSign envelope. The caller turns
  // "native, but native is unavailable" into an error rather than falling back.
  if (facts.type === 'membership') return { provider: 'native', reason: 'membership' }

  if (!facts.nativeAvailable) return { provider: 'docusign', reason: 'native_unavailable' }

  const allow = new Set(state.overflowAllowlist.map((e) => e.trim().toLowerCase()))
  if (facts.signerEmails.some((e) => allow.has(e))) return { provider: 'native', reason: 'allowlist' }

  if (state.mode === 'docusign_only') return { provider: 'docusign', reason: 'mode_docusign_only' }

  if (!state.overflowTypes.includes(facts.type)) return { provider: 'docusign', reason: 'type_not_enabled' }

  if (state.mode === 'overflow_only') return { provider: 'native', reason: 'mode_overflow_only' }

  if (state.exhaustedUntil && new Date(state.exhaustedUntil) > facts.now) {
    return { provider: 'native', reason: 'exhausted' }
  }

  if (estimatedUsage(state, facts) >= effectiveCap(state)) return { provider: 'native', reason: 'near_cap' }

  return { provider: 'docusign', reason: 'within_allowance' }
}

// ── Allowance period ─────────────────────────────────────────────────────────

/**
 * When the current allowance period began. DocuSign reports the period's end;
 * the start is one month before it. With no report, or one for a period that
 * has already ended, fall back to the calendar month (UTC).
 */
export function periodStart(state: ProviderState, now: Date): Date {
  if (state.accountPeriodEnd) {
    const end = new Date(state.accountPeriodEnd)
    if (end > now) {
      const start = new Date(end)
      start.setUTCMonth(start.getUTCMonth() - 1)
      return start
    }
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

const HOUR_MS = 60 * 60 * 1000
/** How soon after an expected reset a refusal means "the reset date was wrong". */
const RESET_GRACE_MS = 48 * HOUR_MS
/** How long to stay off DocuSign before asking again in that case. */
const RESET_BACKOFF_MS = 6 * HOUR_MS

/**
 * How long to stay off DocuSign after it has refused for want of allowance.
 *
 * Normally until the period ends. But if the refusal comes shortly after the
 * date we believed the allowance had reset, our idea of the reset date is
 * wrong, and blocking DocuSign for a whole further month on that belief would
 * waste the allowance. Back off a few hours and ask again instead.
 */
export function exhaustedUntil(state: ProviderState, now: Date): Date {
  const believedResets = [state.exhaustedUntil, state.accountPeriodEnd]
    .filter((v): v is string => !!v)
    .map((v) => new Date(v))

  const justReset = believedResets.some(
    (reset) => reset <= now && now.getTime() - reset.getTime() < RESET_GRACE_MS,
  )
  if (justReset) return new Date(now.getTime() + RESET_BACKOFF_MS)

  const upcoming = believedResets.filter((reset) => reset > now).sort((a, b) => a.getTime() - b.getTime())
  if (upcoming.length) return upcoming[0]

  // No report from DocuSign to go on: assume the calendar month.
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
}

/**
 * Records that DocuSign has no allowance left. Returns whether this call was
 * the one that set the flag, so the caller alerts admins once and not once per
 * student in a group.
 */
export async function markDocusignExhausted(
  db: SupabaseClient,
  state: ProviderState,
  reason: string,
  now = new Date(),
): Promise<{ until: Date; firstTransition: boolean }> {
  const until = exhaustedUntil(state, now)
  try {
    const { data, error } = await db
      .from('esign_provider_state')
      .update({
        exhausted_until:  until.toISOString(),
        exhausted_reason: reason.slice(0, 500),
        updated_by:       'system',
        updated_at:       now.toISOString(),
      })
      .eq('id', true)
      // Only when the flag is not already set for a future time: the first
      // refusal wins and the rest of the batch leaves it alone.
      .or(`exhausted_until.is.null,exhausted_until.lte.${now.toISOString()}`)
      .select('id')
    if (error) throw new Error(error.message)
    return { until, firstTransition: (data ?? []).length > 0 }
  } catch (err) {
    console.error('[esign] could not record DocuSign allowance exhaustion:', err)
    return { until, firstTransition: false }
  }
}

/**
 * Stores what DocuSign reports about its own allowance: envelopes sent this
 * period (including any sent from its web UI) and when the period ends. Run
 * daily, and on demand from the admin card.
 */
export async function syncDocusignUsage(
  db: SupabaseClient,
  getUsage: () => Promise<{ sent: number; allowed: number | null; periodEnd: string | null }>,
  now = new Date(),
): Promise<{ sent: number; allowed: number | null; periodEnd: string | null }> {
  const usage = await getUsage()
  const { error } = await db
    .from('esign_provider_state')
    .update({
      account_sent:       usage.sent,
      account_allowed:    usage.allowed,
      account_period_end: usage.periodEnd,
      account_synced_at:  now.toISOString(),
      updated_at:         now.toISOString(),
    })
    .eq('id', true)
  if (error) throw new Error(`Recording DocuSign usage failed: ${error.message}`)
  return usage
}

/** DocuSign envelopes this app has issued since `since`. Coverage rows are not envelopes. */
export async function countDocusignIssuedSince(db: SupabaseClient, since: Date): Promise<number> {
  try {
    const { count, error } = await db
      .from('docusign_envelopes')
      .select('id', { count: 'exact', head: true })
      .eq('provider', 'docusign')
      .is('reused_from', null)
      .gte('sent_at', since.toISOString())
    if (error) throw new Error(error.message)
    return count ?? 0
  } catch (err) {
    // Unknown usage must not block DocuSign; its own refusal still protects us.
    console.error('[esign] envelope count failed, assuming 0:', err)
    return 0
  }
}
