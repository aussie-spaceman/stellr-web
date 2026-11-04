import 'server-only'
import { headers } from 'next/headers'
import { NONCE_HEADER } from '@/lib/csp'

/**
 * This request's CSP nonce, as proxy.ts set it (lib/csp.ts), or undefined on a
 * route without one. The Clerk layouts pass it to ClerkProvider so the
 * clerk-js <script> Clerk renders in the HTML carries it: that tag is
 * parser-inserted, so 'strict-dynamic' doesn't cover it.
 *
 * Only for layouts that already render per request (each Clerk layout does):
 * reading headers() makes a route dynamic.
 */
export async function requestNonce(): Promise<string | undefined> {
  return (await headers()).get(NONCE_HEADER) ?? undefined
}
