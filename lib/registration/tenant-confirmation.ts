import type { SupabaseClient } from '@supabase/supabase-js'
import { escapeHtml } from '@/lib/email-layout'
import { sendTenantConfirmation, type TenantConfirmationOutcome } from '@/lib/event-emails/tenant-mail'

// A tenant event's registration confirmation (S5 A7). Email only, through B14's
// tenant share (lib/event-emails/tenant-mail.ts), which picks the "<Tenant> via
// Stellr" sender and refuses while TENANT_EVENT_MAIL_ENABLED is off. Stellr's own
// confirmations never come here.
//
// On B14's terms: a fixed template, nothing the tenant or the request supplied as
// markup, and `to` is an address on the row just saved. The register routes that
// call this sit behind the rate limiter. The wording is a proposal for the owner.

export type TenantConfirmationKind = 'individual' | 'group' | 'group_join'

export interface TenantConfirmationInput {
  tenantId: string
  /** The address on the registration or participant row just saved. */
  to: string
  firstName: string
  eventTitle: string
  kind: TenantConfirmationKind
}

/** The fixed template. Every value from a row is escaped. */
export function tenantConfirmationContent(input: Pick<TenantConfirmationInput, 'firstName' | 'eventTitle' | 'kind'>): {
  subject: string
  html: string
  text: string
} {
  const title = input.eventTitle.trim() || 'your event'
  const first = input.firstName.trim()
  const greeting = first ? `Hi ${first},` : 'Hi,'
  const lead =
    input.kind === 'group'
      ? `Your group is registered for ${title}.`
      : input.kind === 'group_join'
        ? `You've joined your group for ${title}.`
        : `You're registered for ${title}.`
  const next = 'The event organiser will be in touch with the details. If anything here looks wrong, reply to this email.'
  const subject = `Registered: ${title}`.slice(0, 200)
  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>${escapeHtml(lead)}</p>`,
    `<p>${escapeHtml(next)}</p>`,
  ].join('\n')
  const text = [greeting, '', lead, '', next].join('\n')
  return { subject, html, text }
}

/** Send it. Never throws: the registration is saved whatever happens here. */
export async function sendTenantRegistrationConfirmation(
  db: SupabaseClient,
  input: TenantConfirmationInput,
): Promise<TenantConfirmationOutcome> {
  try {
    const content = tenantConfirmationContent(input)
    const outcome = await sendTenantConfirmation(db, { tenantId: input.tenantId, to: input.to, ...content })
    if (!outcome.ok && outcome.reason !== 'disabled') {
      console.error(`[register] tenant confirmation not sent: ${outcome.reason}`)
    }
    return outcome
  } catch (err) {
    console.error('[register] tenant confirmation failed:', err instanceof Error ? err.message : err)
    return { ok: false, reason: 'send_failed' }
  }
}
