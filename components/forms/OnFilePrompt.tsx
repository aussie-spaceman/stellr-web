import Link from 'next/link'

/** A date of birth that means a parent or guardian has to help: no login to make yet. */
export function needsAnAdultToRegister(age: number): boolean {
  return !Number.isFinite(age) || age < 13
}

/** The part of the Clerk client this needs. */
interface ClerkClientLike {
  client?: { reload?: () => Promise<unknown>; lastActiveSessionId?: string | null } | null
  setActive?: (params: { session: string }) => Promise<unknown>
}

/**
 * Pick up a session started in another tab. A tab that loaded signed out does not
 * notice one, and does not refresh its short-lived token, so without this its next
 * request reads as signed out once that token expires (about a minute). Checked in
 * a browser on 5 Nov 2026. Never throws: a failure leaves the request to answer.
 */
export async function adoptSessionFromAnotherTab(clerk: ClerkClientLike): Promise<void> {
  try {
    await clerk.client?.reload?.()
    const session = clerk.client?.lastActiveSessionId
    if (session) await clerk.setActive?.({ session })
  } catch (e) {
    console.error('[registration] could not pick up the session from another tab:', e)
  }
}

/**
 * The sentence for someone who signed in, in another tab, under a different address
 * from the one typed on the form, or null when they match. Submitting would mix the
 * typed name and date of birth with that login's email and member.
 */
export function signedInAsSomeoneElse(sessionEmail: string | null | undefined, typedEmail: string | null | undefined): string | null {
  const session = sessionEmail?.trim().toLowerCase()
  const typed = typedEmail?.trim().toLowerCase()
  if (!session || !typed || session === typed) return null
  return `You’re signed in as ${session}, but this form is for ${typed}. Change the email on this form to ${session}, or sign out and sign in with ${typed}, then submit again.`
}

/**
 * The answer when a registration form's email is already on file: what this person
 * can do next. `keepEntries` is for a long form: sign-in opens in a new tab, so what
 * they typed here is still here when they come back and submit again.
 */
export function OnFilePrompt({ schoolAddressOnly, signInUrl, onboardingUrl, signedIn, needsAnAdult, keepEntries = false }: {
  schoolAddressOnly: boolean
  signInUrl: string
  onboardingUrl: string
  signedIn: boolean
  needsAnAdult: boolean
  keepEntries?: boolean
}) {
  const newTab = keepEntries ? { target: '_blank', rel: 'noopener noreferrer' } : {}
  const contact = <Link href="/contact" {...newTab} className="underline hover:no-underline font-medium">contact us</Link>
  const afterwards = keepEntries
    ? 'then come back to this tab and submit again. What you’ve entered here stays.'
    : 'and you’ll come back here to register.'
  return (
    <div role="status" className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
      <p className="font-medium">This email is already on file with Stellr</p>
      {needsAnAdult ? (
        <p className="mt-1">A parent or guardian needs to help with this one. Please ask them to {contact}, and we&apos;ll help.</p>
      ) : signedIn ? (
        <p className="mt-1">
          We couldn&apos;t match your login to it.{' '}
          <Link href={onboardingUrl} {...newTab} className="underline hover:no-underline font-medium">Finish setting up your account</Link>
          {keepEntries ? `, ${afterwards}` : ' and you’ll come back here.'} Or {contact} and we&apos;ll help.
        </p>
      ) : (
        <>
          <p className="mt-1">
            <Link href={signInUrl} {...newTab} className="underline hover:no-underline font-medium">
              {schoolAddressOnly ? 'Sign in with your main email address' : 'Sign in with the address you first used with us'}
            </Link>
            {schoolAddressOnly ? ', not your school one, ' : ', or create your login with it, '}
            {afterwards}
          </p>
          <p className="mt-1">If that doesn&apos;t work, or a parent or guardian is helping you, {contact} and we&apos;ll help.</p>
        </>
      )}
      <p className="mt-1">Signing in registers the person the account belongs to. Registering someone else, such as a child who shares this email? Use a different address for them.</p>
    </div>
  )
}
