import type { SupabaseClient } from '@supabase/supabase-js'
import { getProvider, hasProvider } from '@/lib/esign'
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
  type CreateAgreementRequest,
  type CreatedAgreement,
} from '@/lib/esign/types'
import { notifyCommunityAdmins } from '@/lib/notify'

// Issues one agreement on whichever engine should take it. The single place
// the choice is made, so no caller knows or cares which engine that is.

export async function issueAgreement(
  db: SupabaseClient,
  req: CreateAgreementRequest,
): Promise<CreatedAgreement> {
  const ctx = { db }

  // Until the in-app engine is registered there is nothing to route between:
  // every agreement is DocuSign's and no routing state is read, so this path
  // behaves exactly as it did before the seam existed.
  if (!hasProvider('native')) return getProvider('docusign').create(ctx, req)

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
    nativeAvailable: true,
    issuedThisPeriod,
    issuedSinceSync,
    now,
  })

  if (decision.provider === 'native') return getProvider('native').create(ctx, req)

  try {
    return await getProvider('docusign').create(ctx, req)
  } catch (err) {
    if (!(err instanceof AllowanceExhaustedError)) throw err

    // DocuSign's refusal is the authoritative "allowance spent" signal: our
    // counts cannot see envelopes sent from its web UI. Remember it, so the
    // rest of a group registration does not ask DocuSign again.
    const { until, firstTransition } = await markDocusignExhausted(db, state, err.message, now)

    const mayOverflow = state.mode !== 'docusign_only' && state.overflowTypes.includes(req.type)
    if (firstTransition) await alertAllowanceExhausted(until, mayOverflow)
    if (!mayOverflow) throw err

    return getProvider('native').create(ctx, req)
  }
}

async function alertAllowanceExhausted(until: Date, overflowing: boolean): Promise<void> {
  const resets = until.toISOString().slice(0, 10)
  const consequence = overflowing
    ? `New agreements are being issued by Stellr's own signing system until ${resets}. Nothing needs doing.`
    : `New agreements will fail until ${resets}, because the in-app signing system is switched off for this agreement type. Switch it on under Admin → Consent forms, or re-issue after that date.`
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
