// Pure formatting/parsing for values written to and read back from DocuSign
// forms. Kept separate from lib/docusign.ts (network + secrets) so it is
// unit-testable.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * The minor form prints "Date of Birth (DD-MMM-YYYY)", so an ISO date from the
 * database (2012-04-10) goes in as 10-Apr-2012 — the month spelt out so US and
 * European readers can't swap day and month. Anything that isn't a plain ISO
 * date is passed through untouched rather than guessed at.
 */
export function formatFormDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim())
  if (!m) return iso
  const month = MONTHS[Number(m[2]) - 1]
  return month ? `${m[3]}-${month}-${m[1]}` : iso
}

/** tabLabel of the guardian's checkbox on the minor consent template. */
export const CREDENTIAL_OPT_OUT_TAB = 'CredentialSharingOptOut'

const CHECKED = new Set(['x', 'true', 'on', 'checked', 'yes', '1'])

/**
 * True when the guardian ticked "I do NOT consent" on the form.
 * - `null` when the tab is absent (a form sent before the template change):
 *   the caller leaves the stored value alone.
 * Values come from nameCheckboxes below ('true'/'false') or a Stellr-signed
 * form's signer values; "X" (DocuSign's old form_data spelling) and the other
 * truthy spellings are still accepted.
 */
export function readCredentialOptOut(fields: { name: string; value: string }[]): boolean | null {
  return readCheckbox(fields, CREDENTIAL_OPT_OUT_TAB)
}

/** Any "I do NOT consent" checkbox by tab label: true ticked, false not, null absent. */
export function readCheckbox(fields: { name: string; value: string }[], tab: string): boolean | null {
  const matches = fields.filter((f) => f.name.toLowerCase() === tab.toLowerCase())
  if (matches.length === 0) return null
  return matches.some((f) => CHECKED.has(f.value.trim().toLowerCase()))
}

/**
 * The other opt-outs on the V2.3 agreements, by tab label, and the column
 * each is recorded in. Media is on every agreement; quotes and direct digital
 * communications are on the Student / Minor agreement only.
 */
export const OPT_OUT_COLUMNS = {
  MediaOptOut: 'media_opt_out',
  QuoteOptOut: 'quote_opt_out',
  DigitalCommsOptOut: 'digital_comms_opt_out',
} as const

// ── Reading the opt-out boxes off a signed DocuSign form ────────────────────
//
// DocuSign names a checkbox only if someone gave it a data label. Forms signed
// before 6 Oct 2026 (Participation Agreements V2.1/V2.2) carry auto-generated
// labels ("Checkbox 4f0e538d-…"), and one V2.3 template briefly had
// CredentialSharingOptOut on the quote box. So a box is named by the sentence
// printed beside it on the signed PDF, never by its label: "I DO NOT consent
// to photo and media use" is the media box on every version of every form.
// A box whose sentence can't be found is left out, so its answer stays
// unknown rather than guessed.

/** The opt-out boxes the app records, by name. */
export const OPT_OUT_BOXES = ['MediaOptOut', 'QuoteOptOut', 'DigitalCommsOptOut', 'CredentialSharingOptOut'] as const
export type OptOutBox = (typeof OPT_OUT_BOXES)[number]

/** Matched against the "I DO NOT consent …" sentence beside a box. */
const STATEMENTS: { name: OptOutBox; pattern: RegExp }[] = [
  // Student/Minor and Adult forms say "photo and media use"; the Mentor form
  // (also signed by volunteers) says "use of my name and image".
  { name: 'MediaOptOut', pattern: /do not consent to (photo and media use|use of my name and image)/ },
  { name: 'QuoteOptOut', pattern: /do not consent to .*\bquoted\b/ },
  { name: 'CredentialSharingOptOut', pattern: /do not consent to .*\bcredential\b/ },
  { name: 'DigitalCommsOptOut', pattern: /do not consent to direct digital communications/ },
]

/** A checkbox as DocuSign reports it: position in points from the page's top-left. */
export interface FormCheckbox {
  page: number
  x: number
  y: number
  selected: boolean
}

