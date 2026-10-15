'use client'

import { useEffect } from 'react'
import { Button } from '@stellr/web-ui'

/**
 * Shown when a member or admin page fails to load (a dropped connection on a
 * phone, a server error), in place of a blank screen. The surrounding layout
 * and navigation stay, so the person can retry or go elsewhere.
 */
export function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[route error]', error.digest ?? '', error)
  }, [error])

  return (
    <div role="alert" className="mx-auto max-w-lg rounded-card border border-line bg-white p-6 text-center">
      <h1 className="font-display text-xl font-bold text-ink">This page didn’t load</h1>
      <p className="mt-2 text-sm text-content-body">
        It may be the connection. Try again, and if it keeps happening, let us know at hello@stellreducation.org.
      </p>
      <Button onClick={reset} variant="primaryStrong" className="mt-5 min-h-11">
        Try again
      </Button>
    </div>
  )
}
