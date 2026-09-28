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
    maxNameSize: 28,
    // 'badge' predates the second format; kept so existing uploads still resolve.
    artworkKind: 'badge',
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
    maxNameSize: 22,
    artworkKind: 'badge8395',
  },
}

export const DEFAULT_BADGE_FORMAT: BadgeFormat = 'avery_5392'

export function isBadgeFormat(v: unknown): v is BadgeFormat {
  return typeof v === 'string' && v in BADGE_FORMATS
}

/**
 * Who a template is for. A badge uses its company's template, else the
 * mentors' (for mentors), else everyone's — see pickTemplate().
 */
export type BadgeAudience = 'everyone' | 'mentors' | 'company'

export interface BadgeTemplateRef {
  audience: BadgeAudience
  companyId: string | null
}

/** The most specific template for one person, or null for a plain badge. */
export function pickTemplate<T extends BadgeTemplateRef>(
  templates: T[],
  person: { companyId: string | null; mentor: boolean },
): T | null {
  return (
    (person.companyId ? templates.find((t) => t.audience === 'company' && t.companyId === person.companyId) : undefined) ??
    (person.mentor ? templates.find((t) => t.audience === 'mentors') : undefined) ??
    templates.find((t) => t.audience === 'everyone') ??
    null
  )
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
  /** Top edge of the rule, at its middle. */
  y: number
  x0: number
  x1: number
  /** Height of the clear space directly above the rule. */
  clear: number
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
 *
 * Hand-drawn and exported rules are rarely level — the CO SDC set climbs ~1%
 * across the label — so a run may wander over a band of rows rather than sit
 * on one. Rules of similar length are ranked by the clear space above them.
 * Returns null when nothing spans at least a quarter of the width.
 */
export function findNameLine(img: RgbImage): NameLine | null {
  const { data, width: W, height: H } = img
  const at = (x: number, y: number) => (y * W + x) * 3
  const maxThick = Math.max(2, Math.round(H * 0.05))
  const band = Math.max(3, Math.round(H * 0.03))
  const minRun = Math.round(W * 0.25)

  // hits[y][x]: pixel (x, y) is the top edge of something rule-like.
  const hits: Uint8Array[] = []
  for (let y = 0; y < H; y++) {
    const row = new Uint8Array(W)
    if (y >= 2 && y < H - 2) {
      for (let x = 0; x < W; x++) {
        const p = at(x, y)
        const above = at(x, y - 2)
        if (diff(data, p, above) <= CONTRAST) continue
        for (let t = 1; t <= maxThick && y + t < H; t++) {
          const below = at(x, y + t)
          if (diff(data, below, above) <= CONTRAST && diff(data, below, p) > CONTRAST) {
            row[x] = 1
            break
          }
        }
      }
    }
    hits.push(row)
  }

  // For each starting row, the longest run of columns with a hit somewhere in
  // the band of rows below it — so a sloping rule counts as one run.
  type Run = { y: number; x0: number; x1: number; top: number }
  const runs: Run[] = []
  for (let y = 2; y < H - 2; y++) {
    let best = { len: 0, x0: 0 }
    let start = -1
    let last = -1
    for (let x = 0; x < W; x++) {
      let hit = false
      for (let k = 0; k < band && y + k < H; k++) if (hits[y + k][x]) { hit = true; break }
      if (!hit) continue
      // Tolerate a pixel or two of noise inside a run.
      if (start < 0 || x - last > 3) start = x
      last = x
      if (last - start + 1 > best.len) best = { len: last - start + 1, x0: start }
    }
    if (best.len < minRun) continue
    const x0 = best.x0
    const x1 = best.x0 + best.len - 1
    // The rule's top at its middle: the first hit row in the band there.
    const mid = Math.round((x0 + x1) / 2)
    let top = y
    for (let k = 0; k < band && y + k < H; k++) {
      if ([mid - 2, mid - 1, mid, mid + 1, mid + 2].some((x) => x >= 0 && x < W && hits[y + k][x])) { top = y + k; break }
    }
    runs.push({ y, x0, x1, top })
  }
  if (runs.length === 0) return null

  // Overlapping bands see the same rule: keep the longest run per rule.
  const rules: Run[] = []
  for (const r of runs) {
    const same = rules.find((q) => Math.abs(q.top - r.top) <= band)
    if (!same) rules.push(r)
    else if (r.x1 - r.x0 > same.x1 - same.x0) Object.assign(same, r)
  }
  const longest = Math.max(...rules.map((r) => r.x1 - r.x0))
  const candidates = rules
    .filter((r) => r.x1 - r.x0 >= longest * 0.85)
    .map((r) => ({ ...r, rows: clearAbove(img, r.top, r.x0, r.x1) }))
  candidates.sort((a, b) => b.rows - a.rows || b.x1 - b.x0 - (a.x1 - a.x0))
  const pick = candidates[0]

  return { y: pick.top / H, x0: pick.x0 / W, x1: (pick.x1 + 1) / W, clear: pick.rows / H }
}

/** Rows of near-uniform colour directly above the rule, over its middle half. */
function clearAbove(img: RgbImage, lineY: number, x0: number, x1: number): number {
  const { data, width: W } = img
  const at = (x: number, y: number) => (y * W + x) * 3
  // The middle half: a sloping rule's ends sit higher than its middle, and
  // artwork at the label's edges often crowds the rule's ends.
  const q = Math.round((x1 - x0) / 4)
  const a = x0 + q
  const b = x1 - q
  const refY = Math.max(0, lineY - 3)
  const ref = at(Math.round((a + b) / 2), refY)
  const span = b - a + 1
  let y = refY
  for (; y >= 0; y--) {
    let busy = 0
    for (let x = a; x <= b; x++) if (diff(data, at(x, y), ref) > CONTRAST) busy++
    if (busy / span > 0.02) break
  }
  return lineY - (y + 1)
}

// ── Setting the name ─────────────────────────────────────────────────────────

/**
 * Where the name goes on a template, as fractions of the label artwork (bleed
 * included) — so it tracks the artwork, like certificates' NamePlacement.
 */
export interface BadgePlacement {
  /** Centre of the name, from the left. */
  nameX: number
  /** Baseline, from the top. */
  nameY: number
  /** Widest the name may run. */
  nameMaxWidth: number
  /** Starting size in points; long names shrink to fit. */
  nameSize: number
}

/** Share of the font size above the baseline (caps) and below (descenders). */
const ASCENT = 0.75
const DESCENT = 0.22

/** The artwork box (label + bleed) in points. */
export function artworkBox(format: BadgeFormat): { width: number; height: number } {
  const spec = BADGE_FORMATS[format]
  return { width: (spec.width + spec.bleed * 2) * 72, height: (spec.height + spec.bleed * 2) * 72 }
}

/**
 * A starting placement from the rule, or a centred one without it. The name
 * sits just on the rule (descenders about touching it), as large as the
 * format allows and the clear space holds, and may run a little past the
 * rule's ends rather than shrink a long name to nothing.
 */
export function placementFromLine(line: NameLine | null, format: BadgeFormat): BadgePlacement {
  const spec = BADGE_FORMATS[format]
  const box = artworkBox(format)
  const insetFrac = (spec.bleed + 0.15) / (spec.width + spec.bleed * 2)
  const widest = 1 - insetFrac * 2
  if (!line) return { nameX: 0.5, nameY: 0.55, nameMaxWidth: round(widest * 0.9), nameSize: spec.maxNameSize }

  const clearPt = line.clear * box.height
  const size = Math.max(10, Math.min(spec.maxNameSize, Math.floor((clearPt - 4) / (ASCENT + DESCENT))))
  const gap = 1.5 + size * 0.15
  const span = line.x1 - line.x0
  const centre = (line.x0 + line.x1) / 2
  // Stay inside the label, whatever the rule does.
  const half = Math.min(Math.max(span, 0.6) / 2 + 0.05, centre - insetFrac, 1 - insetFrac - centre)
  return {
    nameX: round(centre),
    nameY: round(line.y - gap / box.height),
    nameMaxWidth: round(Math.max(half * 2, 0.3)),
    nameSize: size,
  }
}

const round = (v: number) => Math.round(v * 1000) / 1000

/** Placement → page points (y up) for one label's artwork box. */
export function nameSetting(
  box: { x: number; y: number; width: number; height: number },
  p: BadgePlacement,
): { centerX: number; baselineY: number; maxWidth: number; size: number } {
  return {
    centerX: box.x + box.width * p.nameX,
    baselineY: box.y + box.height * (1 - p.nameY),
    maxWidth: box.width * p.nameMaxWidth,
    size: p.nameSize,
  }
}

export function badgeName(firstName: string, lastName: string): string {
  return `${firstName.trim()} ${lastName.trim()}`.trim()
}