/** One page's text, positioned from the top-left (lib/esign/native/pdf-text). */
export interface FormPageText {
  items: { str: string; x: number; y: number }[]
}

// The sentence's baseline sits 11–15pt below the top of its box on every
// DocuSign form seen (V2.1 minor/adult/mentor exports); the window allows for
// a box placed a little high or low.
const BASELINE_MIN = -4
const BASELINE_MAX = 24
const LINE_GAP_MAX = 16

function lines(page: FormPageText, minX: number): { y: number; text: string }[] {
  const rows: { y: number; parts: { x: number; str: string }[] }[] = []
  for (const item of page.items) {
    if (item.x < minX) continue
    const row = rows.find((r) => Math.abs(r.y - item.y) <= 2)
    if (row) row.parts.push(item)
    else rows.push({ y: item.y, parts: [item] })
  }
  return rows
    .map((r) => ({ y: r.y, text: r.parts.sort((a, b) => a.x - b.x).map((p) => p.str).join(' ').replace(/\s+/g, ' ').trim() }))
    .sort((a, b) => a.y - b.y)
}

const normalise = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/[☐☑☒]/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * The "I DO NOT consent …" sentence printed beside a box, or null. Takes the
 * line level with the box and up to two wrapped lines after it, stopping at
 * the next box's sentence.
 */
export function statementBeside(box: FormCheckbox, page: FormPageText): string | null {
  const rows = lines(page, box.x - 10)
  const target = box.y + 12
  const candidates = rows
    .map((r, i) => ({ ...r, i }))
    .filter((r) => r.y >= box.y + BASELINE_MIN && r.y <= box.y + BASELINE_MAX && /do not consent/i.test(r.text))
    .sort((a, b) => Math.abs(a.y - target) - Math.abs(b.y - target))
  const first = candidates[0]
  if (!first) return null
  const parts = [first.text]
  let prevY = first.y
  for (const next of rows.slice(first.i + 1, first.i + 3)) {
    if (next.y - prevY > LINE_GAP_MAX || /do not consent/i.test(next.text) || next.text.startsWith('☐')) break
    parts.push(next.text)
    prevY = next.y
  }
  return normalise(parts.join(' '))
}

/** Which opt-out a sentence is, or null when it is none of them (or more than one). */
export function optOutForStatement(statement: string): OptOutBox | null {
  const hits = STATEMENTS.filter((s) => s.pattern.test(statement))
  return hits.length === 1 ? hits[0].name : null
}

/**
 * Names each box by its sentence and returns the answers as form fields
 * ('true' = ticked = "I do NOT consent"). A box on two signers' copies is
 * ticked if either copy is. Boxes that can't be named are counted, not
 * returned.
 */
export function nameCheckboxes<B extends FormCheckbox>(
  boxes: B[],
  pageOf: (box: B) => FormPageText | undefined,
): { fields: { name: OptOutBox; value: 'true' | 'false' }[]; unnamed: number } {
  const answers = new Map<OptOutBox, boolean>()
  let unnamed = 0
  for (const box of boxes) {
    const page = pageOf(box)
    const statement = page ? statementBeside(box, page) : null
    const name = statement ? optOutForStatement(statement) : null
    if (!name) {
      unnamed++
      continue
    }
    answers.set(name, (answers.get(name) ?? false) || box.selected)
  }
  return {
    fields: [...answers].map(([name, ticked]) => ({ name, value: ticked ? 'true' : 'false' })),
    unnamed,
  }
}

/**
 * The boxes a read found, for agreements.form_opt_outs: one key per box on
 * the form, true = ticked. Fields that aren't opt-out boxes are ignored.
 */
export function formOptOuts(fields: { name: string; value: string }[]): Partial<Record<OptOutBox, boolean>> {
  const out: Partial<Record<OptOutBox, boolean>> = {}
  for (const name of OPT_OUT_BOXES) {
    const ticked = readCheckbox(fields, name)
    if (ticked !== null) out[name] = ticked
  }
  return out
}
