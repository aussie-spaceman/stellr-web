import { auth } from '@clerk/nextjs/server'
import { isAdminClaims } from '@/lib/admin-auth'
import { getSignedInMember } from '@/lib/community'
import type { Reviewer } from '@/lib/scholarship-offer'

/**
 * Scholarship review is admin-only (owner, 2 Oct 2026) — not event managers.
 * Returns the reviewer to record on the decision, or null when not an admin.
 */
export async function requireScholarshipAdmin(): Promise<Reviewer | null> {
  const { sessionClaims, userId } = await auth()
  if (!isAdminClaims(sessionClaims)) return null
  const member = await getSignedInMember().catch(() => null)
  const name = member ? `${member.first_name ?? ''} ${member.last_name ?? ''}`.trim() || null : null
  return { clerkUserId: userId ?? null, memberId: member?.id ?? null, name }
}
