import {
  DocusignApiError,
  createAdultAgreementEnvelope,
  createConsentEnvelope,
  createMentorAgreementEnvelope,
  createVolunteerAgreementEnvelope,
  getAccountUsage,
  getEnvelopeCertificate,
  getEnvelopeDocument,
  getEnvelopeFormData,
  getEnvelopeRecipients,
  resendEnvelope,
  voidEnvelope,
  type CreatedEnvelope,
} from '@/lib/docusign'
import {
  AllowanceExhaustedError,
  ProviderUnavailableError,
  type CreateAgreementRequest,
  type EsignProvider,
} from '@/lib/esign/types'

// DocuSign behind the provider interface. A thin wrapper: every call lands in
// lib/docusign.ts unchanged, which is also why the existing tests that mock
// that module keep exercising the same code paths.

/** DocuSign's error code for "this account has no envelopes left this period". */
const ALLOWANCE_ERROR_CODE = 'ENVELOPE_ALLOWANCE_EXCEEDED'

function isAllowanceError(err: unknown): boolean {
  if (err instanceof DocusignApiError && err.errorCode === ALLOWANCE_ERROR_CODE) return true
  // Belt and braces: the code also appears in the body text, which is all a
  // caller has if the response was not the JSON shape dsError expects.
  return err instanceof Error && err.message.includes(ALLOWANCE_ERROR_CODE)
}

/** DocuSign itself failing, as opposed to our request or our credentials. */
export function isOutage(err: unknown): boolean {
  if (err instanceof DocusignApiError) return err.status >= 500 || err.status === 429
  if (!(err instanceof Error)) return false
  // fetch() rejects with a TypeError when the network fails, and with a
  // TimeoutError/AbortError when AbortSignal.timeout fires.
  return err.name === 'TypeError' || err.name === 'TimeoutError' || err.name === 'AbortError'
}

function createEnvelope(req: CreateAgreementRequest): Promise<CreatedEnvelope> {
  switch (req.type) {
    case 'minor':     return createConsentEnvelope(req.params)
    case 'adult':     return createAdultAgreementEnvelope(req.params)
    case 'volunteer': return createVolunteerAgreementEnvelope(req.params)
    case 'mentor':    return createMentorAgreementEnvelope(req.params)
    case 'membership':
      // Never a DocuSign envelope (owner's decision, 2 Oct 2026); routing
      // sends it to Stellr signing before it can reach here.
      throw new Error('The membership agreement is not issued through DocuSign')
  }
}

export const docusignProvider: EsignProvider = {
  id: 'docusign',
  sendsOwnEmails: true,

  async create(_ctx, req) {
    try {
      const envelope = await createEnvelope(req)
      return { provider: 'docusign', externalId: envelope.envelopeId, signerCount: envelope.signerCount }
    } catch (err) {
      if (isAllowanceError(err)) {
        throw new AllowanceExhaustedError('docusign', (err as Error).message, { cause: err })
      }
      if (isOutage(err)) {
        throw new ProviderUnavailableError('docusign', (err as Error).message, { cause: err })
      }
      throw err
    }
  },

  getRecipients: (_ctx, externalId) => getEnvelopeRecipients(externalId),

  remind: (_ctx, externalId) => resendEnvelope(externalId),

  // `reason` is passed through only when given, so voidEnvelope's own default
  // wording still applies to callers that have none.
  void: (_ctx, externalId, reason) =>
    reason === undefined ? voidEnvelope(externalId) : voidEnvelope(externalId, reason),

  getFieldValues: (_ctx, externalId) => getEnvelopeFormData(externalId),

  async getSignedDocument(_ctx, externalId, opts) {
    const pdf = await getEnvelopeDocument(externalId)
    const certificate = opts?.certificate ? await getEnvelopeCertificate(externalId) : null
    return { pdf, certificate }
  },

  async getUsage() {
    const usage = await getAccountUsage()
    return { sent: usage.sent, allowed: usage.allowed, periodEnd: usage.periodEnd }
  },
}
