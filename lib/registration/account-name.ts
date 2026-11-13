// A signed-in organiser's name comes from their account, not the form (owner
// decision, 13 Nov 2026, tracker row promote-s5-wave3.17). The members row is the
// account's name: the Clerk webhook copies a name change there (app/api/webhooks/clerk).
//
// Both halves or neither: an account with only one half on file has no usable
// name yet, so the organiser types theirs as before, and the form leaves the fields
// open. The form (via lib/registration-prefill) and the group gate both ask this one
// function, so the two can never disagree about whether the name is locked.
//
// Pure, so it has no server imports.

export interface AccountName {
  first_name: string
  last_name: string
}

export function accountName(
  member: { first_name?: string | null; last_name?: string | null } | null | undefined,
): AccountName | null {
  const first = typeof member?.first_name === 'string' ? member.first_name.trim() : ''
  const last = typeof member?.last_name === 'string' ? member.last_name.trim() : ''
  return first && last ? { first_name: first, last_name: last } : null
}
