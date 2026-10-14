// Client-safe media helpers: the asset types and pure functions the media
// components need, with NO asset data. `lib/media-manifest.ts` holds the data
// and is server-only, so a 'use client' component that value-imports from it
// would ship every manifest entry — including files no page links to — in its
// browser chunk. Client components import from here; server code can keep
// importing from the manifest, which re-exports all of this.

/** Voice colour-coding for the T6 pull-quote wall (token classes, not hex). */
export type Audience = 'student' | 'educator' | 'mentor' | 'parent'

export interface BaseAsset {
  id: string
  /** Bytes not yet produced/hosted → component shows a placeholder + is flagged. */
  pending?: boolean
}

export interface PhotoAsset extends BaseAsset {
  /** Base path without width/ext suffix, e.g. "/media/event-floor"; the
   *  component composes srcset from `widths`. Empty while pending. */
  src: string
  /** Describes the image (screen readers, lightbox name). */
  alt: string
  /** Visible caption where a strip shows one; falls back to `alt`. */
  caption?: string
  /** Required on student work (README §9). */
  credit?: string
  widths?: number[]
}

export interface VideoAsset extends BaseAsset {
  src: string // /videos/<file>.mp4
  poster: string // /videos/<file>.poster.jpg
  captions: string // /videos/<file>.en.vtt (WebVTT, required)
  title: string
}

/** An audio-only clip with its transcript shown alongside (no video track). */
export interface AudioAsset extends BaseAsset {
  src: string // /audio/<file>.m4a
  title: string
  /** Full transcript, rendered as text beneath the player. */
  transcript: string
}

export interface QuoteAsset extends BaseAsset {
  text: string
  name: string
  /** Role / cohort / where-they-are-now. */
  meta: string
  audience: Audience
  /** Optional link to the source film (pairs T6 text with T5/T2 footage). */
  clipHref?: string
}

export interface CompetitionAsset extends BaseAsset {
  title: string
  /** Page count for the preview card label; null if unknown. */
  pages: number | null
  thumbnail: string
  /** Open preview — ALWAYS visible, never gated (README §8). */
  previewHref: string
  gated: boolean
  /** Full PDF download. Open assets only: a gated file's location stays on the
   *  server (lib/gated-assets.ts) and only ever reaches the requester by email. */
  fileHref?: string
  /** Registry key in lib/gated-assets.ts (gated only). */
  assetKey?: string
  credit?: string
}

export const PHOTO_WIDTHS = [480, 768, 1200, 1920]

/** Shown when a photo carries no more specific credit. */
export const DEFAULT_PHOTO_CREDIT = '© Stellr Education'

/* ─────────────────────────────────────────────────────────────────────────
 * Media host base. The bytes for /videos, /audio, /media and /files live in
 * the `stellr-media` public Vercel Blob store (since 21 Sept 2026 — they used
 * to ship in /public, 515 MB per deployment, which is what filled the Hobby
 * team's 10 GB Deployment Storage). NEXT_PUBLIC_MEDIA_BASE_URL is its root.
 *
 * Empty (local dev without the var) → relative paths, which only work if the
 * files are also present in /public. Set it in .env.local.
 * ───────────────────────────────────────────────────────────────────────── */
const MEDIA_BASE = (process.env.NEXT_PUBLIC_MEDIA_BASE_URL ?? '').replace(/\/+$/, '')

/** Prefix a /public-relative media path with the configured host (if any). */
export function mediaUrl(path: string): string {
  return MEDIA_BASE ? `${MEDIA_BASE}${path}` : path
}

/**
 * Same, for links that should save rather than open. Browsers ignore the
 * `download` attribute on cross-origin URLs, so once the host is external the
 * link itself has to ask for `Content-Disposition: attachment` — Vercel Blob
 * does that for `?download=1`. Self-hosted, the attribute still works and the
 * plain path is returned.
 */
export function mediaDownloadUrl(path: string): string {
  return MEDIA_BASE ? `${MEDIA_BASE}${path}?download=1` : path
}

/** True when an asset's bytes aren't ready yet → render a placeholder. */
export function isPending(asset: BaseAsset | undefined | null): boolean {
  return !asset || asset.pending === true
}

/** Dev-only warning so a pending/missing asset is never shipped unnoticed. */
export function flagMissing(kind: string, id: string): void {
  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[media-manifest] ${kind} "${id}" is pending — rendering placeholder. Fill its bytes + flip pending:false.`)
  }
}

/** srcset/sizes helper for responsive photos. The JPEG *fallback* is capped at
 *  1200w so every fallback file stays within the §4b budget (the 1920 JPEG runs
 *  300–600KB); AVIF — what virtually every browser receives — still serves all
 *  widths at ~180KB, so large screens lose no quality. */
export function photoSrcSet(p: PhotoAsset, ext: 'avif' | 'webp' | 'jpg' = 'webp'): string {
  const widths = (p.widths ?? PHOTO_WIDTHS).filter((w) => ext !== 'jpg' || w <= 1200)
  return widths.map((w) => `${p.src}-${w}.${ext} ${w}w`).join(', ')
}
