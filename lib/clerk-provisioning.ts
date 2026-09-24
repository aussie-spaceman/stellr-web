import { clerkClient } from '@clerk/nextjs/server'
import { assertLiveCredentials } from '@/lib/env-guards'

export interface ProvisionedClerkUser {
  clerkUserId: string
  /** One-time sign-in ticket the client exchanges for a session via
   *  `signIn.create({ strategy: 'ticket', ticket })`. */
  signInToken: string
  /** True when the Clerk user was created by this call (vs. already existed). */
  created: boolean
}

/**
 * Find-or-create a Clerk user for `email` and mint a short-lived sign-in token.
 *
 * Used by the public group-registration flow so a teacher / student manager who
 * registers without an account is silently signed in on the confirmation step
 * and can immediately open their group's Google Sheet from the member portal.
 *
 * The created user is passwordless — they later sign in via Clerk's normal
 * email flow. Clerk's `user.created` webhook links the Clerk id back to the
 * existing `members` row by email; we also link it eagerly at the call site to
 * avoid a race with the ownership check on the sheet endpoint.
 */
export async function ensureClerkUserAndSignInToken(
  email: string,
  firstName: string,
  lastName: string,
): Promise<ProvisionedClerkUser> {
  const { clerkUserId, created } = await ensureClerkUser(email, firstName, lastName)

  // 1 hour is plenty for the registration → confirmation hop (and survives a
  // detour through Stripe checkout for card payments).
  const client = await clerkClient()
  const { token } = await client.signInTokens.createSignInToken({
    userId: clerkUserId,
    expiresInSeconds: 60 * 60,
  })

  return { clerkUserId, signInToken: token, created }
}

/**
 * Find-or-create a passwordless Clerk user for `email`, without signing them in.
 * Also used when an admin invites a hand-created member, so the invite's
 * "sign in with this address" works even while public sign-up is closed.
 */
export async function ensureClerkUser(
  email: string,
  firstName: string,
  lastName: string,
): Promise<{ clerkUserId: string; created: boolean }> {
  const client = await clerkClient()

  // Reuse an existing Clerk account for this email if there is one.
  const existing = await client.users.getUserList({ emailAddress: [email] })
  const found = existing.data[0]
  if (found) return { clerkUserId: found.id, created: false }

  // Refuse to create a user on a production deployment holding TEST keys, which
  // would put a real member's account in the development instance where nobody
  // would look for it.
  assertLiveCredentials('clerk')

  const user = await client.users.createUser({
    emailAddress: [email],
    firstName,
    lastName,
    skipPasswordRequirement: true,
  })
  return { clerkUserId: user.id, created: true }
}
