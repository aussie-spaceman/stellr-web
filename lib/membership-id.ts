// The Stellr Member ID rules every path that links a person by ID shares, the same
// as /api/members/lookup, whose answer fills the slot.

/** The stored form of a Member ID: digits only, zero-padded to 7. Null for anything else. */
export function normalizeMembershipId(raw: string): string | null {
  const id = raw.trim()
  return /^\d{1,7}$/.test(id) ? id.padStart(7, '0') : null
}

/**
 * The last name a Member ID was submitted with, against the member row: a trimmed,
 * case-insensitive compare. An empty name on either side never matches.
 */
export function confirmsMemberLastName(
  submitted: unknown,
  onFile: { member_last_name?: string | null },
): boolean {
  const name = typeof submitted === 'string' ? submitted.trim().toLowerCase() : ''
  return name.length > 0 && (onFile.member_last_name ?? '').trim().toLowerCase() === name
}

/**
 * The one answer for a Member ID that could not be used, built only from what was
 * submitted. The way forward covers each reason: a mistyped ID or name, or a date of
 * birth Stellr has to sort out with them.
 */
export function memberIdUnusableMessage(submittedName: string): string {
  return `We couldn't use the Stellr Member ID for ${submittedName}. Check the ID and last name, or enter their details by hand. If both are right, ask them to check their date of birth with Stellr.`
}
