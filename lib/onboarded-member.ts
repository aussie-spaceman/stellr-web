import { getCurrentMember, type CommunityMember } from '@/lib/community'

/**
 * The signed-in member, but only once they have been through
 * /account/onboarding. Every /api/community route resolves its caller here.
 *
 * Sign-up is open to anyone (decision 24). A new Clerk account gets a members
 * row from the Clerk webhook with no date of birth, and the age rules (under-13
 * guardian consent, the minor self-sign-up rules) run at onboarding. The member
 * pages redirect an account in that state to onboarding, but an API route
 * answers whoever holds the session cookie. Without this, an account that never
 * onboarded (a child who onboarding would refuse, say) could join open spaces,
 * post, chat, comment and react by calling the API directly.
 *
 * An account that still needs onboarding is treated as signed out (null), so
 * each route's existing 401 applies. Admin view-as never needs onboarding
 * (lib/community sets the flag false), so it resolves as before.
 */
export async function getOnboardedMember(): Promise<CommunityMember | null> {
  const member = await getCurrentMember()
  if (!member || member.needsOnboarding) return null
  return member
}
