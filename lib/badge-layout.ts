// Name badge stock and name placement (PRD 6.7).
//
// Two Avery products, both US Letter:
//   5392 — 4×3″ badge inserts, 2×3, perforated, edge to edge (no gaps).
//   8395 — 3⅜×2⅓″ adhesive name labels, 2×4, die-cut with gaps between.
// Geometry is Avery's published template, in inches from the page's top-left.
//
// Each format has its own background artwork. The artwork carries the design;
// the only thing drawn is the name, on the clear space above the horizontal
// rule the artwork leaves for it. findNameLine() finds that rule.
//
// Pure: no pdf-lib, no sharp. The client imports BADGE_FORMATS for the toggle.

export type BadgeFormat = 'avery_5392' | 'avery_8395'

export interface BadgeFormatSpec {
  label: string
  /** Shown under the toggle. */
  description: string
  /** Label size, inches. */
  width: number
  height: number
  cols: number
  rows: number
  /** Top-left of the first label, inches from the page's top-left. */
  left: number
  top: number
  /** Label-to-label distance, inches (size + gap). */
  pitchX: number
  pitchY: number
  /**
   * Artwork overhang past each label edge, inches. Only where there is a gap
   * to overhang into — so a slightly-off printer leaves no white sliver.
   */
  bleed: number
  /** Grey outline on each label, for cutting. */
  cutGuides: boolean
  /** Largest the name is ever set, points. */
  maxNameSize: number
  /** event-artwork upload kind; the storage path starts `${kind}-`. */
  artworkKind: string
  /** event_settings column holding this format's artwork path. */
  artworkColumn: 'badge_artwork_path' | 'badge_8395_artwork_path'
}

export const BADGE_FORMATS: Record<BadgeFormat, BadgeFormatSpec> = {
  avery_5392: {
    label: 'Avery 5392',
    description: '4 × 3″ badge inserts, 6 per sheet',
    width: 4,
    height: 3,
    cols: 2,
    rows: 3,
    left: 0.25,
    top: 1,
    pitchX: 4,
    pitchY: 3,
    bleed: 0,
    cutGuides: true,
    maxNameSize: 30,
    // 'badge' predates the second format; kept so existing uploads still resolve.
    artworkKind: 'badge',
    artworkColumn: 'badge_artwork_path',
  },
  avery_8395: {
    label: 'Avery 8395',
    description: '3⅜ × 2⅓″ adhesive labels, 8 per sheet',
    width: 3.375,
    height: 7 / 3,
    cols: 2,
    rows: 4,
    left: 0.6875,
    top: 0.59375,
    pitchX: 3.75,
    pitchY: 2.5,
    bleed: 1 / 16,
    cutGuides: false,
    maxNameSize: 26,
    artworkKind: 'badge8395',
    artworkColumn: 'badge_8395_artwork_path',
  },
}

export const DEFAULT_BADGE_FORMAT: BadgeFormat = 'avery_5392'

export function isBadgeFormat(v: unknown): v is BadgeFormat {
  return typeof v === 'string' && v in BADGE_FORMATS
}

export function badgeFormatForKind(kind: unknown): BadgeFormat | null {
  const hit = (Object.keys(BADGE_FORMATS) as BadgeFormat[]).find((f) => BADGE_FORMATS[f].artworkKind === kind)
  return hit ?? null
}

// ── Finding the rule ─────────────────────────────────────────────────────────

/** Row-major RGB pixels (3 bytes each). */
export interface RgbImage {
  data: Uint8Array
  width: number
  height: number
}

/** Where the artwork's rule is, as fractions of the image (0 = top/left). */
export interface NameLine {
  /** Top edge of the rule. */
  y: number
  x0: number
  x1: number
  /** Height of the clear space directly above the rule. */
  clear: number
  /** 0–255 luminance of that clear space, to pick the ink. */
  backgroundLuma: number
}

/** A channel difference above this is an edge; below it is JPEG noise. */
const CONTRAST = 48

function diff(d: Uint8Array, a: number, b: number): number {
  return Math.max(Math.abs(d[a] - d[b]), Math.abs(d[a + 1] - d[b + 1]), Math.abs(d[a + 2] - d[b + 2]))
}

/**
 * Find the horizontal rule the name sits on: the longest run of pixels that
 * step away from the colour above them and, within a few pixels, step back to
 * it. That "and back" is what tells a rule from the edge of a colour band.
 * Rules of similar length are ranked by the clear space above them.
 * Returns null when nothing spans at least a quarter of the width.
 */
