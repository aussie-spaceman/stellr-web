// A tenant's signing invitation (S5 B14 follow-up), for the tenant
// guardian-consent slice to call.
//
// The signing engine already sends every invitation and reminder through
// lib/esign/outbox.ts, which gives another tenant's envelope that tenant's
// sender ("<Tenant> via Stellr", the tenant's Reply-To) and holds it when there
// is none, so creating a tenant's envelope through the native provider sends
// its invitations by itself where it can. This helper is the explicit, checked
// call on top: it says whether the invitation could go and why not, so the
// caller can show the organiser an answer instead of a silent hold.
//
// Off unless TENANT_EVENT_MAIL_ENABLED=true, like all tenant mail. Never throws.
//
// The caller's contract, as for sendTenantConfirmation: the addresses are the
// signers saved on the envelope, never an address from the request; the content
// is the engine's fixed signing template; and a route that calls this sits
// behind lib/rate-limit.ts per IP and per envelope or tenant. The shared daily
// counter never refuses transactional mail, so these rules are what keep one
// caller from spending the day's sends for everyone. The signing outbox's own
// daily allowance (ESIGN_DAILY_EMAIL_BUDGET) still applies: an invitation over
// it waits in the outbox and comes back as `deferred`.

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadRecipients } from '@/lib/esign/native/flow'
import { sendInvites, type SendResult } from '@/lib/esign/outbox'
import { isTenantRow, loadTenantSender, tenantEventMailEnabled, TENANT_SENDER_REQUIRED } from './tenant-mail'

export type TenantSigningInviteOutcome =
  | { ok: true; result: SendResult }
  | {
      ok: false
      reason: 'disabled' | 'stellr' | 'not_found' | 'not_out_for_signature' | 'no_sender' | 'failed'
      error?: string
    }

const LIVE = new Set(['sent', 'delivered'])

/** What a caller sees when something failed: fixed, so no database text reaches an organiser. */
export const TENANT_SIGNING_FAILED = 'The invitation could not be sent. Try again in a few minutes.'

/**
 * Emails the envelope's active signers whose invitation has not gone yet (for
 * a minor's consent, the guardian first), from the tenant's sender.
 *
 * Refuses, sending nothing, when the flag is off, for Stellr's tenant (its
 * envelopes keep Stellr's sender and need no helper), when the envelope is not
 * a native one or belongs to another tenant (both `not_found`, like a missing
 * id), when it is no longer out for signature,
 * and when the tenant has no usable sender (`error` carries the approved
 * TENANT_SENDER_REQUIRED text). Signers already invited are left alone, so a
 * repeat call sends nothing twice; to chase them, use remindEnvelopeRow.
 */
export async function sendTenantSigningInvitation(
  db: SupabaseClient,
  input: { tenantId: string; envelopeRowId: string },
): Promise<TenantSigningInviteOutcome> {
  if (!tenantEventMailEnabled()) return { ok: false, reason: 'disabled' }
  if (!isTenantRow(input.tenantId)) return { ok: false, reason: 'stellr' }
  try {
    const { data, error } = await db
      .from('agreements')
      .select('id, provider, status, tenant_id')
      .eq('id', input.envelopeRowId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    const env = data as { id: string; provider: string | null; status: string; tenant_id: string | null } | null
    // The envelope's own tenant decides, never the caller's word alone. Another
    // tenant's envelope, or Stellr's, answers exactly as a missing one does, so
    // the answer never says whether an id exists elsewhere.
    if (!env || env.provider !== 'native' || env.tenant_id !== input.tenantId) return { ok: false, reason: 'not_found' }
    if (!LIVE.has(env.status)) return { ok: false, reason: 'not_out_for_signature' }

    if (!(await loadTenantSender(db, input.tenantId))) {
      return { ok: false, reason: 'no_sender', error: TENANT_SENDER_REQUIRED }
    }

    const waiting = (await loadRecipients(db, env.id)).filter((r) => r.status === 'sent' && !r.invite_sent_at)
    if (!waiting.length) return { ok: true, result: { sent: 0, deferred: 0, failed: 0 } }
    const result = await sendInvites(db, waiting)
    // The sender was there a moment ago; the outbox read it again and found none.
    if (result.held) return { ok: false, reason: 'no_sender', error: TENANT_SENDER_REQUIRED }
    return { ok: true, result }
  } catch (err) {
    console.error(`[tenant-signing] invitation for envelope ${input.envelopeRowId} failed:`, err instanceof Error ? err.message : err)
    return { ok: false, reason: 'failed', error: TENANT_SIGNING_FAILED }
  }
}
