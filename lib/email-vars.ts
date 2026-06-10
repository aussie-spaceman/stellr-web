// Single source of truth for the {{mergeField}} vocabulary. Both staff-authored
// DB templates and the admin "available fields" helper draw from this list, so
// the tokens an author sees are exactly the ones the engine can resolve.

export interface MergeField {
  token: string
  label: string
  example: string
}

// Order here is the order shown in the admin field picker.
export const MERGE_FIELDS: MergeField[] = [
  { token: 'firstName', label: 'First name', example: 'Jordan' },
  { token: 'lastName', label: 'Last name', example: 'Lee' },
  { token: 'fullName', label: 'Full name', example: 'Jordan Lee' },
  { token: 'email', label: 'Email', example: 'jordan@example.com' },
  { token: 'membershipId', label: 'Membership ID', example: 'STL-00421' },
  { token: 'tier', label: 'Membership tier', example: 'Scholar' },
]

/** The member shape the engine loads for the audience (see lib/campaigns.ts). */
export interface CampaignMember {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  membership_id: string | null
  tier_name?: string | null
}

/**
 * Build the merge-var map for a member. `unsubscribeUrl` is supplied by the
 * engine (it needs the per-member token) and is exposed as {{unsubscribeUrl}}
 * for authors who want an inline link in addition to the footer.
 */
export function memberMergeVars(m: CampaignMember, unsubscribeUrl: string): Record<string, string> {
  const first = m.first_name?.trim() || 'there'
  const last = m.last_name?.trim() || ''
  return {
    firstName: first,
    lastName: last,
    fullName: `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || 'there',
    email: m.email ?? '',
    membershipId: m.membership_id ?? '',
    tier: m.tier_name ?? '',
    unsubscribeUrl,
  }
}
