'use client'

import NextLink from 'next/link'
import type { ComponentProps } from 'react'

// next/link with prefetching off, for every link on the public site.
//
// A prefetch is a request, and each request runs proxy.ts on Vercel's metered
// CPU even when the CDN already has the page. One homepage view fired 16 of them
// (5 Nov 2026), and a prefetch of a stale page also re-renders it. Marketing
// pages come from the CDN, so a click is quick without one.
//
// A client component so that a server page can pass it as `as={Link}`.
// test/public-no-prefetch.test.ts keeps public pages on this link.
export default function SiteLink(props: ComponentProps<typeof NextLink>) {
  return <NextLink {...props} prefetch={false} />
}
