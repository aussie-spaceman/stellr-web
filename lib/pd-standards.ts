// ── Educator PD: the standards every PD certificate maps to ──────────────────
// One Stellr-wide set (decision Q8, 7 Oct 2026), copied onto each credential at
// issue (credentials.standards) so a later change never rewrites a certificate
// a teacher has already submitted for licence renewal.
//
// Grade-neutral on purpose: events run grades 7–12, so these are the NGSS
// practices and the Common Core practice/anchor standards rather than
// grade-banded performance expectations. Confirmed by David, 7 Oct 2026.
// Design: docs/PLAN-educator-pd-2026-10-07.md.

export type PdFramework = 'NGSS' | 'CCSS'

export interface PdStandard {
  code: string
  framework: PdFramework
  label: string
}

export const PD_STANDARDS: readonly PdStandard[] = [
  { code: 'NGSS SEP 1', framework: 'NGSS', label: 'Asking questions and defining problems' },
  { code: 'NGSS SEP 6', framework: 'NGSS', label: 'Constructing explanations and designing solutions' },
  { code: 'NGSS ETS1', framework: 'NGSS', label: 'Engineering design' },
  { code: 'CCSS.MATH.PRACTICE.MP1', framework: 'CCSS', label: 'Make sense of problems and persevere in solving them' },
  { code: 'CCSS.MATH.PRACTICE.MP4', framework: 'CCSS', label: 'Model with mathematics' },
  { code: 'CCSS.ELA-LITERACY.CCRA.SL.1', framework: 'CCSS', label: 'Collaborative discussion' },
]

/** The codes snapshotted onto a new PD credential. */
export function pdStandardCodes(): string[] {
  return PD_STANDARDS.map((s) => s.code)
}

/** A stored code with its label, or the bare code for one since retired. */
export function describeStandard(code: string): PdStandard {
  return PD_STANDARDS.find((s) => s.code === code) ?? { code, framework: code.startsWith('CCSS') ? 'CCSS' : 'NGSS', label: '' }
}

/** Hours as a person reads them: 8 → "8", 7.5 → "7.5". */
export function formatPdHours(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1)
}

/**
 * The credential title — what LinkedIn shows as the certification name, so the
 * hours are in it (decision Q7: one LinkedIn entry per event).
 */
export function pdCredentialTitle(eventTitle: string, hours: number): string {
  const unit = hours === 1 ? 'hour' : 'hours'
  return `Professional Development — ${eventTitle.trim()} (${formatPdHours(hours)} ${unit})`
}

/** Admin input → hours, or null when outside what the column accepts. */
export function parsePdHours(input: unknown): number | null {
  const n = typeof input === 'number' ? input : typeof input === 'string' ? Number(input.trim()) : NaN
  if (!Number.isFinite(n)) return null
  const rounded = Math.round(n * 10) / 10
  return rounded > 0 && rounded <= 40 ? rounded : null
}
