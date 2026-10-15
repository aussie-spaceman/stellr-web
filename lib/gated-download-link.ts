// Signed links for gated downloads (lib/gated-assets.ts).
//
//   /api/asset-request/download?a=<asset key>&s=<sig>
//   sig = base64url HMAC-SHA256(secret, "stellr-asset|download|<key>")
//
// The link is emailed to whoever asked for the file and does not expire. The
// signature stops a link being edited to reach another file. Nothing is
// stored; the signature is recomputed. Changing the secret retires every link
// at once. Node only.
import 'server-only'
import { createHmac } from 'node:crypto'
import { safeStrEqual } from '@/lib/secret-compare'
import { isGatedAssetKey, type GatedAssetKey } from '@/lib/gated-assets'

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

function sign(key: GatedAssetKey): string | null {
  const s = secret()
  if (!s) return null
  return createHmac('sha256', s).update(`stellr-asset|download|${key}`).digest('base64url')
}

/** Absolute link for the email, or null when no signing secret is configured. */
export function gatedDownloadUrl(siteUrl: string, key: GatedAssetKey): string | null {
  const sig = sign(key)
  if (!sig) return null
  const q = new URLSearchParams({ a: key, s: sig })
  return `${siteUrl.replace(/\/+$/, '')}${DOWNLOAD_PATH}?${q.toString()}`
}

export type LinkCheck = { ok: true; key: GatedAssetKey } | { ok: false }

/** Constant-time signature check. */
export function verifyGatedDownload(params: URLSearchParams): LinkCheck {
  const key = params.get('a')
  const sig = params.get('s')
  if (!isGatedAssetKey(key) || !sig || !/^[A-Za-z0-9_-]{43}$/.test(sig)) return { ok: false }
  const expected = sign(key)
  if (!expected || !safeStrEqual(sig, expected)) return { ok: false }
  return { ok: true, key }
}
