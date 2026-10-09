// Pages reached through a private link: the link itself is the key, so the
// page must not hand its address to anyone. On these routes the root layout
// loads no analytics or advertising tags, crawler visits are not recorded,
// and next.config.mjs sets Referrer-Policy: no-referrer and no caching.
//
//   /sign, /sign/copy           Stellr signing (token in the URL fragment)
//   /register/<slug>/pay/<tok>  pay-later link for a registration
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

export const PRIVATE_ROUTE_HEADER = 'x-stellr-private-route'

const PRIVATE = [
  /^\/sign(\/|$)/,
  /^\/register\/[^/]+\/(pay|join)\//,
  /^\/privacy\/request(\/|$)/,
  /^\/survey\//,
  /^\/team-profile\//,
  /^\/credentials(\/|$)/,
]

export function isPrivatePath(pathname: string): boolean {
  return PRIVATE.some((re) => re.test(pathname))
}
