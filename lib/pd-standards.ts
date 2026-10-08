// ── Educator PD: the standards every PD certificate maps to ──────────────────
// The Common Core codes on the back of the Cowork certificate ("Standards
// alignment map", David, 8 Oct 2026). The certificate back is the source of
// truth: this list must match it, code for code, so the credential page a
// verifier opens says what the paper says. Copied onto each credential at issue
// (credentials.standards), so a later change never rewrites a certificate a
// teacher has already submitted for licence renewal.
//
// Codes are as printed on the back. (HSN-CED.A.3 and HSN-MG.A.3 are printed with
// the N prefix; the official CCSS identifiers are HSA-CED.A.3 and HSG-MG.A.3.)
// Replaced the 7 Oct NGSS + Common Core set. Design: docs/PLAN-educator-pd-2026-10-07.md.

export type PdFramework = 'NGSS' | 'CCSS'

export interface PdStandard {
  code: string
  framework: PdFramework
  /** The heading it sits under on the certificate back. */
  group: string
  label: string
}

const MP = 'Mathematical Practice'
const HS = 'High School Mathematics'
const ELA = 'ELA/Literacy: Science & Technical Subjects; Speaking & Listening'

export const PD_STANDARDS: readonly PdStandard[] = [
  { code: 'MP1', framework: 'CCSS', group: MP, label: 'Make sense of problems and persevere in solving them' },
  { code: 'MP2', framework: 'CCSS', group: MP, label: 'Reason abstractly and quantitatively' },
  { code: 'MP3', framework: 'CCSS', group: MP, label: 'Construct viable arguments and critique the reasoning of others' },
  { code: 'MP4', framework: 'CCSS', group: MP, label: 'Model with mathematics' },
  { code: 'MP6', framework: 'CCSS', group: MP, label: 'Attend to precision' },
  { code: 'HSN-Q.A.1', framework: 'CCSS', group: HS, label: 'Use units to understand problems and guide multi-step solutions' },
  { code: 'HSN-Q.A.2', framework: 'CCSS', group: HS, label: 'Define appropriate quantities for descriptive modeling' },
  { code: 'HSN-Q.A.3', framework: 'CCSS', group: HS, label: 'Choose a level of accuracy appropriate to measurement limits' },
  { code: 'HSN-CED.A.3', framework: 'CCSS', group: HS, label: 'Represent constraints by equations or inequalities; judge options viable or nonviable' },
  { code: 'HSN-MG.A.3', framework: 'CCSS', group: HS, label: 'Apply geometric methods to solve design problems' },
  { code: 'RST.11-12.7', framework: 'CCSS', group: ELA, label: 'Integrate and evaluate multiple sources in diverse formats' },
  { code: 'RST.11-12.9', framework: 'CCSS', group: ELA, label: 'Synthesize information from a range of sources' },
  { code: 'WHST.11-12.2', framework: 'CCSS', group: ELA, label: 'Write informative/explanatory texts on technical processes' },
  { code: 'WHST.11-12.6', framework: 'CCSS', group: ELA, label: 'Use technology to produce and update shared writing in response to feedback' },
  { code: 'SL.11-12.1', framework: 'CCSS', group: ELA, label: 'Participate effectively in collaborative discussions' },
  { code: 'SL.11-12.4', framework: 'CCSS', group: ELA, label: 'Present findings and evidence with a clear line of reasoning' },
  { code: 'SL.11-12.5', framework: 'CCSS', group: ELA, label: 'Make strategic use of digital media in presentations' },
]

/** The codes snapshotted onto a new PD credential. */
export function pdStandardCodes(): string[] {
  return PD_STANDARDS.map((s) => s.code)
}

/** A stored code with its label, or the bare code for one since retired. */
export function describeStandard(code: string): PdStandard {
  return PD_STANDARDS.find((s) => s.code === code)
    ?? { code, framework: code.startsWith('NGSS') ? 'NGSS' : 'CCSS', group: code.startsWith('NGSS') ? 'NGSS' : 'Common Core', label: '' }
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
