// Pages reached through a private link: the link itself is the key, so the
// page must not hand its address to anyone. On these routes the root layout
// loads no analytics or advertising tags, crawler visits are not recorded,
// and next.config.mjs sets Referrer-Policy: no-referrer and no caching.
//
//   /sign, /sign/copy           Stellr signing (token in the URL fragment)
//   /register/<slug>/pay/<tok>  pay-later link for a registration
//   /register/<slug>/pay-seat/<tok> per-seat pay link (deep review PAY-8)
//   /register/<slug>/join/<tok> join link for a group registration
//   /privacy/request, …/confirm the privacy request form and its emailed
//                               confirmation link (people describe their families)
//   /survey/<token>             post-event survey link (token in the path)
//   /team-profile/<token>       pre-event team profile link (token in the path)
//   /credentials/<number>       credential pages — the guardian "view credential"
//                               email carries a ?k=<HMAC> bearer token for a
//                               PRIVATE minor credential, and these pages show a
//                               child's name/award. No analytics or ad tags here,
//                               so the token and the minor's identifiers never
//                               reach GA4 / HubSpot / Vercel Analytics (deep
//                               review MP-1).
//   /scholarship/offer/<token>  scholarship-offer link (deep review PUB-13) — the
//                               token is the only key; the page reveals a (usually
//                               minor) applicant's first name and event and mints
//                               a working pay link. Same treatment as above so the
//                               token URL is never sent to GA4 / HubSpot / Vercel
//                               Analytics. The /scholarship landing page stays
//                               public and tracked — only the token path is keyed.
//   /check-in, /check-in/<slug> event check-in from the door QR code. The link
//                               carries the event's check-in token and attendees
//                               (mostly minors) enter a name and date of birth,
//                               so no tags load and no cookie banner covers the
//                               form on a phone.
//   /sign-in, /sign-up, /account/onboarding
//                               only when a query value (?next, ?redirect_url, …)
//                               is itself a private link. A guest who opens a pay
//                               or join link is sent to sign in with that link in
//                               ?next, so the token is in this page's address too.

const PRIVATE = [
  /^\/sign(\/|$)/,
  /^\/register\/[^/]+\/(pay|pay-seat|join)\//,
  /^\/privacy\/request(\/|$)/,
  /^\/survey\//,
  /^\/team-profile\//,
  /^\/credentials(\/|$)/,
  /^\/scholarship\/offer\//,
  /^\/check-in(\/|$)/,
]

// Pages that send the visitor on to a URL named in their query.
const HANDOFF = /^\/(sign-in|sign-up|account\/onboarding)(\/|$)/

// Onboarding's own ?next can name sign-in again, and so on. Two levels is
// every real chain; anything deeper is treated as private.
const MAX_HANDOFF_DEPTH = 3

/** A same-site path or absolute http(s) URL named in a query value, or null. */
function linkedUrl(value: string): URL | null {
  if (!value.startsWith('/') && !/^https?:\/\//i.test(value)) return null
  try {
    return new URL(value, 'https://placeholder.invalid')
  } catch {
    return null
  }
}

/**
 * Whether a page's address is a private link (see above). `pathname` may carry
 * its own `?query`; `search` is the query when it is passed separately, as
 * `URL.search` or `URLSearchParams`. Without either, only the path decides.
 */
export function isPrivatePath(pathname: string, search?: string | URLSearchParams): boolean {
  return isPrivateAt(pathname, search, 0)
}

function isPrivateAt(pathname: string, search: string | URLSearchParams | undefined, depth: number): boolean {
  const q = pathname.indexOf('?')
  const path = q === -1 ? pathname : pathname.slice(0, q)
  if (PRIVATE.some((re) => re.test(path))) return true
  if (!HANDOFF.test(path)) return false

  const params = new URLSearchParams(search ?? (q === -1 ? '' : pathname.slice(q)))
  for (const value of params.values()) {
    const target = linkedUrl(value)
    if (!target) continue
    if (depth + 1 >= MAX_HANDOFF_DEPTH) return true
    if (isPrivateAt(target.pathname, target.search, depth + 1)) return true
  }
  return false
}
