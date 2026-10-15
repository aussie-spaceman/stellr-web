import { Navbar } from './Navbar'

/**
 * Site header for the public site ((public) route group).
 *
 * It used to resolve the Clerk session on the server so the header painted the
 * signed-in state first time. That one call made every public page render per
 * request (no CDN caching), and pulled Clerk into every page. The header now
 * reads a cookie hint after hydration (lib/session-hint) and loads the account
 * menu only for signed-in visitors.
 */
export function SiteHeader() {
  return <Navbar />
}
