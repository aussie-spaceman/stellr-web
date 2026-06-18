// Background-check provider abstraction (PRD §13).
//
// Every call site (the admin "order" route and the inbound webhook) depends only
// on the BackgroundProvider interface, so switching vendors is a one-line change
// in getBackgroundProvider() plus an env var — we've already moved Certn → Checkr
// once. The provider owns all vendor specifics: the order flow, the webhook
// signature scheme, and mapping the vendor's result vocabulary onto our domain.
//
// Our domain status (stored on member_background_checks.status) is vendor-neutral:
//   invited      — candidate invited / awaiting their submission
//   in_progress  — submitted, vendor processing
//   passed       — complete, cleared (no issues)
//   referred     — complete, flagged for human review
// (cancelled / error are set by our own code, not the provider.)

export type MappedStatus = 'invited' | 'in_progress' | 'passed' | 'referred'

export interface BackgroundOrderInput {
  firstName: string
  lastName: string
  email: string
  /** US state the person works in (drives Checkr work_locations/compliance). */
  state?: string | null
}

export interface BackgroundOrder {
  /** Vendor references persisted on our row (generic across providers). */
  candidateRef: string | null
  invitationRef: string | null
  reportRef: string | null
  /** Hosted apply/consent page the candidate completes (Checkr invitation_url). */
  invitationUrl: string | null
  /** Raw vendor status at order time, for the audit record. */
  rawStatus: string
}

export interface BackgroundWebhookResult {
  /** How to reconcile to our row — match on whichever refs are present. */
  candidateRef: string | null
  invitationRef: string | null
  reportRef: string | null
  /** Mapped domain status, or null to ignore this event. */
  status: MappedStatus | null
  /** Raw vendor result label (e.g. Checkr 'clear' / 'consider'). */
  result: string | null
}

export interface BackgroundProvider {
  readonly name: string
  /** Whether the provider has the credentials it needs to place orders. */
  configured(): boolean
  /** Place an order via the hosted-invite flow; the vendor emails the candidate. */
  order(input: BackgroundOrderInput): Promise<BackgroundOrder>
  /** Verify an inbound webhook's signature against the raw body + headers. */
  verifyWebhook(rawBody: string, headers: Headers): boolean
  /** Parse a webhook body into our reconciliation shape, or null to ignore. */
  parseWebhook(rawBody: string): BackgroundWebhookResult | null
}
