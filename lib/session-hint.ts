/**
 * Whether this browser probably has a signed-in Clerk session, without loading
 * Clerk. Clerk keeps a readable `__client_uat` cookie (sometimes with an
 * instance suffix): `0` when signed out, the sign-in time when signed in.
 *
 * A hint only. Use it to skip work an anonymous visitor can't use (a prefill
 * request, an account menu), never to grant anything: the server checks the
 * real session.
 */
export function hasSessionHint(cookieString: string = typeof document === 'undefined' ? '' : document.cookie): boolean {
  return cookieString.split(';').some((part) => {
    const eq = part.indexOf('=')
    if (eq === -1) return false
    const name = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    return (name === '__client_uat' || name.startsWith('__client_uat_')) && value !== '' && value !== '0'
  })
}
