import { clerkClient } from '@clerk/nextjs/server'
import { assertLiveCredentials } from '@/lib/env-guards'

export interface ProvisionedClerkUser {
  clerkUserId: string
  /** One-time sign-in ticket the client exchanges for a session via
   *  `signIn.create({ strategy: 'ticket', ticket })`. `null` when it would not
   *  be safe to silently sign this caller in — see the security note below.
   *  When this is `null` the caller must NOT exchange it and must NOT link
   *  `clerkUserId` to any existing member row. */
  signInToken: string | null
  /** True when the Clerk user was created by this call (vs. already existed). */
  created: boolean
}

/**
 * Find-or-create a Clerk user for `email` and, only when it is safe, mint a
 * short-lived sign-in token.
 *
 * Used by the public group-registration flow so a teacher / student manager who
 * registers without an account is silently signed in on the confirmation step
 * and can immediately open their group's Google Sheet from the member portal.
 *
 * SECURITY (deep review C-1, findings REG-1 + AUTH-2): these callers are
 * UNAUTHENTICATED. An anonymous POST naming someone else's email must never
 * receive a usable session for that person. A ticket is only safe when THIS
 * request created BOTH the Clerk user AND the member row, i.e. there is no
 * pre-existing account or member data behind the email:
 *   - Clerk user already exists  → a ticket would sign the caller in as the
 *     owner (for a staff address, the admin console). Never mint.
 *   - member row already exists   → eagerly linking a freshly-created Clerk user
 *     to it (see the callers' `clerk_user_id` write) would bind the caller's
 *     session to that person's existing registrations, agreements and roster.
 *     Never mint, and the caller must not link.
 * So the caller passes `memberIsNew` (did THIS request create the member row),
 * and a token is returned only when `created && memberIsNew`. Everyone else
 * signs in through Clerk's normal, email-verified flow. The `user.created`
 * webhook still links the Clerk id back to the member row by email for the
 * legitimate returning-member case.
 *
 * The created user is passwordless.
 */
export async function ensureClerkUserAndSignInToken(
  email: string,
  firstName: string,
  lastName: string,
  opts: { memberIsNew: boolean },
): Promise<ProvisionedClerkUser> {
  const { clerkUserId, created } = await ensureClerkUser(email, firstName, lastName)

  if (!created || !opts.memberIsNew) {
    return { clerkUserId, signInToken: null, created }
  }

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
