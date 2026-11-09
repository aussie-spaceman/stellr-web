// Tenant event mail (S5 B14): who a tenant's event email is from, whether it may
// go out at all, and the confirmation helper A7 sends registrations through.
//
// Off unless TENANT_EVENT_MAIL_ENABLED=true. With it off, no tenant event mail is
// sent by anything in lib/event-emails: the crons hold a tenant's rows and leave
// them for a later run, and sendEventEmail and sendCatchUp refuse a tenant row
// that comes without a tenant sender. Stellr's event mail never reaches this
// module, so its sender, budget and timing are unchanged whatever the flag says.
//
// The email share (owner decision, 9 Nov 2026): ONE SHARED POOL until the move to
// SES. A tenant's mail goes through sendEmail() like Stellr's, so lib/email.ts
// counts every tenant send on the same daily counter (lib/email-budget.ts), under
// the same rules, with no per-tenant allowance: bulk event blasts stop at the
// same marketing cap, and transactional mail is never refused by the counter.
//
// Transactional only (the plan's CAN-SPAM / Spam Act row): a tenant event sends
// mail about that event to the people on it, and nothing else. Nothing here
// sends from MARKETING_FROM, and no campaign or drip path calls in. Event blasts
// keep the 'marketing' EmailKind that Stellr's carry: that is the budget's bulk
// class, which also skips an unsubscribed address, not a legal label.
//
// Sender (the plan's email architecture): "<Tenant> via Stellr", from the
// platform's verified sending domain, with the tenant's own Reply-To. Resend Free
// allows one verified domain, so the address stays on it. The tenant's Reply-To
// is read from tenants.branding.reply_to until S10 gives it a column; a tenant
// with no valid Reply-To gets no sender, and its mail is refused rather than sent
// with replies going to Stellr's inbox.

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendEmail } from '@/lib/email'
import { STELLR_TENANT_ID } from '@/lib/tenancy/constants'

export const TENANT_EVENT_MAIL_FLAG = 'TENANT_EVENT_MAIL_ENABLED'

/** The platform's sending address for tenant mail: the verified domain's no-reply mailbox. */
export const TENANT_EVENT_FROM_ADDRESS = 'no-reply@mail.stellreducation.org'

/** Longest tenant display name kept in a From header, before " via Stellr". */
const MAX_SENDER_NAME = 64

/** Read at call time, so a flip needs a redeploy only, not a code change. */
export function tenantEventMailEnabled(): boolean {
  return process.env[TENANT_EVENT_MAIL_FLAG] === 'true'
}

/** Is this row's tenant someone other than Stellr? NULL and a missing column both mean Stellr. */
export function isTenantRow(tenantId: string | null | undefined): tenantId is string {
  return typeof tenantId === 'string' && tenantId !== STELLR_TENANT_ID
}

export interface EventSender {
  from: string
  replyTo: string
}

export interface TenantForSender {
  display_name: string | null
  branding: unknown
}

const EMAIL_RE = /^[^\s@<>",;:()[\]\\]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/

/** A display name safe inside a quoted From header: no quotes, angle brackets, backslashes or line breaks. */
export function senderName(displayName: string): string {
  const cleaned = displayName.replace(/[\u0000-\u001f\u007f"<>\\]/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned.length > MAX_SENDER_NAME ? cleaned.slice(0, MAX_SENDER_NAME).trimEnd() : cleaned
}

/**
 * "<Tenant> via Stellr" <no-reply@…>, replies to the tenant. Null when either
 * half is missing: a tenant's mail is never sent as Stellr or with replies to
 * Stellr's inbox.
 */
export function tenantEventSender(tenant: TenantForSender): EventSender | null {
  const name = senderName(tenant.display_name ?? '')
  const branding = tenant.branding && typeof tenant.branding === 'object' ? (tenant.branding as Record<string, unknown>) : {}
  const replyTo = typeof branding.reply_to === 'string' ? branding.reply_to.trim() : ''
  if (!name || !EMAIL_RE.test(replyTo) || replyTo.length > 254) return null
  return { from: `"${name} via Stellr" <${TENANT_EVENT_FROM_ADDRESS}>`, replyTo }
}

/**
 * The sender for one tenant's event mail, or null when that mail may not go
 * out: the flag is off, the tenant is Stellr (whose mail keeps its own sender),
 * the tenant cannot be read, or it has no usable sender. Never throws.
 */
export async function loadTenantSender(db: SupabaseClient, tenantId: string): Promise<EventSender | null> {
  if (!tenantEventMailEnabled() || !isTenantRow(tenantId)) return null
  try {
    const { data, error } = await db.from('tenants').select('display_name, branding').eq('id', tenantId).maybeSingle()
    if (error) throw new Error(error.message)
    return data ? tenantEventSender(data as TenantForSender) : null
  } catch (err) {
    console.error(`[tenant-mail] sender read failed for tenant ${tenantId}:`, err instanceof Error ? err.message : err)
    return null
  }
}

export type TenantConfirmationOutcome =
  | { ok: true; id: string | null; suppressed?: true }
  | { ok: false; reason: 'disabled' | 'stellr' | 'no_sender' | 'send_failed'; error?: string }

/**
 * A tenant registration's confirmation (A7: "Tenant confirmations are email-only,
 * through B14's tenant share"). Email only: no in-app notice, no HubSpot, no
 * marketing list. Transactional, so the daily counter never refuses it, and it
 * is counted on the shared pool like every other send. The caller renders the
 * content; this decides the sender and whether it may go at all.
 *
 * Refuses, without sending, when the flag is off, for Stellr (its confirmations
 * keep their own templates and sender), or when the tenant has no sender. Never
 * throws: a confirmation is sent after the registration is saved, and its
 * failure must not undo that.
 *
 * The caller's contract, because registration is open and the counter never
 * refuses transactional mail: `to` is the address on the registration just
 * saved, never one read straight from the request; the content is a fixed
 * template, not HTML the tenant or the request supplied; and the call sits
 * behind the rate limiter (lib/rate-limit.ts), per IP and per address. Nothing
 * calls this yet; A7 wires it in on those terms.
 */
export async function sendTenantConfirmation(
  db: SupabaseClient,
  input: { tenantId: string; to: string; subject: string; html: string; text: string },
): Promise<TenantConfirmationOutcome> {
  if (!tenantEventMailEnabled()) return { ok: false, reason: 'disabled' }
  if (!isTenantRow(input.tenantId)) return { ok: false, reason: 'stellr' }
  const sender = await loadTenantSender(db, input.tenantId)
  if (!sender) return { ok: false, reason: 'no_sender' }
  try {
    const sent = await sendEmail({
      to: input.to,
      from: sender.from,
      replyTo: sender.replyTo,
      subject: input.subject,
      html: input.html,
      text: input.text,
      kind: 'transactional',
    })
    return sent.suppressed ? { ok: true, id: null, suppressed: true } : { ok: true, id: sent.id }
  } catch (err) {
    console.error(`[tenant-mail] confirmation for tenant ${input.tenantId} failed:`, err instanceof Error ? err.message : err)
    return { ok: false, reason: 'send_failed', error: err instanceof Error ? err.message : String(err) }
  }
}
