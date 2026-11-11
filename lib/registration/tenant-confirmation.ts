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

/**
 * The consent_* kinds are the guardian-consent flow's notices to a 14-17-year-old
 * registrant (S5 wave 6, lib/registration/tenant-guardian-consent.ts): waiting for
 * the guardian, registered once they signed, and cancelled after a decline or when
 * the window closed. They are the only mail a consent-pending participant gets.
 */
export type TenantConfirmationKind =
  | 'individual'
  | 'group'
  | 'group_join'
  | 'consent_pending'
  | 'consent_pending_unsent'
  | 'consent_signed'
  | 'consent_declined'
  | 'consent_expired'

export interface TenantConfirmationInput {
  tenantId: string
  /** The address on the registration or participant row just saved. */
  to: string
  firstName: string
  eventTitle: string
  kind: TenantConfirmationKind
}

/** The guardian-consent notices' wording. A proposal for the owner, like the rest of this template. */
function consentNotice(kind: TenantConfirmationKind, title: string): { subject: string; lead: string; next: string } | null {
  const contact = 'If you have questions, reply to this email to reach the event organiser.'
  switch (kind) {
    // The guardian's invitation was sent, or is queued to send: "will", not "have".
    case 'consent_pending':
      return {
        subject: `Waiting for your parent or guardian: ${title}`,
        lead: `Thanks for registering for ${title}. Because you're under 18, we'll email your parent or guardian a consent form to sign. Your place is confirmed once they sign.`,
        next: `If it isn't signed within 14 days, or before the event if that's sooner, the registration is cancelled. ${contact}`,
      }
    // The guardian's invitation could not be sent when the registration was saved.
    // Nothing tells the organiser yet, so the registrant is not told they will be in touch.
    case 'consent_pending_unsent':
      return {
        subject: `Waiting for your parent or guardian: ${title}`,
        lead: `Thanks for registering for ${title}. Because you're under 18, your parent or guardian needs to sign a consent form. We couldn't send it to them just now. Your place is confirmed once they sign.`,
        next: `If it isn't signed within 14 days, or before the event if that's sooner, the registration is cancelled. Please reply to this email to reach the event organiser about the consent form.`,
      }
    case 'consent_signed':
      return {
        subject: `Registered: ${title}`,
        lead: `Your parent or guardian signed the consent form, so you're registered for ${title}.`,
        next: 'The event organiser will be in touch with the details. If anything here looks wrong, reply to this email.',
      }
    case 'consent_declined':
      return {
        subject: `Registration cancelled: ${title}`,
        lead: `Your parent or guardian chose not to sign the consent form for ${title}, so your registration has been cancelled.`,
        next: contact,
      }
    case 'consent_expired':
      return {
        subject: `Registration cancelled: ${title}`,
        lead: `We didn't receive a signed consent form from your parent or guardian in time, so your registration for ${title} has been cancelled.`,
        next: contact,
      }
    default:
      return null
  }
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
  const consent = consentNotice(input.kind, title)
  const lead = consent
    ? consent.lead
    : input.kind === 'group'
      ? `Your group is registered for ${title}.`
      : input.kind === 'group_join'
        ? `You've joined your group for ${title}.`
        : `You're registered for ${title}.`
  const next = consent?.next ?? 'The event organiser will be in touch with the details. If anything here looks wrong, reply to this email.'
  const subject = (consent?.subject ?? `Registered: ${title}`).slice(0, 200)
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
