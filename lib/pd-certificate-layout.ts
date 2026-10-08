// Where the four fields sit on the PD certificate front — the model shared by
// the renderer (lib/pd-certificate.ts, server) and the positioner
// (components/admin/PdCertificateArtwork.tsx, browser). Pure: no fonts, no fs.

export type PdField = 'name' | 'location' | 'date' | 'hours'
export const PD_FIELDS: readonly PdField[] = ['name', 'location', 'date', 'hours']

export interface FieldPlacement {
  /** Centre of the text, fraction of artwork width from the left. */
  x: number
  /** Baseline, fraction of artwork height from the top. */
  y: number
  /** Widest the text may run before it shrinks, fraction of artwork width. */
  maxWidth: number
  /** Starting size in design units (Canva px on a 1500-tall design). */
  size: number
}

export type PdLayout = Record<PdField, FieldPlacement>

/** Canva height of the Cowork design; sizes are relative to it. */
export const PD_DESIGN_HEIGHT = 1500

/** Font per field (David, 8 Oct): the name in Aileron, the rest in Norwester. */
export const PD_FIELD_FONT: Record<PdField, 'aileron' | 'norwester'> = {
  name: 'aileron', location: 'norwester', date: 'norwester', hours: 'norwester',
}

/** Where the 2027 Space Design Competition mock-up leaves its gaps. */
export const DEFAULT_PD_LAYOUT: PdLayout = {
  name:     { x: 0.5,   y: 0.372, maxWidth: 0.5,  size: 56 },
  location: { x: 0.34,  y: 0.168, maxWidth: 0.34, size: 36 },
  date:     { x: 0.612, y: 0.168, maxWidth: 0.24, size: 36 },
  hours:    { x: 0.476, y: 0.305, maxWidth: 0.05, size: 36 },
}

const LIMITS = { x: [0, 1], y: [0, 1], maxWidth: [0.02, 1], size: [6, 200] } as const

/** Stored or posted layout → a complete, in-range layout, or null if anything is off. */
export function parsePdLayout(input: unknown): PdLayout | null {
  if (!input || typeof input !== 'object') return null
  const out = {} as PdLayout
  for (const f of PD_FIELDS) {
    const raw = (input as Record<string, unknown>)[f]
    if (!raw || typeof raw !== 'object') return null
    const p = {} as FieldPlacement
    for (const k of Object.keys(LIMITS) as (keyof FieldPlacement)[]) {
      const v = Number((raw as Record<string, unknown>)[k])
      const [min, max] = LIMITS[k]
      if (!Number.isFinite(v) || v < min || v > max) return null
      p[k] = v
    }
    out[f] = p
  }
  return out
}

