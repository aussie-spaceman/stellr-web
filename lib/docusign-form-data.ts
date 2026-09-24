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
 * DocuSign reports a ticked checkbox as "X" in form_data; the other truthy
 * spellings are accepted defensively because the value format is not
 * contractually documented.
 */
export function readCredentialOptOut(fields: { name: string; value: string }[]): boolean | null {
  const matches = fields.filter((f) => f.name.toLowerCase() === CREDENTIAL_OPT_OUT_TAB.toLowerCase())
  if (matches.length === 0) return null
  return matches.some((f) => CHECKED.has(f.value.trim().toLowerCase()))
}
