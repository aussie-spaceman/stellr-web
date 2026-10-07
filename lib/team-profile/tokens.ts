/**
 * Team profile link tokens: the survey scheme with its own purpose label.
 *
 * token = base64url(HMAC-SHA256(secret, "team-profile.<row id>.<version>"))
 *
 * Only SHA-256(token) is stored, and because the token is derived the server
 * can re-mint the same link for a resend or the member page without keeping
 * it. Bumping team_profiles.token_version revokes it.
 */
import { AUTH_APP_URL } from '@/lib/env'
import { hashToken, looksLikeToken, signedLinkToken } from '@/lib/survey/tokens'

export { hashToken, looksLikeToken }

export function teamProfileToken(id: string, version: number): string {
  return signedLinkToken('team-profile', id, version)
}

export function teamProfileLink(id: string, version: number): string {
  return `${AUTH_APP_URL}/team-profile/${teamProfileToken(id, version)}`
}
