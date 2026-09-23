// Pure parsing for values read back from a completed DocuSign envelope.
// Kept separate from lib/docusign.ts (network + secrets) so it is unit-testable.

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
