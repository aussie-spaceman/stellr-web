// Pure hostname rules for tenant routing (multi-tenancy plan S5, slice B1).
//
// Safe to import from a client component: this file imports nothing and reads
// no env, so the host-map loader and its secret-key handling (lib/tenancy/host.ts)
// can never reach a browser bundle through it. host.test.ts holds it to that.
// Client code imports from here, not from ./host.

/** RFC 1035 total length cap for a hostname. */
const MAX_HOST_LENGTH = 253

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
// At least two colons: `[cafe.face]` and `[:]` are not addresses.
const IPV6_LITERAL = /^\[(?=[^\]]*:[^\]]*:)[0-9a-f:.]+\]$/
const PORT = /^:\d{1,5}$/

function isValidPort(text: string): boolean {
  return PORT.test(text) && Number(text.slice(1)) <= 65_535
}

/**
 * The hosts Stellr itself serves, independent of any zone setting. The apex,
 * www and app, plus local development and Vercel deployments (previews and the
 * dev project's alias). Deliberately not `*.stellreducation.org`: the tenant
 * zone lives under that domain.
 */
const KNOWN_STELLR_HOSTS: ReadonlySet<string> = new Set([
  'stellreducation.org',
  'www.stellreducation.org',
  'app.stellreducation.org',
  'localhost',
  '127.0.0.1',
  '[::1]',
])
const KNOWN_STELLR_HOST_SUFFIX = '.vercel.app'

// ── Normalisation ────────────────────────────────────────────────────────────

/**
 * A hostname in canonical form, or null when it is not a valid hostname.
 *
 * Lower-cases; strips a `:port` and one trailing dot; rejects anything that is
 * not dot-separated LDH labels (1–63 characters, no leading or trailing hyphen)
 * within 253 characters. Non-ASCII is rejected rather than converted: a Host
 * header carries the punycode (`xn--…`) form, which passes as-is. A bracketed
 * IPv6 literal (`[::1]:3000`) is kept, bracketed, without its port.
 */
export function normaliseHost(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  let host = raw.trim().toLowerCase()
  if (!host || host.length > MAX_HOST_LENGTH + 7) return null // + room for ":65535" and a dot

  if (host.startsWith('[')) {
    const close = host.indexOf(']')
    if (close < 0) return null
    const rest = host.slice(close + 1)
    if (rest && !isValidPort(rest)) return null
    const literal = host.slice(0, close + 1)
    return IPV6_LITERAL.test(literal) ? literal : null
  }

  const colon = host.indexOf(':')
  if (colon >= 0) {
    if (!isValidPort(host.slice(colon))) return null
    host = host.slice(0, colon)
  }
  if (host.endsWith('.')) host = host.slice(0, -1)
  if (!host || host.length > MAX_HOST_LENGTH) return null
  return host.split('.').every((label) => LABEL.test(label)) ? host : null
}

/** Whether a canonical zone suffix is one only a test or local run should use. */
export function isDevZoneSuffix(suffix: string): boolean {
  return suffix.endsWith('.localhost') || suffix.endsWith('.test')
}

/**
 * The tenant zone suffix in canonical form (leading dot, lower case, no
 * trailing dot), or null when it is unset or unsafe.
 *
 * Unsafe means it could swallow Stellr's own hosts: it must be `.localhost`,
 * end in `.localhost` or `.test`, or have at least three labels (for example
 * `.events.stellreducation.org`). `.org` or `.stellreducation.org` would put
 * www and app inside the zone and 404 them, so they are refused and treated as
 * unset.
 *
 * A zone under `.vercel.app` is refused too. Every host there is a known Stellr
 * host, and browser code can't read the zone, so the server would route such a
 * host as a tenant while the browser loaded trackers on it.
 */
export function normaliseZoneSuffix(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim().toLowerCase().replace(/^\.+/, '')
  if (!trimmed) return null
  const host = normaliseHost(trimmed)
  if (!host || host !== trimmed.replace(/\.$/, '') || host.startsWith('[')) return null
  if (!isDevZoneSuffix(`.${host}`) && host.split('.').length < 3) return null
  if (`.${host}`.endsWith(KNOWN_STELLR_HOST_SUFFIX)) return null
  return `.${host}`
}

// ── Classification ───────────────────────────────────────────────────────────

export type HostClass =
  | { kind: 'invalid' }
  | { kind: 'outside-zone'; host: string }
  | { kind: 'in-zone'; host: string }

/**
 * Where a host sits relative to the tenant zone. A host is in the zone only when
 * it ends with the suffix, which includes the suffix's leading dot, so the zone
 * apex itself (`localhost` for `.localhost`) is outside. With no suffix there is
 * no zone.
 */
export function classifyHost(rawHost: string | null | undefined, suffix: string | null): HostClass {
  const host = normaliseHost(rawHost)
  if (!host) return { kind: 'invalid' }
  if (!suffix) return { kind: 'outside-zone', host }
  return host.endsWith(suffix) ? { kind: 'in-zone', host } : { kind: 'outside-zone', host }
}

/** Whether a hostname is one Stellr itself serves. Knows nothing about the zone. */
export function isKnownStellrHost(rawHost: string | null | undefined): boolean {
  const host = normaliseHost(rawHost)
  if (!host) return false
  return KNOWN_STELLR_HOSTS.has(host) || host.endsWith(KNOWN_STELLR_HOST_SUFFIX)
}

/**
 * Whether trackers (GTM, HubSpot, Vercel Analytics) may load on this hostname.
 *
 * True only for a known Stellr host that is not inside the tenant zone. It is an
 * allow-list so that it does not depend on the zone being configured: browser
 * code cannot read server env, and a missing or refused zone must not turn
 * trackers on for a tenant host where minors register. www keeps its trackers in
 * that case too. Everything else is false: invalid hosts, tenant-zone hosts, a
 * platform-owner test host such as stellr.localhost, and a mapped host outside
 * the zone.
 */
export function isStellrTrackingHost(
  hostname: string | null | undefined,
  zoneSuffix?: string | null,
): boolean {
  if (!isKnownStellrHost(hostname)) return false
  return classifyHost(hostname, normaliseZoneSuffix(zoneSuffix)).kind === 'outside-zone'
}
