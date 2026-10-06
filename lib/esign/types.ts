import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AdultAgreementParams,
  EnvelopeFormField,
  EnvelopeParams,
  EnvelopeRecipient,
  MentorAgreementParams,
  RecipientCorrection,
} from '@/lib/docusign'

export type { RecipientCorrection }

// The seam between "an agreement has to be signed" and whichever engine signs
// it. Everything outside lib/esign/providers/ talks to a signing engine through
// this interface, so DocuSign can run beside the in-app engine for the rest of
// its contract and then be removed without touching business logic.
// Plan: docs/PLAN-esign-2026-10-02.md.

/** Stored on agreements.provider. */
export type ProviderId = 'docusign' | 'native'

/**
 * The membership agreement, for people who join without attending an event.
 * An adult signs it themselves; for an under-18 a parent or guardian signs
 * first, then the member.
 */
export interface MembershipAgreementParams {
  memberId: string
  firstName: string
  lastName: string
  email: string
  phone?: string
  dateOfBirth?: string
  /** A Minor's grade, for the Student / Minor agreement they sign. */
  grade?: string
  guardianName?: string
  guardianEmail?: string
  guardianPhone?: string
  relationship?: string
}

/**
 * Who the member is behind each request, when known, so a signer with an
 * account can sign from it rather than waiting for an email.
 */
export interface SignerAccounts {
  /** The participant's or member's own account (the student, the adult, the mentor). */
  memberId?: string | null
}

/** One agreement to issue, with the fields its template is pre-filled from. */
export type CreateAgreementRequest =
  | { type: 'minor'; params: EnvelopeParams; accounts?: SignerAccounts }
  | { type: 'adult'; params: AdultAgreementParams; accounts?: SignerAccounts }
  | { type: 'mentor' | 'volunteer'; params: MentorAgreementParams; accounts?: SignerAccounts }
  | { type: 'membership'; params: MembershipAgreementParams; accounts?: SignerAccounts }

export interface CreatedAgreement {
  provider: ProviderId
  /** The engine's own id for the agreement: agreements.envelope_id. */
  externalId: string
  signerCount: number
  /** Extra columns for the agreements row (the native engine's template and prefill). */
  rowFields?: Record<string, unknown>
  /**
   * Runs once the agreements row exists: the native engine creates its
   * signer rows, records the issue in the audit trail and queues the emails.
   * Returns the first signer's link when they can sign straight away.
   */
  afterRecord?: (db: SupabaseClient, envelopeRowId: string) => Promise<{ signNowUrl?: string | null } | void>
}

export interface SignedDocument {
  pdf: ArrayBuffer
  /** The engine's audit record of the signing, when asked for and available. */
  certificate: ArrayBuffer | null
}

export interface EsignContext {
  db: SupabaseClient
}

export interface EsignProvider {
  readonly id: ProviderId
  /**
   * True when the engine emails signers itself (DocuSign). When false, the app
   * owns every signing email, so there is no second message to wait for.
   */
  readonly sendsOwnEmails: boolean
  create(ctx: EsignContext, req: CreateAgreementRequest): Promise<CreatedAgreement>
  /** The signer list, in the status vocabulary of agreement_recipients. */
  getRecipients(ctx: EsignContext, externalId: string): Promise<EnvelopeRecipient[]>
  /** Re-notifies whoever has not signed. Returns how many were notified. */
  remind(ctx: EsignContext, externalId: string): Promise<number>
  /** Cancels an agreement nobody has finished signing. */
  void(ctx: EsignContext, externalId: string, reason?: string): Promise<void>
  /**
   * Changes one unfinished signer's email (and name) on the same agreement,
   * keeping every signature already given, and sends the new address its
   * signing email when it is that signer's turn. Returns the signer as it now
   * stands. Throws CorrectionRefusedError when the change is not allowed.
   */
  correctRecipient(ctx: EsignContext, externalId: string, correction: RecipientCorrection): Promise<EnvelopeRecipient>
  /** Every field value the signers entered, keyed by field name. */
  getFieldValues(ctx: EsignContext, externalId: string): Promise<EnvelopeFormField[]>
  getSignedDocument(
    ctx: EsignContext,
    externalId: string,
    opts?: { certificate?: boolean },
  ): Promise<SignedDocument>
  /** The engine's own count of agreements issued this period, if it has a cap. */
  getUsage?(ctx: EsignContext): Promise<ProviderUsage>
}

export interface ProviderUsage {
  sent: number
  /** Null when the engine reports no limit. */
  allowed: number | null
  periodEnd: string | null
}

/**
 * The engine refused to issue because its allowance for the period is spent.
 * Distinct from every other failure: the right response is to issue the same
 * agreement on the other engine, not to alert and give up.
 */
export class AllowanceExhaustedError extends Error {
  readonly provider: ProviderId
  constructor(provider: ProviderId, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'AllowanceExhaustedError'
    this.provider = provider
  }
}

/**
 * The engine is down or not answering: a 5xx, a rate limit, a network failure
 * or a timeout. Not our request's fault, and nothing to remember: the next
 * agreement tries the engine again. A 4xx (bad request, wrong credentials) is
 * never this, so a configuration mistake still fails loudly.
 */
export class ProviderUnavailableError extends Error {
  readonly provider: ProviderId
  constructor(provider: ProviderId, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ProviderUnavailableError'
    this.provider = provider
  }
}

/**
 * A signer correction the engine will not make, for a reason the admin can act
 * on: the agreement or the signer is finished, the agreement is locked, or the
 * engine rejected the new address. Every other failure stays a plain Error.
 */
export class CorrectionRefusedError extends Error {
  readonly provider: ProviderId
  /** A stable reason code (DocuSign's errorCode, or the engine's own). */
  readonly code: string
  constructor(provider: ProviderId, message: string, code: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'CorrectionRefusedError'
    this.provider = provider
    this.code = code
  }
}
