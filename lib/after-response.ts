import { after } from 'next/server'

// deep review QUAL-1: best-effort side effects (audit rows, notification
// emails) were started with a bare `void fn()` / `fn().catch()` and the handler
// then returned. On Vercel a function instance can be frozen or reclaimed the
// moment the response is flushed, so work not registered with `after()` is not
// guaranteed to run — a dropped impersonation audit row (a safeguarding control)
// or a reply email that silently never sends. `after()` keeps the instance
// alive until the task settles.
//
// `lib/hubspot.ts` already wraps this pattern for its own lead captures; this is
// the shared version every other site should use. (The hubspot copy can be
// folded into this one later — left alone here to keep the diff scoped.)

/**
 * Run `task` once the response has been sent, keeping the instance alive until
 * it settles. Falls back to a detached run where there is no request context
 * (scripts, tests), where `after()` throws. Always swallows and logs the task's
 * own error, so a best-effort side effect can never become an unhandled
 * rejection or fail the request.
 */
export function runAfterResponse(label: string, task: () => Promise<unknown>): void {
  const safe = () =>
    task().catch((err) => console.error(`[${label}] post-response task failed:`, err))
  try {
    after(safe)
  } catch {
    void safe()
  }
}