export function findNameLine(img: RgbImage): NameLine | null {
  const { data, width: W, height: H } = img
  const at = (x: number, y: number) => (y * W + x) * 3
  const maxThick = Math.max(2, Math.round(H * 0.05))
  const minRun = Math.round(W * 0.25)

  const runs: { y: number; x0: number; x1: number }[] = []
  for (let y = 2; y < H - 2; y++) {
    let best = { len: 0, x0: 0 }
    let start = -1
    let last = -1
    for (let x = 0; x < W; x++) {
      const p = at(x, y)
      const above = at(x, y - 2)
      let hit = false
      if (diff(data, p, above) > CONTRAST) {
        for (let t = 1; t <= maxThick && y + t < H; t++) {
          const below = at(x, y + t)
          if (diff(data, below, above) <= CONTRAST && diff(data, below, p) > CONTRAST) {
            hit = true
            break
          }
        }
      }
      if (!hit) continue
      // Tolerate a pixel or two of noise inside a run.
      if (start < 0 || x - last > 3) start = x
      last = x
      if (last - start + 1 > best.len) best = { len: last - start + 1, x0: start }
    }
    if (best.len >= minRun) runs.push({ y, x0: best.x0, x1: best.x0 + best.len - 1 })
  }
  if (runs.length === 0) return null

  // A thick rule matches on consecutive rows; keep only each band's top row.
  const tops = runs.filter((r, i) => i === 0 || runs[i - 1].y !== r.y - 1)
  const longest = Math.max(...tops.map((r) => r.x1 - r.x0))
  const candidates = tops
    .filter((r) => r.x1 - r.x0 >= longest * 0.85)
    .map((r) => ({ ...r, ...clearAbove(img, r.y, r.x0, r.x1) }))
  candidates.sort((a, b) => b.rows - a.rows || b.x1 - b.x0 - (a.x1 - a.x0))
  const pick = candidates[0]

  return {
    y: pick.y / H,
    x0: pick.x0 / W,
    x1: (pick.x1 + 1) / W,
    clear: pick.rows / H,
    backgroundLuma: pick.luma,
  }
}

/** Rows of uniform colour directly above the rule, over its span. */
function clearAbove(img: RgbImage, lineY: number, x0: number, x1: number): { rows: number; luma: number } {
  const { data, width: W } = img
  const at = (x: number, y: number) => (y * W + x) * 3
  const refY = lineY - 2
  const mid = at(Math.round((x0 + x1) / 2), refY)
  const luma = Math.round(0.299 * data[mid] + 0.587 * data[mid + 1] + 0.114 * data[mid + 2])

  const span = x1 - x0 + 1
  let y = refY
  for (; y >= 0; y--) {
    let busy = 0
    for (let x = x0; x <= x1; x++) if (diff(data, at(x, y), mid) > CONTRAST) busy++
    if (busy / span > 0.02) break
  }
  return { rows: lineY - (y + 1), luma }
}

// ── Setting the name ─────────────────────────────────────────────────────────

/** Share of the font size above the baseline (caps) and below (descenders). */
const ASCENT = 0.75
const DESCENT = 0.22

export interface NameSetting {
  centerX: number
  baselineY: number
  maxWidth: number
  /** Starting size; shrink with fittedSize() until the name fits maxWidth. */
  size: number
}

/**
 * Where the name goes on one label, in PDF points (y up). `box` is where the
 * artwork is drawn (label plus bleed); `line` is in fractions of that box.
 * With no rule, the name is centred on the label.
 */
export function nameSetting(
  box: { x: number; y: number; width: number; height: number },
  label: { x: number; width: number; height: number },
  line: NameLine | null,
  maxSize: number,
): NameSetting {
  const inset = 0.15 * 72
  if (!line) {
    const size = maxSize
    return {
      centerX: label.x + label.width / 2,
      baselineY: box.y + box.height / 2 - (size * ASCENT) / 2,
      maxWidth: label.width - inset * 2,
      size,
    }
  }

  const lineTop = box.y + box.height * (1 - line.y)
  const clear = box.height * line.clear
  const pad = 3
  // The name, descenders and all, must sit inside the clear space.
  const size = Math.max(8, Math.min(maxSize, (clear - pad * 2) / (ASCENT + DESCENT)))
  const x0 = Math.max(box.x + box.width * line.x0, label.x + inset)
  const x1 = Math.min(box.x + box.width * line.x1, label.x + label.width - inset)
  return {
    centerX: (x0 + x1) / 2,
    // PDF y runs up: above the rule is +.
    baselineY: lineTop + pad + size * DESCENT,
    maxWidth: Math.max(x1 - x0, label.width * 0.5) * 0.96,
    size,
  }
}

export function badgeName(firstName: string, lastName: string): string {
  return `${firstName.trim()} ${lastName.trim()}`.trim()
}
