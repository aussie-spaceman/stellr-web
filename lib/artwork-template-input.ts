import { claimUpload, type UploadDenied } from '@/lib/uploads'
import { placementFromLine, type BadgeFormat } from '@/lib/badge-layout'
import { prepareBadgeArtwork } from '@/lib/badge-artwork'

// What the certificate and badge template routes accept, shared by an event's
// own templates (/api/admin/events/[slug]/…) and the theme defaults
// (/api/admin/artwork-defaults/[theme]/…): a claimed upload and a posted
// placement. Each route keeps its own access check and its own row.

export interface ClaimedArtwork {
  path: string
  bytes: Uint8Array
  mime: 'image/png' | 'image/jpeg'
}

/**
 * The artwork a PUT names (storagePath + fileType), claimed: it must sit under
 * `prefix` — the namespace the caller just authorised — and be a PNG or JPEG.
 * null when the body names no artwork.
 */
export async function claimArtwork(
  b: Record<string, unknown>,
  purpose: 'event-artwork' | 'artwork-default',
  prefix: string,
): Promise<ClaimedArtwork | UploadDenied | null> {
  const storagePath = typeof b.storagePath === 'string' ? b.storagePath : ''
  if (!storagePath) return null
  const fileType = typeof b.fileType === 'string' ? b.fileType : ''
  if (fileType !== 'image/png' && fileType !== 'image/jpeg') {
    return { error: 'Artwork must be a PNG or JPEG image', status: 400 }
  }
  if (!storagePath.startsWith(prefix)) return { error: 'Forbidden', status: 403 }
  // A signed URL accepts any bytes; both purposes accept only PNG or JPEG, the
  // two the renderer can use. The type recorded is the one the bytes are, so a
  // JPEG saved as `art.png` still renders.
  const claimed = await claimUpload({ purpose, storagePath, expectedPrefix: prefix })
  if ('error' in claimed) return claimed
  const mime = claimed.format === 'png' ? 'image/png' : claimed.format === 'jpeg' ? 'image/jpeg' : fileType
  return { path: storagePath, bytes: claimed.bytes, mime }
}

export const CERTIFICATE_PLACEMENT_RANGES = {
  name_y: [0.01, 0.99],
  name_max_width: [0.05, 1],
  name_size: [8, 120],
} as const

export const BADGE_PLACEMENT_RANGES = {
  name_x: [0.01, 0.99],
  name_y: [0.01, 0.99],
  name_max_width: [0.05, 1],
  name_size: [6, 72],
} as const

/**
 * The placement fields a positioner posted, each range-checked. A field not
 * sent is left out; one out of range is an error naming it.
 */
export function placementInput<K extends string>(
  b: Record<string, unknown>,
  ranges: Record<K, readonly [number, number]>,
): { values: Partial<Record<K, number>> } | { error: string } {
  const values: Partial<Record<K, number>> = {}
  for (const k of Object.keys(ranges) as K[]) {
    if (b[k] === undefined) continue
    const v = Number(b[k])
    const [min, max] = ranges[k]
    if (!Number.isFinite(v) || v < min || v > max) return { error: `${k} is out of range` }
    values[k] = v
  }
  return { values }
}

/**
 * A starting placement for new badge artwork, from the rule it leaves.
 * Advisory: without one the name is centred, and the admin can move it either
 * way. lineFound is null when the artwork could not be read at all.
 */
export async function badgePlacementFromArtwork(
  art: Pick<ClaimedArtwork, 'bytes' | 'mime'>,
  format: BadgeFormat,
): Promise<{ placement: Record<keyof typeof BADGE_PLACEMENT_RANGES, number | null>; lineFound: boolean | null }> {
  try {
    const prepared = await prepareBadgeArtwork(art, format)
    const p = placementFromLine(prepared.line, format)
    return {
      placement: { name_x: p.nameX, name_y: p.nameY, name_max_width: p.nameMaxWidth, name_size: p.nameSize },
      lineFound: prepared.line !== null,
    }
  } catch (err) {
    console.error('[badge templates] rule detection failed:', err)
    return { placement: { name_x: null, name_y: null, name_max_width: null, name_size: null }, lineFound: null }
  }
}
