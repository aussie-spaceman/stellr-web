/**
 * Will the server accept the Clerk session cookie this browser context holds?
 * Pure, so it is unit-tested (session-cookie.test.ts) apart from Playwright.
 *
 * Clerk's server reads `__session` (or its instance-suffixed twin) and refuses
 * an API request, with no redirect, when the token has expired or was issued
 * before `__client_uat` (@clerk/backend authenticateRequest). Only a page
 * navigation gets a handshake that mints a new one, and only when the token is
 * already bad at that moment. See fresh-session.ts for why that matters.
 *
 * Returns '' when every session cookie is good for at least `minSecondsLeft`,
 * otherwise the reason it is not, for the failure message.
 */

export interface CookieLike {
  name: string
  value: string
}

const isSession = (name: string) => name === '__session' || name.startsWith('__session_')
const isClientUat = (name: string) => name === '__client_uat' || name.startsWith('__client_uat_')

function tokenTimes(token: string): { iat: number; exp: number } | null {
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const { iat, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { iat?: unknown; exp?: unknown }
    return typeof iat === 'number' && typeof exp === 'number' ? { iat, exp } : null
  } catch {
    return null
  }
}

export function sessionCookieProblem(cookies: readonly CookieLike[], nowSeconds: number, minSecondsLeft: number): string {
  const sessions = cookies.filter((c) => isSession(c.name))
  if (sessions.length === 0) return 'there is no __session cookie'
  const clientUat = Math.max(0, ...cookies.filter((c) => isClientUat(c.name)).map((c) => Number(c.value) || 0))
  for (const cookie of sessions) {
    const times = tokenTimes(cookie.value)
    if (!times) return `${cookie.name} is not a session token`
    const left = Math.floor(times.exp - nowSeconds)
    if (left < minSecondsLeft) return `${cookie.name} has ${left}s left, under the ${minSecondsLeft}s needed`
    if (times.iat < clientUat) return `${cookie.name} was issued before __client_uat, so Clerk reads it as outdated`
  }
  return ''
}
