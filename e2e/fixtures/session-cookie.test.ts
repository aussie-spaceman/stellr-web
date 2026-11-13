import { describe, expect, it } from 'vitest'
import { sessionCookieProblem } from './session-cookie'

// A token-shaped string with only the claims the check reads. Not signed: the
// check never verifies a signature, the server does.
const token = (claims: Record<string, unknown>) =>
  `placeholder-header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.placeholder-signature`

const NOW = 1_800_000_000

describe('sessionCookieProblem', () => {
  it('accepts a token with time left, issued after client_uat', () => {
    const cookies = [
      { name: '__session', value: token({ iat: NOW - 1, exp: NOW + 59 }) },
      { name: '__client_uat', value: String(NOW - 100) },
    ]
    expect(sessionCookieProblem(cookies, NOW, 30)).toBe('')
  })

  // The CI flake: a page load kept a token that was still valid, so no handshake
  // replaced it, and it expired before the API call a few seconds later.
  it('refuses a token that is valid now but close to expiry', () => {
    const cookies = [{ name: '__session', value: token({ iat: NOW - 52, exp: NOW + 8 }) }]
    expect(sessionCookieProblem(cookies, NOW, 30)).toBe('__session has 8s left, under the 30s needed')
  })

  it('refuses an expired token', () => {
    const cookies = [{ name: '__session', value: token({ iat: NOW - 300, exp: NOW - 240 }) }]
    expect(sessionCookieProblem(cookies, NOW, 30)).toMatch(/^__session has -240s left/)
  })

  it('refuses a token issued before client_uat, which Clerk treats as outdated', () => {
    const cookies = [
      { name: '__session', value: token({ iat: NOW - 5, exp: NOW + 55 }) },
      { name: '__client_uat', value: String(NOW - 2) },
    ]
    expect(sessionCookieProblem(cookies, NOW, 30)).toMatch(/issued before __client_uat/)
  })

  it('checks the instance-suffixed cookies as well as the plain ones', () => {
    const fresh = token({ iat: NOW, exp: NOW + 60 })
    const stale = token({ iat: NOW - 58, exp: NOW + 2 })
    const cookies = [
      { name: '__session', value: fresh },
      { name: '__session_placeholder', value: stale },
      { name: '__client_uat_placeholder', value: String(NOW - 100) },
    ]
    expect(sessionCookieProblem(cookies, NOW, 30)).toBe('__session_placeholder has 2s left, under the 30s needed')
  })

  it('says so when there is no session cookie or it is not a token', () => {
    expect(sessionCookieProblem([{ name: '__client_uat', value: '0' }], NOW, 30)).toBe('there is no __session cookie')
    expect(sessionCookieProblem([{ name: '__session', value: 'not-a-token' }], NOW, 30)).toBe('__session is not a session token')
  })
})
