// Expiring signed links for gated downloads (lib/gated-assets.ts).
//
//   /api/asset-request/download?a=<asset key>&e=<expiry, unix seconds>&s=<sig>
//   sig = base64url HMAC-SHA256(secret, "stellr-asset|download|<key>|<expiry>")
//
// The link is emailed to whoever asked for the file and works until it
// expires. Nothing is stored; the signature is recomputed. Node only.
import 'server-only'
import { createHmac } from 'node:crypto'
import { safeStrEqual } from '@/lib/secret-compare'
import { isGatedAssetKey, type GatedAssetKey } from '@/lib/gated-assets'

/** How long an emailed link works. Seven days at most. */
export const LINK_TTL_SECONDS = 7 * 24 * 60 * 60

export const DOWNLOAD_PATH = '/api/asset-request/download'

/**
 * A dedicated secret when set; otherwise the survey or e-sign one, which the
 * prefix keeps from ever minting a token of their kind (the same arrangement
 * as lib/credentials-link.ts). Production has SURVEY_TOKEN_SECRET.
 */
function secret(): string | null {
  const s = process.env.ASSET_LINK_SECRET || process.env.SURVEY_TOKEN_SECRET || process.env.ESIGN_TOKEN_SECRET
  return s && s.length >= 32 ? s : null
}

export function downloadLinksConfigured(): boolean {
  return secret() !== null
}

function sign(key: GatedAssetKey, expires: number): string | null {
  const s = secret()
  if (!s) return null
  return createHmac('sha256', s).update(`stellr-asset|download|${key}|${expires}`).digest('base64url')
}

/** Absolute link for the email, or null when no signing secret is configured. */
export function gatedDownloadUrl(siteUrl: string, key: GatedAssetKey, now: Date = new Date()): string | null {
  const expires = Math.floor(now.getTime() / 1000) + LINK_TTL_SECONDS
  const sig = sign(key, expires)
  if (!sig) return null
  const q = new URLSearchParams({ a: key, e: String(expires), s: sig })
  return `${siteUrl.replace(/\/+$/, '')}${DOWNLOAD_PATH}?${q.toString()}`
}

export type LinkCheck = { ok: true; key: GatedAssetKey } | { ok: false; reason: 'invalid' | 'expired' }

/** Constant-time signature check plus expiry. An expiry further out than the
 *  TTL allows is treated as forged. */
export function verifyGatedDownload(params: URLSearchParams, now: Date = new Date()): LinkCheck {
  const key = params.get('a')
  const e = params.get('e')
  const sig = params.get('s')
  if (!isGatedAssetKey(key) || !e || !/^\d{1,12}$/.test(e) || !sig || !/^[A-Za-z0-9_-]{43}$/.test(sig)) {
    return { ok: false, reason: 'invalid' }
  }
  const expires = Number(e)
  const expected = sign(key, expires)
  if (!expected || !safeStrEqual(sig, expected)) return { ok: false, reason: 'invalid' }
  const nowS = Math.floor(now.getTime() / 1000)
  if (expires - nowS > LINK_TTL_SECONDS + 60) return { ok: false, reason: 'invalid' }
  if (expires < nowS) return { ok: false, reason: 'expired' }
  return { ok: true, key }
}
