import type { SupabaseClient } from '@supabase/supabase-js'
import { canIssue, getProvider } from '@/lib/esign'
import {
  countDocusignIssuedSince,
  decideProvider,
  loadProviderState,
  markDocusignExhausted,
  periodStart,
  signerEmails,
} from '@/lib/esign/routing'
import {
  AllowanceExhaustedError,
  ProviderUnavailableError,
  type CreateAgreementRequest,
  type CreatedAgreement,
} from '@/lib/esign/types'
import { notifyCommunityAdmins } from '@/lib/notify'
import { isMinorOn } from '@/lib/age'

// Issues one agreement on whichever engine should take it. The single place
// the choice is made, so no caller knows or cares which engine that is.

export async function issueAgreement(
  db: SupabaseClient,
  req: CreateAgreementRequest,
): Promise<CreatedAgreement> {
  const ctx = { db }
  const nativeAvailable = canIssue('native')

  // The membership agreement never spends a DocuSign envelope.
  if (req.type === 'membership') {
    if (!nativeAvailable) throw new Error('Stellr signing is not configured, so the membership agreement cannot be issued')
    return getProvider('native').create(ctx, req)
  }

  // A Mentor under the age of majority needs a parent's signature too (V2.3
  // §3A). Stellr signing adds that signer; the DocuSign mentor template has no
  // parent role, so this agreement goes to Stellr signing or nowhere.
  if (needsParentCoSign(req)) {
    if (!nativeAvailable) {
      throw new Error('A Mentor under the age of majority needs a parent to co-sign, which only Stellr signing can issue, and it is not configured')
    }
    return getProvider('native').create(ctx, req)
  }

  // Until Stellr signing is configured there is nothing to route between:
  // every agreement is DocuSign's and no routing state is read, so this path
  // behaves exactly as it did before the seam existed.
  if (!nativeAvailable) return getProvider('docusign').create(ctx, req)

  const now = new Date()
  const state = await loadProviderState(db)

  // The counts only matter when the decision can turn on usage.
  const usageMatters = state.mode === 'auto'
  const [issuedThisPeriod, issuedSinceSync] = usageMatters
    ? await Promise.all([
        countDocusignIssuedSince(db, periodStart(state, now)),
        state.accountSyncedAt
          ? countDocusignIssuedSince(db, new Date(state.accountSyncedAt))
          : Promise.resolve(0),
      ])
    : [0, 0]

  const decision = decideProvider(state, {
    type: req.type,
    signerEmails: signerEmails(req),
    nativeAvailable,
    issuedThisPeriod,
    issuedSinceSync,
    now,
  })

  if (decision.provider === 'native') return getProvider('native').create(ctx, req)

  const mayOverflow = state.mode !== 'docusign_only' && state.overflowTypes.includes(req.type)
  try {
    return await getProvider('docusign').create(ctx, req)
  } catch (err) {
    // DocuSign down or not answering: this agreement goes to Stellr signing,
    // and the next one tries DocuSign again. Nothing is remembered.
    if (err instanceof ProviderUnavailableError) {
      if (!mayOverflow) throw err
      console.warn(`[esign] DocuSign unavailable, issuing a ${req.type} agreement on Stellr signing:`, err.message.slice(0, 200))
      await alertOutage(err.message, now)
      return getProvider('native').create(ctx, req)
    }
    if (!(err instanceof AllowanceExhaustedError)) throw err

    // DocuSign's refusal is the authoritative "allowance spent" signal: our
    // counts cannot see envelopes sent from its web UI. Remember it, so the
    // rest of a group registration does not ask DocuSign again.
    const { until, firstTransition } = await markDocusignExhausted(db, state, err.message, now)

    if (firstTransition) await alertAllowanceExhausted(until, mayOverflow)
    if (!mayOverflow) throw err

    return getProvider('native').create(ctx, req)
  }
}

function needsParentCoSign(req: CreateAgreementRequest): boolean {
  if (req.type !== 'mentor' && req.type !== 'volunteer') return false
  return isMinorOn(req.params.dateOfBirth ?? null, undefined, req.params.state ?? null)
}

// One outage alert per server instance per hour, not one per agreement: a
// group registration during an outage would otherwise send thirty.
let lastOutageAlert = 0
const OUTAGE_ALERT_GAP_MS = 60 * 60_000

async function alertOutage(detail: string, now: Date): Promise<void> {
  if (now.getTime() - lastOutageAlert < OUTAGE_ALERT_GAP_MS) return
  lastOutageAlert = now.getTime()
  const body = 'DocuSign did not respond, so new agreements are being issued by Stellr signing until it does. Nothing needs doing; check status.docusign.com if it continues.'
  await notifyCommunityAdmins({
    type: 'action',
    body,
    email: { subject: 'DocuSign unavailable: agreements going to Stellr signing', html: `<p>${body}</p>`, text: `${body}\n\n${detail.slice(0, 300)}` },
  }).catch(() => {})
}

/** For tests: forget the last outage alert. */
export function __resetOutageAlert(): void {
  lastOutageAlert = 0
}

async function alertAllowanceExhausted(until: Date, overflowing: boolean): Promise<void> {
  const resets = until.toISOString().slice(0, 10)
  const consequence = overflowing
    ? `New agreements are being issued by Stellr signing until ${resets}. Nothing needs doing.`
    : `New agreements will fail until ${resets}, because Stellr signing is switched off for this agreement type. Switch it on under Admin → Consent forms, or re-issue after that date.`
  const body = `DocuSign's monthly envelope allowance is used up. ${consequence}`
  await notifyCommunityAdmins({
    type: 'action',
    body,
    email: {
      subject: 'DocuSign envelope allowance used up',
      html: `<p>${body}</p>`,
      text: body,
    },
  }).catch(() => {})
  // Swallowed: a failed admin notification must never stop the agreement
  // being issued on the other engine.
}
