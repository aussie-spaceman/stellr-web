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

export const PRIVATE_ROUTE_HEADER = 'x-stellr-private-route'

const PRIVATE = [
  /^\/sign(\/|$)/,
  /^\/register\/[^/]+\/(pay|join)\//,
  /^\/privacy\/request(\/|$)/,
]

export function isPrivatePath(pathname: string): boolean {
  return PRIVATE.some((re) => re.test(pathname))
}
