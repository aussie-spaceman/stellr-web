'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@stellr/web-ui'

// deep review PUB-9: the public site had no error boundary at all, so any thrown
// server error (now including a Sanity outage on an event/news page — see the
// page files) fell back to Next's unbranded "Application error" screen with no
// retry and no navigation. This boundary catches errors in app/(public)/* and
// renders inside the public layout (SiteHeader + SiteFooter stay in place), with
// a retry (reset) and a way home. A thrown error here is a 500, not a 404, so a
// live URL is not de-indexed when the CMS is merely unreachable.
export default function PublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Surface it in the browser console / Vercel runtime logs. Production never
    // renders the message or stack to the visitor (see below), so this is the
    // only place the detail is kept.
    console.error('[public] render error', error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center bg-surface px-4 py-16 text-center">
      <p className="font-subheading text-sm font-semibold uppercase tracking-[0.08em] text-primary">
        Something went wrong
      </p>
      <h1 className="mt-3 max-w-xl font-display text-3xl font-bold text-ink md:text-4xl">
        We hit a problem loading this page.
      </h1>
      <p className="mt-4 max-w-md text-content-body">
        This is usually temporary. Try again in a moment — if it keeps happening,
        let us know and we&rsquo;ll put it right.
      </p>

      <div className="mt-10 flex flex-col gap-3 sm:flex-row">
        <Button variant="primary" onClick={() => reset()}>
          Try again
        </Button>
        <Button variant="secondary" href="/" as={Link}>
          Back to home
        </Button>
        <Button variant="secondary" href="/contact" as={Link}>
          Contact us
        </Button>
      </div>
    </div>
  )
}
