import { auth } from '@clerk/nextjs/server'
import { hasCapability, type Capability } from '@/lib/authz'
import { getSignedInMember } from '@/lib/community'
import type { Reviewer } from '@/lib/scholarship-offer'

/**
 * Scholarship review is admin-only (owner, 2 Oct 2026) — not event managers.
 * Returns the reviewer to record on the decision, or null when not an admin.
 */
export async function requireScholarshipAdmin(cap: Capability = 'scholarships:write'): Promise<Reviewer | null> {
  // Deciding stays admin-only (scholarships:write); Staff may read (portal:read).
  const { userId } = await auth()
  if (!(await hasCapability(cap))) return null
  const member = await getSignedInMember().catch(() => null)
  const name = member ? `${member.first_name ?? ''} ${member.last_name ?? ''}`.trim() || null : null
  return { clerkUserId: userId ?? null, memberId: member?.id ?? null, name }
}
