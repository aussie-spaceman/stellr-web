import { auth } from '@clerk/nextjs/server'
import { Navbar } from './Navbar'

/**
 * Shared site header used by both the public ((public)) and member ((member)) shells.
 *
 * Resolves the Clerk session on the server so the Navbar paints the correct
 * signed-in / signed-out state on first render (no client-side flash). The same
 * brand chrome therefore appears on www.stellreducation.org and
 * app.stellreducation.org, with the utility bar swapping between
 * "Log In / Join Free" and "My Account + user menu".
 *
 * Note: cross-subdomain session sharing requires a Clerk *production* instance
 * whose cookie is scoped to the stellreducation.org root domain. On the dev
 * instance the session is not shared between subdomains, so a user signed in on
 * the app subdomain will still appear signed out on www.
 */
export async function SiteHeader() {
  const { userId, sessionClaims } = await auth()
  const isAdmin = (sessionClaims?.metadata as { role?: string } | undefined)?.role === 'admin'

  return <Navbar isSignedIn={!!userId} isAdmin={isAdmin} />
}
