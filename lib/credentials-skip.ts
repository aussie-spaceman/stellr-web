// Bulk credential issues: what a refusal looks like in the result (S5 wave 7, A10a
// follow-up, owner-approved 13 Nov 2026). Dependency-free, so the client admin panels
// can import it without pulling in lib/env; lib/credentials-core re-exports it.

/** Why issueCredential made no credential (S5 wave 7, A10a). */
export type CredentialNotIssuedReason = 'consent_pending' | 'tenant_not_issuer'

/**
 * The refusal in a few words, for a bulk issue's "skipped" line (S5 A10a follow-up,
 * owner-approved 13 Nov 2026).
 */
export const NOT_ISSUED_SHORT: Record<CredentialNotIssuedReason, string> = {
  tenant_not_issuer: 'another organisation’s event',
  consent_pending: 'consent form not signed yet',
}

/**
 * A person a bulk issue skipped because issueCredential refused them. A refusal is
 * not a failure: nothing went wrong, and running the issue again changes nothing.
 */
export interface CredentialSkip {
  name: string
  reason: CredentialNotIssuedReason
}

/**
 * "3 skipped (another organisation’s event)", one part per reason, for the admin
 * panels' result line. Empty when nothing was skipped.
 */
export function describeSkips(skips: readonly Pick<CredentialSkip, 'reason'>[]): string[] {
  const counts = new Map<CredentialNotIssuedReason, number>()
  for (const s of skips) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1)
  return [...counts].map(([reason, n]) => `${n} skipped (${NOT_ISSUED_SHORT[reason] ?? reason})`)
}
