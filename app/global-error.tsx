'use client'

import { useEffect } from 'react'
import '../styles/tokens.css'
import '../styles/globals.css'

// deep review PUB-9: last-resort boundary for an error thrown by the ROOT layout
// itself (which app/(public)/error.tsx cannot catch). It replaces the root
// layout, so it must render its own <html>/<body>; the global stylesheet is
// imported above so the brand tokens still apply. Kept deliberately minimal and
// self-contained — it must render even when something above it is broken.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[global] render error', error)
  }, [error])

  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-4 py-16 text-center">
          <p className="font-subheading text-sm font-semibold uppercase tracking-[0.08em] text-primary">
            Something went wrong
          </p>
          <h1 className="mt-3 max-w-xl font-display text-3xl font-bold text-ink md:text-4xl">
            Stellr hit an unexpected error.
          </h1>
          <p className="mt-4 max-w-md text-content-body">
            This is usually temporary. Please try again — if it keeps happening,
            email{' '}
            <a className="font-semibold text-primary underline" href="mailto:hello@stellreducation.org">
              hello@stellreducation.org
            </a>
            .
          </p>
          <button
            type="button"
            onClick={() => reset()}
            className="mt-10 inline-flex items-center justify-center rounded-control bg-primary px-6 py-3 font-subheading text-sm font-semibold text-white transition-colors hover:bg-primary-deep focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
