import { clerkClient } from '@clerk/nextjs/server'

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
  const client = await clerkClient()

  // Reuse an existing Clerk account for this email if there is one.
  const existing = await client.users.getUserList({ emailAddress: [email] })
  let user = existing.data[0]
  let created = false

  if (!user) {
    user = await client.users.createUser({
      emailAddress: [email],
      firstName,
      lastName,
      skipPasswordRequirement: true,
    })
    created = true
  }

  // 1 hour is plenty for the registration → confirmation hop (and survives a
  // detour through Stripe checkout for card payments).
  const { token } = await client.signInTokens.createSignInToken({
    userId: user.id,
    expiresInSeconds: 60 * 60,
  })

  return { clerkUserId: user.id, signInToken: token, created }
}
