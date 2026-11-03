import { clerkClient } from '@clerk/nextjs/server'
import { assertLiveCredentials } from '@/lib/env-guards'
import { isUnder13On, isValidDob } from '@/lib/age'

// ── The COPPA guard (S0, 2 Nov 2026) ─────────────────────────────────────────
//
// This file holds the app's only call to Clerk's createUser, and it is reached
// only through guardedEnsureClerkUser: a child under 13 gets no login until a
// parent or guardian's agreement is on file, and an unknown or unreadable date
// of birth counts as under 13. lib/clerk-provisioning.guard.test.ts reads the
// source tree and fails if a createUser or createInvitation call appears
// anywhere else, or if a new caller skips the guard. (Two operator scripts
// under scripts/ call Clerk directly; the test names them and why.)

/** What the guard needs to know about the person a login is for. */
export interface ClerkAccountAge {
  /** As held or submitted. Unknown or unreadable is treated as under 13. */
  dateOfBirth: string | null | undefined
  /**
   * Asked only for someone under 13 (or of unknown age): is a parent or
   * guardian's completed agreement on file? Omit it when none can be (a member
   * created by this very request). A lookup that throws counts as "no".
   */
  guardianAgreementOnFile?: () => Promise<boolean>
  /**
   * An admin recorded this person as an adult (an adult age bracket and role)
   * and no date of birth is on file. Lets an unknown age through; never
   * overrides a date of birth that says under 13. Admin paths only: the
   * account invite for a hand-created member (lib/member-invite), which logs
   * it. The guard test fails if anything else passes it.
   */
  adultByRole?: boolean
}

export type GuardedClerkUser =
  | {
      allowed: true
      clerkUserId: string
      created: boolean
      /** Why the login was allowed: a date of birth 13 or over, a guardian's
       *  agreement, or an admin's adult record (unknown age). */
      basis: 'dob' | 'guardian_agreement' | 'adult_by_role'
    }
  /** No login: `under_13` from a date of birth, `age_unknown` without a usable one. */
  | { allowed: false; reason: 'under_13' | 'age_unknown' }

/**
 * Find-or-create a passwordless Clerk login for `email`, unless the person is
 * a child under 13 (or of unknown age) with no guardian agreement on file. Age
 * is judged on today's date, not an event's: COPPA turns on the child's age
 * when the account is made. The refusal comes before any Clerk call, so a
 * refused child's address is not even looked up.
 *
 * A refusal is a return value, never a throw. Anything this throws comes from
 * Clerk itself, after the age check passed.
 */
export async function guardedEnsureClerkUser(
  email: string,
  firstName: string,
  lastName: string,
  age: ClerkAccountAge,
): Promise<GuardedClerkUser> {
  let basis: 'dob' | 'guardian_agreement' | 'adult_by_role' = 'dob'
  if (isUnder13On(age.dateOfBirth)) {
    const knownDob = isValidDob(age.dateOfBirth)
    const onFile = age.guardianAgreementOnFile
      ? await age.guardianAgreementOnFile().catch(() => false)
      : false
    if (onFile) basis = 'guardian_agreement'
    else if (!knownDob && age.adultByRole === true) basis = 'adult_by_role'
    else return { allowed: false, reason: knownDob ? 'under_13' : 'age_unknown' }
  }
  return { allowed: true, basis, ...(await findOrCreateClerkUser(email, firstName, lastName)) }
}

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
 * The login itself goes through guardedEnsureClerkUser (`opts.age`): a child
 * under 13, or anyone whose age is unknown, gets no login and no token here.
 *
 * The created user is passwordless.
 */
export async function ensureClerkUserAndSignInToken(
  email: string,
  firstName: string,
  lastName: string,
  opts: { memberIsNew: boolean; age: ClerkAccountAge },
): Promise<ProvisionedClerkUser> {
  // deep review AUTH-N3: when the member row already exists, do not call
  // the Clerk lookup/create at all. The C-1 fix already withholds the sign-in token
  // here (no takeover — the passwordless user can't be authenticated without an
  // email code to the real owner), but the old ensureClerkUser still CREATED a Clerk
  // user for the email, which the svix-verified user.created webhook then links
  // to the victim's member row: an attacker-triggered clerk_user_id write, plus
  // possible unsolicited Clerk "verify" mail to a real person. Provisioning only
  // makes sense when THIS request also created the member row; a returning
  // member gets their Clerk user from the normal email-verified sign-in instead.
  // Returns no clerkUserId precisely because the callers must not (and do not)
  // link one unless a token was minted.
  if (!opts.memberIsNew) {
    return { clerkUserId: '', signInToken: null, created: false }
  }

  const login = await guardedEnsureClerkUser(email, firstName, lastName, opts.age)
  if (!login.allowed) {
    // COPPA: no login until a parent or guardian has signed. Same shape as the
    // existing-member case, so the callers neither link nor sign anyone in.
    return { clerkUserId: '', signInToken: null, created: false }
  }
  const { clerkUserId, created } = login

  if (!created) {
    // The email already has a Clerk account → a ticket would sign the caller in
    // as that owner. Never mint, and the caller must not link clerkUserId.
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
 * Also reached when an admin invites a hand-created member, so the invite's
 * "sign in with this address" works even while public sign-up is closed.
 *
 * Deliberately not exported: every caller goes through guardedEnsureClerkUser.
 */
async function findOrCreateClerkUser(
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
