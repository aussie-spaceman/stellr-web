// Honeytokens for the cross-tenant / IDOR suites (multi-tenant plan S2/S4,
// "Generated cross-tenant and IDOR suites with honeytokens").
//
// "Canary Academy" is a fake second tenant (AU / AUD). Every value below is a
// recognisable fake that belongs to it. The rule the suites enforce: a caller
// from tenant A (Stellr, or a Stellr participant) must NEVER see one of these
// values in a response, and must never cause a write to a Canary row. If one
// shows up, the route served tenant B's data to tenant A.
//
// Dependency-free so test harnesses, the two-tenant seed script and (later)
// production canary probes can all import it. None of these values is real:
// the email uses the reserved `.invalid` TLD (RFC 2606), the ABN fails the
// ABN checksum, and the ids sit in a block no generator produces.

import { STELLR_TENANT_ID } from '../tenancy/constants'

/** Tenant A: Stellr, tenant #1 (the platform owner). */
export const TENANT_A_ID = STELLR_TENANT_ID

/** Tenant B: the canary tenant. Its slug and host are reserved for tests and probes. */
export const CANARY_TENANT = {
  id: '00000000-0000-4000-8000-0000000ca4a2',
  slug: 'canary-academy',
  legal_name: 'Canary Academy Honeytoken Ltd',
  display_name: 'Canary Academy',
  country: 'AU',
  payment_region: 'AU',
  currency: 'aud',
  time_zone: 'Australia/Sydney',
  // 11 digits, deliberately failing the ABN weighted checksum, so it can never
  // be a real business.
  abn: '00000000000',
  min_participant_age: 14,
  host: 'canary-academy.localhost',
} as const

/** The marker every honeytoken string carries, so a leak is obvious in a log. */
export const HONEYTOKEN_MARKER = 'HONEYTOKEN-CANARY'

/**
 * Ids and values of tenant B's records. Each is used as the "foreign id" a
 * tenant-A caller tries: in a path segment, a query parameter or a body field.
 */
export const HONEYTOKENS = {
  /** A uuid primary key of a Canary row (registration, team, member, …). */
  id: '00000000-0000-4000-8000-0000ca4a0b1d',
  /** A Canary member's uuid (owner of every Canary row). */
  memberId: '00000000-0000-4000-8000-0000ca4a3e3b',
  /** A Canary event slug. */
  eventSlug: 'honeytoken-canary-academy-event',
  /** A Canary event's Sanity-style id. */
  sanityId: 'honeytoken-canary-sanity-event',
  /** A capability token (survey link, team profile link, …) issued by Canary. */
  token: 'honeytoken-canary-capability-token-0ca4a2',
  /** A Canary credential number; matches CREDENTIAL_NUMBER_RE. */
  credentialNumber: 'STL-2026-CANARY01',
  /** A Canary Clerk user id. */
  clerkUserId: 'user_honeytokencanaryacademy',
  /** A Canary participant's email (reserved TLD, never deliverable). */
  email: 'honeytoken@canary-academy.invalid',
  /** A Canary person's name, as it would appear in a roster. */
  personName: 'Honeytoken Canary',
  /** A storage object path under the Canary tenant's prefix. */
  storagePath: `${'00000000-0000-4000-8000-0000000ca4a2'}/honeytoken-canary.pdf`,
  /** A free-text value (a note, a status label) that only a Canary row holds. */
  text: `${'HONEYTOKEN-CANARY'} Canary Academy private record`,
} as const

/** Every value that must never reach a tenant-A response. */
export const HONEYTOKEN_VALUES: readonly string[] = [
  CANARY_TENANT.id,
  CANARY_TENANT.legal_name,
  CANARY_TENANT.host,
  HONEYTOKEN_MARKER,
  ...Object.values(HONEYTOKENS),
]

/**
 * The honeytoken a tenant-A caller sends for a named id input: a path segment
 * (`[slug]`), a query parameter (`?registrationId=`) or a body field
 * (`teamId`). Plural names (`ids`, `memberIds`) get an array.
 */
export function honeytokenFor(name: string): string | string[] {
  const n = name.replace(/^\.\.\./, '')
  const lower = n.toLowerCase()
  let value: string
  if (lower.includes('slug') || lower === 'event' || lower === 'eventkey') value = HONEYTOKENS.eventSlug
  else if (lower.includes('token') || lower === 'key' || lower === 'code') value = HONEYTOKENS.token
  else if (lower === 'number' || lower.endsWith('number')) value = HONEYTOKENS.credentialNumber
  else if (lower.includes('email')) value = HONEYTOKENS.email
  else if (lower === 'path' || lower.endsWith('path')) value = HONEYTOKENS.storagePath
  else if (lower.includes('sanity')) value = HONEYTOKENS.sanityId
  else if (lower.includes('clerk') || lower === 'userid') value = HONEYTOKENS.clerkUserId
  else value = HONEYTOKENS.id
  const plural = /(ids|slugs|tokens|numbers)$/i.test(n) || name.startsWith('...')
  return plural ? [value] : value
}

export interface HoneytokenHit {
  value: string
  /** Up to 40 characters either side of the first occurrence. */
  context: string
}

/**
 * Scans a response body (string, bytes or any JSON value) for honeytokens.
 * Returns every value found, so a failing test names exactly what leaked.
 * Case-insensitive, and also checks the URL-encoded form (a value echoed in a
 * redirect Location or a signed URL).
 *
 * `sent` lists the values the caller itself supplied (the foreign id in the
 * path, say). Echoing those back ("team … not found") tells the caller nothing
 * it did not know, so they are not counted. Every other honeytoken is: it can
 * only have come from a tenant-B row.
 */
export function scanForHoneytokens(body: unknown, opts: { sent?: readonly string[] } = {}): HoneytokenHit[] {
  let text = stringify(body)
  if (!text) return []
  // Blank out what the caller sent first: several honeytokens contain the
  // marker or the tenant id, and an echoed path must not count for them.
  for (const v of [...(opts.sent ?? [])].sort((a, b) => b.length - a.length)) {
    for (const form of new Set([v, encodeURIComponent(v)])) {
      if (form) text = text.replace(new RegExp(escapeRegExp(form), 'gi'), '<sent>')
    }
  }
  const lower = text.toLowerCase()
  const hits: HoneytokenHit[] = []
  for (const value of HONEYTOKEN_VALUES) {
    for (const form of new Set([value, encodeURIComponent(value)])) {
      const at = lower.indexOf(form.toLowerCase())
      if (at === -1) continue
      hits.push({ value, context: text.slice(Math.max(0, at - 40), at + form.length + 40) })
      break
    }
  }
  return hits
}

function stringify(body: unknown): string {
  if (body == null) return ''
  if (typeof body === 'string') return body
  if (body instanceof Uint8Array) return new TextDecoder('utf-8', { fatal: false }).decode(body)
  if (body instanceof ArrayBuffer) return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(body))
  try {
    return JSON.stringify(body) ?? ''
  } catch {
    return String(body)
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
