/**
 * Survey link tokens.
 *
 * token = base64url(HMAC-SHA256(secret, "survey.<invitation_id>.<version>"))
 *
 * Only SHA-256(token) is stored (survey_invitations.token_hash), so a database
 * read never yields a working link. Because the token is derived, every email
 * — invitation and reminders — carries the same link without the raw token
 * ever being kept; bumping token_version revokes it.
 */
import { createHash, createHmac } from 'node:crypto'
import { AUTH_APP_URL } from '@/lib/env'

function secret(): string {
  const s = process.env.SURVEY_TOKEN_SECRET || process.env.ESIGN_TOKEN_SECRET
  if (!s || s.length < 32) throw new Error('SURVEY_TOKEN_SECRET (or ESIGN_TOKEN_SECRET) must be set, 32+ characters')
  return s
}

export function surveyToken(invitationId: string, version: number): string {
  return createHmac('sha256', secret()).update(`survey.${invitationId}.${version}`).digest('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Shape check before any lookup: 43 base64url characters. */
export function looksLikeToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token)
}

export function surveyLink(token: string): string {
  return `${AUTH_APP_URL}/survey/${token}`
}

export function stopRemindersLink(token: string): string {
  return `${AUTH_APP_URL}/survey/${token}/stop-reminders`
}
