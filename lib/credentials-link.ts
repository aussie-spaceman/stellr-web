import { createHmac } from 'node:crypto'
import { safeStrEqual } from '@/lib/secret-compare'
import { credentialUrl } from '@/lib/credentials-core'

// ── The family link: a private credential, opened from the issued email ──────
//
// A private credential page shows only to its holder, signed in. The issued
// email for a minor goes to the guardian, who has no Stellr account of their
// own, so a plain link showed every parent "This credential is private"
// (6 Oct 2026: 35 of 40 live credentials were private minor ones). The email
// therefore carries this link instead:
//
//   /credentials/<number>?k=<base64url HMAC-SHA256(secret, "stellr-credential|view|<id>")>
//
// It opens the page read-only — no sharing controls, no view count, never
// indexed. It does not make anything public: without `k` the page answers
// exactly as before. Nothing is stored; the token is recomputed. Node only
// (node:crypto), so the edge badge and share-card routes never import it.

export const FAMILY_LINK_PARAM = 'k'

/**
 * A dedicated secret when set; otherwise the survey or e-sign one, which the
 * prefix keeps from ever minting a link of their kind. Production has
 * SURVEY_TOKEN_SECRET; CI has ESIGN_TOKEN_SECRET. Changing whichever is in use
 * breaks every family link already emailed (the plain page still works).
 */
function secret(): string | null {
  const s = process.env.CREDENTIAL_LINK_SECRET || process.env.SURVEY_TOKEN_SECRET || process.env.ESIGN_TOKEN_SECRET
  return s && s.length >= 32 ? s : null
}

export function familyLinkConfigured(): boolean {
  return secret() !== null
}

export function credentialViewToken(credentialId: string): string | null {
  const s = secret()
  if (!s) return null
  return createHmac('sha256', s).update(`stellr-credential|view|${credentialId}`).digest('base64url')
}

/** Constant-time; false for anything missing, malformed or unconfigured. */
export function verifyCredentialViewToken(credentialId: string, token: string | null | undefined): boolean {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false
  const expected = credentialViewToken(credentialId)
  return !!expected && safeStrEqual(token, expected)
}

/** The link for the issued email. Falls back to the plain page when no secret is set. */
export function familyCredentialUrl(credential: { id: string; number: string }): string {
  const token = credentialViewToken(credential.id)
  const url = credentialUrl(credential.number)
  return token ? `${url}?${FAMILY_LINK_PARAM}=${token}` : url
}
