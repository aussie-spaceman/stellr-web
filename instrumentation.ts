import type { Instrumentation } from 'next'

// Next.js instrumentation hook. onRequestError runs for every server error Next
// reports (route handlers, server components, server actions, proxy). It hands
// the error to lib/app-errors, which scrubs it and records it in app_errors for
// the daily "Errors in the last day" email (S1 monitoring).
//
// Best-effort by construction: Node runtime only (the recorder uses node:crypto
// and the service-role client), loaded lazily so it costs nothing until an
// error happens, and wrapped so a failure to record can never become a second
// error on top of the first.

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  // The import sits inside the runtime check (Next's documented pattern) so the
  // edge bundle never pulls in node:crypto or the service-role client.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { captureRequestError } = await import('./lib/app-errors')
      await captureRequestError(err, request, context)
    } catch (e) {
      console.error('[instrumentation] error capture failed:', e instanceof Error ? e.message : e)
    }
  }
}
