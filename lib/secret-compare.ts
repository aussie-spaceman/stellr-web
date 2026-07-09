import { timingSafeEqual } from 'crypto'

/**
 * Constant-time comparison for shared secrets / bearer tokens passed as strings.
 * Returns false on any length mismatch (length is not itself secret here) and
 * otherwise compares in constant time, so a caller can't recover the expected
 * value byte-by-byte from response-timing differences. Use for any place a
 * request-supplied secret is checked against an env-var secret.
 */
export function safeStrEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}
