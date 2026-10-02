import { createHmac } from 'crypto'
import { safeStrEqual } from '@/lib/secret-compare'

// Capability tokens for Stellr signing. A signer has no login: possession of
// the emailed link is what lets them sign, as it was with DocuSign. So the
// token must be unguessable, tied to one signer, short-lived, and dead the
// moment the agreement is voided, reissued or completed.
//
//   <recipient row id>.<purpose><version>.<expiry, unix seconds>.<HMAC>
//
// Nothing secret is stored: the HMAC is recomputed from the parts. Bumping the
// recipient's token_version in the database kills every earlier link.
//
// Purposes:
//   s — sign: the emailed signing link
//   d — download: the link in the completion email, for the signed copy
//   c — session: the cookie set once a link has been opened, so the token
//       leaves the address bar and is never sent again
//   r — request: the link confirming a privacy request (review, deletion,
//       withdrawal) came from the address it names (lib/privacy-requests.ts)
//
// The purpose is inside the HMAC, so no link works as any other kind.

export type TokenPurpose = 'sign' | 'download' | 'session' | 'request'

const PURPOSE_CODE: Record<TokenPurpose, string> = { sign: 's', download: 'd', session: 'c', request: 'r' }
const CODE_PURPOSE: Record<string, TokenPurpose> = { s: 'sign', d: 'download', c: 'session', r: 'request' }

const DAY = 24 * 60 * 60
export const SIGN_LINK_TTL_SECONDS = 30 * DAY
export const DOWNLOAD_LINK_TTL_SECONDS = 30 * DAY
export const SESSION_TTL_SECONDS = 30 * 60

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/**
 * The signing secret. Dedicated to this purpose and never borrowed from
 * another one: a leaked cron or impersonation secret must not also mint
 * signing links.
 */
function secret(): string {
  const s = process.env.ESIGN_TOKEN_SECRET
  if (!s || s.length < 32) {
    throw new Error('ESIGN_TOKEN_SECRET is not set (or is shorter than 32 characters); signing links cannot be issued')
  }
  return s
}

export function signingConfigured(): boolean {
  const s = process.env.ESIGN_TOKEN_SECRET
  return !!s && s.length >= 32
}

function mac(recipientId: string, purpose: TokenPurpose, version: number, exp: number): string {
  return createHmac('sha256', secret())
    .update(`stellr-esign|${recipientId}|${purpose}|${version}|${exp}`)
    .digest('base64url')
}

export function mintToken(
  recipientId: string,
  purpose: TokenPurpose,
  version: number,
  ttlSeconds: number,
  now = Date.now(),
): { token: string; expiresAt: Date } {
  const exp = Math.floor(now / 1000) + ttlSeconds
  return {
    token: `${recipientId}.${PURPOSE_CODE[purpose]}${version}.${exp}.${mac(recipientId, purpose, version, exp)}`,
    expiresAt: new Date(exp * 1000),
  }
}

export interface VerifiedToken {
  recipientId: string
  purpose: TokenPurpose
  version: number
  expiresAt: Date
}

/**
 * Checks a token's form, signature and expiry. The caller must still compare
 * `version` with the recipient's current token_version: a token can be
 * perfectly signed and yet revoked.
 */
export function verifyToken(token: string, expected: TokenPurpose, now = Date.now()): VerifiedToken | null {
  if (typeof token !== 'string' || token.length > 200) return null
  const parts = token.split('.')
  if (parts.length !== 4) return null
  const [recipientId, pv, expRaw, given] = parts
  if (!UUID.test(recipientId)) return null
  const purpose = CODE_PURPOSE[pv.charAt(0)]
  const version = Number(pv.slice(1))
  const exp = Number(expRaw)
  if (purpose !== expected || !Number.isInteger(version) || version < 1 || !Number.isInteger(exp)) return null
  if (exp * 1000 <= now) return null
  if (!safeStrEqual(given, mac(recipientId, purpose, version, exp))) return null
  return { recipientId, purpose, version, expiresAt: new Date(exp * 1000) }
}

/** Where a signer opens their signing link. The token sits in the fragment. */
export function signingUrl(siteUrl: string, token: string): string {
  return `${siteUrl}/sign#${token}`
}

export function downloadUrl(siteUrl: string, token: string): string {
  return `${siteUrl}/sign/copy#${token}`
}

export const SESSION_COOKIE = 'stellr_sign'
